from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta, timezone

import httpx

from .domain import aliases, normalized
from .importer import printing_key
from .storage import Store, now


class Scryfall:
    def __init__(self, store: Store, transport=None):
        self.store = store
        self.client = httpx.Client(base_url='https://api.scryfall.com',
            headers={'User-Agent': 'MTGVault/0.1 (personal local collection tracker)', 'Accept': 'application/json'},
            timeout=httpx.Timeout(15, connect=5), transport=transport)
        self.lock = threading.Lock()
        self.job_lock = threading.Lock()
        self.last_request = 0.0
        self.state = {'running': False, 'completed': 0, 'total': 0, 'error': '', 'message': 'Not refreshed yet'}

    def request(self, method: str, path: str, **kwargs) -> dict:
        with self.lock:
            for attempt in range(3):
                time.sleep(max(0, 0.21 - (time.monotonic() - self.last_request)))
                self.last_request = time.monotonic()
                try:
                    response = self.client.request(method, path, **kwargs)
                except httpx.RequestError:
                    raise ValueError('Scryfall is unreachable. Previously cached cards and prices are preserved; try again when online.') from None
                if response.status_code == 429 or response.status_code >= 500:
                    if attempt < 2:
                        try:
                            delay = min(5.0, max(0.5, float(response.headers.get('Retry-After', 2 ** attempt))))
                        except ValueError:
                            delay = 2 ** attempt
                        time.sleep(delay)
                        continue
                if response.status_code >= 400:
                    try:
                        message = response.json().get('details', 'Scryfall request failed.')
                    except ValueError:
                        message = 'Scryfall request failed.'
                    raise ValueError(str(message))
                try:
                    return response.json()
                except ValueError:
                    raise ValueError('Scryfall returned an unexpected response. Cached data was preserved.') from None
        raise ValueError('Scryfall is temporarily unavailable.')

    def search(self, query: str) -> list[dict]:
        if not query.strip():
            return []
        response = self.request('GET', '/cards/search', params={'q': query, 'unique': 'prints', 'order': 'name'})
        cards = response.get('data', [])[:30]
        for card in cards:
            self.store.save_card(card)
        return cards

    def start(self, force=False):
        with self.job_lock:
            if self.state['running']:
                return dict(self.state)
            self.state = {'running': True, 'completed': 0, 'total': 0, 'error': '', 'message': 'Connecting to Scryfall'}
            threading.Thread(target=self.refresh, args=(force,), daemon=True).start()
            return dict(self.state)

    def refresh(self, force=False):
        try:
            source = self.store.rows('SELECT DISTINCT printing_key,name FROM holdings UNION SELECT printing_key,name FROM entries WHERE printing_key IS NOT NULL')
            names_by_key = {}
            for row in source:
                names_by_key.setdefault(row['printing_key'], set()).add(normalized(row['name']))
            matches = {r['printing_key']: r for r in self.store.rows('SELECT * FROM matches')}
            cards = {r['id']: r for r in self.store.rows('SELECT * FROM cards')}
            work = []
            cutoff = datetime.now(timezone.utc) - timedelta(days=1)
            for key, names in names_by_key.items():
                match = matches.get(key, {})
                cached = cards.get(match.get('card_id'))
                checked = match.get('checked_at')
                if not force:
                    freshness = cached['fetched_at'] if cached else checked
                    if freshness and datetime.fromisoformat(freshness) > cutoff:
                        continue
                if match.get('card_id') and match.get('status') == 'matched':
                    identifier = {'id': match['card_id']}
                else:
                    code, number = key.split(':', 1)
                    if not code or not number:
                        continue
                    identifier = {'set': code, 'collector_number': number}
                work.append((key, identifier))
            target_names = sorted({e['name'] for e in self.store.rows('SELECT name FROM entries WHERE printing_key IS NULL')
                                   if force or not any(normalized(e['name']) in aliases(json.loads(c['payload']))
                                       and datetime.fromisoformat(c['fetched_at']) > cutoff for c in cards.values())})
            self.state.update(total=len(work) + len(target_names), message='Matching printings and refreshing prices')
            for index in range(0, len(work), 75):
                chunk = work[index:index + 75]
                response = self.request('POST', '/cards/collection', json={'identifiers': [identifier for _, identifier in chunk]})
                found = response.get('data', [])
                by_id = {c['id']: c for c in found}
                by_print = {printing_key(c['set'], c['collector_number']): c for c in found}
                with self.store.connection() as db:
                    for card in found:
                        self.store.save_card(card, db)
                    for key, identifier in chunk:
                        card = by_id.get(identifier.get('id')) if 'id' in identifier else by_print.get(key)
                        previous = matches.get(key, {})
                        if not card:
                            if previous.get('status') == 'matched':
                                continue  # An incomplete API response must not destroy a good match.
                            db.execute('''INSERT OR REPLACE INTO matches (printing_key,status,message,checked_at)
                                VALUES (?, 'not_found', 'No exact printing found. Review the set and collector number.', ?)''', (key, now()))
                            continue
                        valid = names_by_key[key].issubset(aliases(card)) or previous.get('status') == 'matched'
                        status = 'matched' if valid else 'mismatch'
                        message = '' if valid else f'Set/number resolves to {card["name"]}; confirm this match before pricing.'
                        db.execute('''INSERT OR REPLACE INTO matches
                            (printing_key,card_id,status,message,candidate_id,checked_at) VALUES (?,?,?,?,?,?)''',
                            (key, card['id'] if valid else None, status, message, card['id'], now()))
                self.state['completed'] += len(chunk)
            for name in target_names:
                try:
                    card = self.request('GET', '/cards/named', params={'exact': name})
                    self.store.save_card(card)
                except ValueError as exc:
                    if 'unreachable' in str(exc):
                        raise
                self.state['completed'] += 1
            self.store.set_settings({'last_price_success': now()})
            self.state.update(message='Card data is up to date', error='')
        except Exception as exc:
            self.state.update(error=str(exc), message='Refresh stopped; cached data was preserved')
        finally:
            self.state['running'] = False

    def confirm(self, key: str, card_id: str):
        card = self.request('GET', f'/cards/{card_id}')
        with self.store.connection() as db:
            self.store.save_card(card, db)
            db.execute('''INSERT OR REPLACE INTO matches
                (printing_key,card_id,status,message,candidate_id,checked_at) VALUES (?,?, 'matched', '', ?, ?)''',
                (key, card['id'], card['id'], now()))
        return {'matched': True}
