from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation

from .importer import printing_key
from .storage import Store, now


def normalized(name: str) -> str:
    return ' '.join(unicodedata.normalize('NFKC', name).replace('’', "'").casefold().split())


def aliases(card: dict) -> set[str]:
    return {normalized(card['name']), *(normalized(face['name']) for face in card.get('card_faces', []))}


def parse_decklist(text: str) -> list[dict]:
    grouped = Counter()
    zone = 'main'
    for line_number, line in enumerate(text.splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        header = line.strip('[]:').removeprefix('//').strip().casefold()
        if header in {'commander', 'commanders', 'command zone', 'sideboard', 'main', 'mainboard', 'deck', 'maindeck'}:
            zone = 'commander' if header in {'commander', 'commanders', 'command zone'} else ('sideboard' if header == 'sideboard' else 'main')
            continue
        if line.startswith('#') or line.startswith('//'):
            continue
        match = re.fullmatch(r'(\d+)\s*x?\s+(.+)', line, flags=re.I)
        if not match or int(match[1]) < 1:
            raise ValueError(f'Line {line_number}: use a positive quantity followed by a card name.')
        quantity, name = int(match[1]), match[2].strip()
        if quantity > 100_000:
            raise ValueError(f'Line {line_number}: quantity is too large.')
        exact = re.fullmatch(r'(.+?)\s+\(([A-Za-z0-9]{2,8})\)\s+([0-9]+[A-Za-z★]*)', name)
        key = None
        if exact:
            name, key = exact[1].strip(), printing_key(exact[2], exact[3])
        grouped[(name, zone, key)] += quantity
    return [{'name': name, 'zone': zone, 'printing_key': key, 'quantity': quantity}
            for (name, zone, key), quantity in grouped.items()]


def save_deck(store: Store, data: dict, deck_id: int | None = None) -> int:
    name = str(data.get('name', '')).strip()
    if not name:
        raise ValueError('Give the deck a name.')
    if data.get('format') not in {'commander', 'casual60', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper'}:
        raise ValueError('Choose a supported format.')
    entries = parse_decklist(str(data.get('decklist', '')))
    with store.connection() as db:
        if deck_id is None:
            deck_id = db.execute('INSERT INTO decks (name,format,active,updated_at) VALUES (?,?,?,?)',
                (name, data['format'], int(data.get('active', True)), now())).lastrowid
        else:
            if not db.execute('SELECT id FROM decks WHERE id=?', (deck_id,)).fetchone():
                raise ValueError('Deck not found.')
            db.execute('UPDATE decks SET name=?,format=?,active=?,seeded=0,updated_at=? WHERE id=?',
                (name, data['format'], int(data.get('active', True)), now(), deck_id))
            db.execute('DELETE FROM entries WHERE deck_id=?', (deck_id,))
        for e in entries:
            db.execute('INSERT INTO entries (deck_id,name,quantity,zone,printing_key) VALUES (?,?,?,?,?)',
                (deck_id, e['name'], e['quantity'], e['zone'], e['printing_key']))
    return deck_id


def amount(value):
    try:
        result = Decimal(str(value))
        return result if result.is_finite() and result >= 0 else None
    except (InvalidOperation, TypeError, ValueError):
        return None


class Inventory:
    def __init__(self, store: Store):
        self.store = store
        self.currency = store.settings()['currency']
        self.matches = {r['printing_key']: r for r in store.rows('SELECT * FROM matches')}
        self.cards = {}
        self.fetched = {}
        self.names = {}
        for row in store.rows('SELECT * FROM cards'):
            card = json.loads(row['payload'])
            self.cards[row['id']] = card
            self.fetched[row['id']] = row['fetched_at']
            for name in aliases(card):
                self.names[name] = card
        self.holdings = store.rows('SELECT * FROM holdings ORDER BY id')
        for h in self.holdings:
            card = self.card_for_printing(h['printing_key'])
            h['identity'] = self.identity(h['name'], card)
            h['canonical_name'] = card['name'] if card else h['name']
        self.holdings_by_identity = defaultdict(list)
        for h in self.holdings:
            self.holdings_by_identity[h['identity']].append(h)
        self._allocation_cache = {}
        self.decks = store.rows('SELECT * FROM decks ORDER BY priority,id')
        self.entries = store.rows('SELECT * FROM entries ORDER BY id')
        for e in self.entries:
            card = self.card_for_printing(e['printing_key']) if e['printing_key'] else self.names.get(normalized(e['name']))
            e['identity'] = self.identity(e['name'], card)
            e['canonical_name'] = card['name'] if card else e['name']
            e['card'] = card

    def card_for_printing(self, key):
        match = self.matches.get(key)
        return self.cards.get(match['card_id']) if match and match['status'] == 'matched' else None

    def identity(self, name: str, card=None):
        card = card or self.names.get(normalized(name))
        return f'oracle:{card["oracle_id"]}' if card and card.get('oracle_id') else f'name:{normalized(card["name"] if card else name)}'

    def compatible(self, entry, holding):
        if entry['identity'] != holding['identity']:
            return False
        if not entry['printing_key']:
            return True
        return self.effective_printing(entry['printing_key']) == self.effective_printing(holding['printing_key'])

    def effective_printing(self, key):
        card = self.card_for_printing(key)
        return printing_key(card['set'], card['collector_number']) if card else key

    def unit_price(self, h):
        card = self.card_for_printing(h['printing_key'])
        if not card:
            return None
        field = ('eur' if self.currency == 'EUR' else 'usd') + ('_foil' if h['finish'] == 'foil' else '')
        return amount(card.get('prices', {}).get(field))

    def estimate(self, entry):
        prices = [p for h in self.holdings if self.compatible(entry, h) and (p := self.unit_price(h)) is not None]
        if entry.get('card'):
            card = entry['card']
            for field in (('eur', 'eur_foil') if self.currency == 'EUR' else ('usd', 'usd_foil', 'usd_etched')):
                if (p := amount(card.get('prices', {}).get(field))) is not None:
                    prices.append(p)
        return min(prices) if prices else None

    def allocate(self, deck_ids: set[int], entries=None):
        cache_key = tuple(sorted(deck_ids))
        if entries is None and cache_key in self._allocation_cache:
            return self._allocation_cache[cache_key]
        cacheable = entries is None
        entries = [e for e in (entries if entries is not None else self.entries) if e['deck_id'] in deck_ids]
        remaining = {h['id']: h['quantity'] for h in self.holdings}
        allocation = defaultdict(list)
        decks = {d['id']: d for d in self.decks}
        # Allocate exact printings first, so a flexible target cannot consume a scarce edition.
        for e in sorted(entries, key=lambda e: (not bool(e['printing_key']), decks[e['deck_id']]['priority'], e['deck_id'], e['id'])):
            needed = e['quantity']
            preferred = sorted(self.holdings_by_identity[e['identity']], key=lambda h: (h['deck_label'] != (decks[e['deck_id']]['source_label'] or decks[e['deck_id']]['name']), h['id']))
            for h in preferred:
                if needed == 0:
                    break
                if self.compatible(e, h):
                    take = min(needed, remaining[h['id']])
                    if take:
                        allocation[e['id']].append((h['id'], take))
                        remaining[h['id']] -= take
                        needed -= take
        if cacheable:
            self._allocation_cache[cache_key] = allocation
        return allocation

    def collection(self):
        grouped = {}
        for h in self.holdings:
            key = (h['printing_key'], normalized(h['name']))
            if key not in grouped:
                match = self.matches.get(h['printing_key'], {})
                card = self.card_for_printing(h['printing_key'])
                image = card.get('image_uris', {}).get('normal') if card else None
                if card and not image:
                    image = next((f.get('image_uris', {}).get('normal') for f in card.get('card_faces', []) if f.get('image_uris')), None)
                grouped[key] = {
                    'key': '|'.join(key), 'printing_key': h['printing_key'], 'name': h['canonical_name'],
                    'card_type': card.get('type_line', h['card_type']) if card else h['card_type'],
                    'color': h['color'], 'rarity': h['rarity'], 'set_code': h['set_code'],
                    'collector_number': h['collector_number'], 'nonfoil': 0, 'foil': 0,
                    'quantity': 0, 'value': Decimal(0), 'priced_copies': 0,
                    'prices': {'nonfoil': None, 'foil': None}, 'decks': set(), 'notes': set(), 'source_rows': set(),
                    'match_status': match.get('status', 'unresolved'), 'match_message': match.get('message', ''),
                    'image_url': image, 'scryfall_url': card.get('scryfall_uri') if card else None,
                    'oracle_text': card.get('oracle_text') or '\n\n'.join(f.get('oracle_text', '') for f in card.get('card_faces', [])) if card else '',
                    'mana_cost': card.get('mana_cost', '') if card else '', 'fetched_at': self.fetched.get(card['id']) if card else None,
                }
            item = grouped[key]
            item[h['finish']] += h['quantity']
            item['quantity'] += h['quantity']
            price = self.unit_price(h)
            if price is not None:
                item['prices'][h['finish']] = float(price)
                item['value'] += price * h['quantity']
                item['priced_copies'] += h['quantity']
            if h['deck_label']:
                item['decks'].add(h['deck_label'])
            if h['notes']:
                item['notes'].add(h['notes'])
            item['source_rows'].add(h['source_row'])
        for item in grouped.values():
            item['value'] = float(item['value']) if item['priced_copies'] else None
            for field in ('decks', 'notes', 'source_rows'):
                item[field] = sorted(item[field])
        return sorted(grouped.values(), key=lambda i: i['name'].casefold())

    def warnings(self, deck, entries):
        warnings = []
        total = sum(e['quantity'] for e in entries if e['zone'] != 'sideboard')
        if deck['seeded']:
            warnings.append('Started from your workbook assignments. Review and save the intended decklist, including unowned cards.')
        if deck['format'] == 'commander':
            if total != 100:
                warnings.append(f'This list contains {total} cards outside the sideboard; a typical Commander deck has 100.')
            commanders = [e for e in entries if e['zone'] == 'commander']
            if not commanders:
                warnings.append('No commander is designated. Add a Commander section to your decklist.')
            else:
                ci = {c for e in commanders if e['card'] for c in e['card'].get('color_identity', [])}
                if all(e['card'] for e in commanders):
                    outside = [e['canonical_name'] for e in entries if e['card'] and not set(e['card'].get('color_identity', [])).issubset(ci)]
                    if outside:
                        warnings.append('Outside commander color identity: ' + ', '.join(dict.fromkeys(outside)))
                if sum(e['quantity'] for e in commanders) > 1:
                    warnings.append('Multiple commanders require a compatible pairing; review partner/background rules manually.')
        elif total < 60:
            warnings.append(f'Main deck has {total} cards; a typical 60-card format requires at least 60.')
        grouped = defaultdict(list)
        for e in entries:
            grouped[e['identity']].append(e)
        for group in grouped.values():
            e = group[0]
            n = sum(x['quantity'] for x in group)
            card = e['card']
            type_line = card.get('type_line', '') if card else ''
            text = card.get('oracle_text', '') if card else ''
            basic = ('Basic' in type_line and 'Land' in type_line) or e['name'] in {'Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Snow-Covered Plains', 'Snow-Covered Island', 'Snow-Covered Swamp', 'Snow-Covered Mountain', 'Snow-Covered Forest'}
            exception = bool(re.search(r'a deck can have (any number|up to)', text, flags=re.I))
            limit = 1 if deck['format'] == 'commander' else 4
            if n > limit and not basic and not exception:
                warnings.append(f'{e["canonical_name"]}: {n} copies exceed the usual {limit}-copy limit. Check any card-specific exception.')
            if card and deck['format'] != 'casual60' and card.get('legalities', {}).get(deck['format']) in {'banned', 'not_legal'}:
                warnings.append(f'{e["canonical_name"]} is {card["legalities"][deck["format"]].replace("_", " ")} in {deck["format"]}.')
            if card and deck['format'] != 'casual60' and card.get('legalities', {}).get(deck['format']) == 'restricted' and n > 1:
                warnings.append(f'{e["canonical_name"]} is restricted to one copy in {deck["format"]}.')
        unresolved = sum(e['quantity'] for e in entries if not e['card'])
        if unresolved:
            warnings.append(f'Rules and legality metadata are unavailable for {unresolved} card copies. Format checks are incomplete.')
        return warnings

    def deck(self, deck_id: int):
        deck = next((dict(d) for d in self.decks if d['id'] == deck_id), None)
        if not deck:
            raise ValueError('Deck not found.')
        entries = [e for e in self.entries if e['deck_id'] == deck_id]
        own = self.allocate({deck_id})
        active = {d['id'] for d in self.decks if d['active']} | {deck_id}
        allocated = self.allocate(active)
        held_elsewhere = Counter()
        for e in self.entries:
            if e['deck_id'] != deck_id:
                held_elsewhere.update(dict(allocated[e['id']]))
        rows = []
        for e in entries:
            compatible = [h for h in self.holdings if self.compatible(e, h)]
            owned = sum(h['quantity'] for h in compatible)
            other = sum(held_elsewhere[h['id']] for h in compatible)
            coverage = sum(q for _, q in own[e['id']])
            assigned = sum(q for _, q in allocated[e['id']])
            price = self.estimate(e)
            rows.append({k: e[k] for k in ('id', 'quantity', 'zone', 'printing_key')} | {
                'name': e['canonical_name'], 'owned': owned, 'available': owned - other,
                'in_other_decks': other, 'covered': coverage, 'assigned': assigned,
                'missing': e['quantity'] - coverage, 'missing_now': e['quantity'] - assigned,
                'estimate': float(price) if price is not None else None,
            })
        lines = []
        for zone in ('commander', 'main', 'sideboard'):
            section = [e for e in entries if e['zone'] == zone]
            if section:
                if lines:
                    lines.append('')
                lines.append({'commander': 'Commander', 'main': 'Deck', 'sideboard': 'Sideboard'}[zone])
                for e in section:
                    suffix = f' ({e["printing_key"].split(":")[0].upper()}) {e["printing_key"].split(":", 1)[1]}' if e['printing_key'] else ''
                    lines.append(f'{e["quantity"]} {e["name"]}{suffix}')
        return deck | {'entries': rows, 'decklist': '\n'.join(lines), 'warnings': self.warnings(deck, entries),
                       'total': sum(e['quantity'] for e in entries), 'covered': sum(e['covered'] for e in rows),
                       'missing': sum(e['missing'] for e in rows), 'missing_now': sum(e['missing_now'] for e in rows)}

    def wishlist(self, deck_ids: set[int], mode='assembled'):
        if mode not in {'assembled', 'shared'}:
            raise ValueError('Choose assembled or shared decks.')
        entries = [e for e in self.entries if e['deck_id'] in deck_ids]
        rows = []
        if mode == 'assembled':
            allocation = self.allocate(deck_ids)
            groups = defaultdict(list)
            for e in entries:
                shortage = e['quantity'] - sum(q for _, q in allocation[e['id']])
                if shortage:
                    groups[(e['identity'], e['printing_key'])].append((e, shortage))
            for (identity, key), group in groups.items():
                rows.append(self.wish_row(group[0][0], sum(n for _, n in group), {e['deck_id'] for e, _ in group}))
        else:
            # Sharing needs the maximum total demand per card across decks, while
            # every explicitly requested edition must meet its own maximum demand.
            groups = defaultdict(list)
            for e in entries:
                groups[e['identity']].append(e)
            for identity, group in groups.items():
                totals = Counter()
                exact_by_deck = defaultdict(Counter)
                for e in group:
                    totals[e['deck_id']] += e['quantity']
                    if e['printing_key']:
                        exact_by_deck[self.effective_printing(e['printing_key'])][e['deck_id']] += e['quantity']
                owned = Counter()
                for h in self.holdings:
                    if h['identity'] == identity:
                        owned[self.effective_printing(h['printing_key'])] += h['quantity']
                minima = {key: max(counter.values()) for key, counter in exact_by_deck.items()}
                exact_shortages = 0
                for key, need in minima.items():
                    missing = max(0, need - owned[key])
                    if missing:
                        e = next(e for e in group if e['printing_key'] and self.effective_printing(e['printing_key']) == key)
                        rows.append(self.wish_row(e, missing, set(exact_by_deck[key])))
                        exact_shortages += missing
                extra = max(0, max(totals.values()) - (sum(owned.values()) + exact_shortages))
                if extra:
                    e = next((e for e in group if not e['printing_key']), group[0]).copy()
                    e['printing_key'] = None
                    rows.append(self.wish_row(e, extra, set(totals)))
        known = sum(Decimal(str(r['estimate'])) * r['quantity'] for r in rows if r['estimate'] is not None)
        return {'items': sorted(rows, key=lambda r: r['name'].casefold()), 'mode': mode,
                'copies': sum(r['quantity'] for r in rows), 'estimate': float(known),
                'priced_copies': sum(r['quantity'] for r in rows if r['estimate'] is not None)}

    def wish_row(self, entry, quantity, deck_ids):
        price = self.estimate(entry)
        return {'name': entry['canonical_name'], 'printing_key': entry['printing_key'], 'quantity': quantity,
                'decks': [d['name'] for d in self.decks if d['id'] in deck_ids],
                'estimate': float(price) if price is not None else None}


def text_export(rows: list[dict]) -> str:
    counts = Counter()
    for row in rows:
        if row['quantity'] > 0:
            counts[row['name']] += row['quantity']
    return '\n'.join(f'{n} {name}' for name, n in sorted(counts.items(), key=lambda x: x[0].casefold())) + ('\n' if counts else '')
