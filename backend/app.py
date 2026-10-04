from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import threading
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .domain import Inventory, save_deck, text_export
from .importer import apply_import, stage_import
from .scryfall import Scryfall
from .storage import ROOT, Store


class ImportRequest(BaseModel):
    path: str | None = None
    foil_mode: str | None = None


class DeckRequest(BaseModel):
    name: str
    format: str = 'casual60'
    active: bool = True
    decklist: str = ''


class MatchRequest(BaseModel):
    printing_key: str
    card_id: str


def create_app(store: Store | None = None, scryfall: Scryfall | None = None, background=True):
    store = store or Store()
    scryfall = scryfall or Scryfall(store)
    import_lock = threading.Lock()

    def refresh_import(path=None, foil_mode=None, approve=False):
        with import_lock:
            result = stage_import(store, path or store.settings()['workbook_path'], foil_mode)
            if result.get('unchanged') and path:
                store.set_settings({'workbook_path': str(Path(path).expanduser().resolve())})
            if not result.get('unchanged') and (not result['reductions'] or approve):
                result['applied'] = apply_import(store, result['id'])
            return result

    async def watcher():
        previous = None
        stable = None
        last_prices = 0
        while True:
            try:
                settings = store.settings()
                path = Path(settings['workbook_path']).expanduser()
                if settings['auto_watch']:
                    stat = path.stat()
                    stamp = (str(path), stat.st_size, stat.st_mtime_ns, settings['foil_mode'])
                    if stamp != previous:
                        if stamp == stable:
                            await asyncio.to_thread(refresh_import)
                            store.set_settings({'last_import_error': ''})
                            previous = stamp
                            stable = None
                        else:
                            stable = stamp
                if asyncio.get_running_loop().time() - last_prices > 3600:
                    successful = settings.get('last_price_success')
                    if not successful or datetime.fromisoformat(successful) < datetime.now(timezone.utc) - timedelta(days=1):
                        scryfall.start()
                    last_prices = asyncio.get_running_loop().time()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                store.set_settings({'last_import_error': str(exc)})
            await asyncio.sleep(2)

    @asynccontextmanager
    async def lifespan(app):
        try:
            await asyncio.to_thread(refresh_import)
        except Exception as exc:
            store.set_settings({'last_import_error': str(exc)})
        task = asyncio.create_task(watcher()) if background else None
        yield
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    app = FastAPI(title='MTG Vault', lifespan=lifespan)
    app.state.store = store
    app.state.scryfall = scryfall
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=['127.0.0.1', 'localhost', '[::1]', 'testserver'])

    @app.middleware('http')
    async def local_origin(request: Request, call_next):
        if request.method not in {'GET', 'HEAD', 'OPTIONS'}:
            origin = request.headers.get('origin')
            if origin:
                from urllib.parse import urlparse
                parsed = urlparse(origin)
                if parsed.scheme not in {'http', 'https'} or parsed.netloc != request.headers.get('host'):
                    return JSONResponse({'detail': 'Requests must come from this local app.'}, status_code=403)
        response = await call_next(request)
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api/') else 'no-cache'
        return response

    @app.exception_handler(ValueError)
    async def value_error(request: Request, exc: ValueError):
        return JSONResponse({'detail': str(exc)}, status_code=400)

    @app.get('/api/state')
    def state():
        settings = store.settings()
        inventory = Inventory(store)
        collection = inventory.collection()
        latest = store.rows("SELECT id,created_at,source FROM imports WHERE status='applied' ORDER BY id DESC LIMIT 1")
        pending = store.rows("SELECT id,created_at,source,payload FROM imports WHERE status='pending' ORDER BY id DESC LIMIT 1")
        preview = None
        if pending:
            payload = json.loads(pending[0]['payload'])
            preview = {k: pending[0][k] for k in ('id', 'created_at', 'source')} | {k: payload[k] for k in ('rows', 'copies', 'reductions')}
        return {'settings': settings, 'last_import': latest[0] if latest else None, 'pending_import': preview,
                'summary': {'copies': sum(c['quantity'] for c in collection),
                    'unique_cards': len({h['identity'] for h in inventory.holdings}), 'printings': len(collection),
                    'foil_copies': sum(c['foil'] for c in collection),
                    'value': sum(c['value'] or 0 for c in collection), 'priced_copies': sum(c['priced_copies'] for c in collection),
                    'unresolved': sum(c['match_status'] != 'matched' for c in collection),
                    'issues': len(store.rows('SELECT id FROM issues'))},
                'price_job': dict(scryfall.state), 'decks': [inventory.deck(d['id']) for d in inventory.decks]}

    @app.get('/api/collection')
    def collection():
        return Inventory(store).collection()

    @app.get('/api/issues')
    def issues():
        invalid = store.rows('SELECT * FROM issues ORDER BY source_row')
        for issue in invalid:
            issue['raw'] = json.loads(issue['raw'])
        matches = store.rows("""SELECT m.*, GROUP_CONCAT(DISTINCT h.name) AS name,
            GROUP_CONCAT(DISTINCT h.source_row) AS source_rows FROM matches m
            JOIN holdings h ON m.printing_key=h.printing_key WHERE m.status<>'matched'
            GROUP BY m.printing_key ORDER BY name""")
        return {'rows': invalid, 'matches': matches,
                'history': store.rows('SELECT id,created_at,source,status FROM imports ORDER BY id DESC LIMIT 15')}

    @app.post('/api/import')
    def import_file(data: ImportRequest):
        try:
            result = refresh_import(data.path, data.foil_mode)
            store.set_settings({'last_import_error': ''})
            return result
        except (OSError, ValueError) as exc:
            store.set_settings({'last_import_error': str(exc)})
            raise ValueError(str(exc)) from None

    @app.post('/api/import/{import_id}/apply')
    def accept_import(import_id: int):
        with import_lock:
            return apply_import(store, import_id)

    @app.post('/api/import/{import_id}/dismiss')
    def dismiss_import(import_id: int):
        with store.connection() as db:
            db.execute("UPDATE imports SET status='dismissed' WHERE id=? AND status='pending'", (import_id,))
        return {'dismissed': True}

    @app.post('/api/upload')
    async def upload(request: Request):
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 32 * 1024 * 1024:
                raise HTTPException(413, 'Workbook exceeds 32 MB.')
        directory = store.directory / 'uploads'
        directory.mkdir(exist_ok=True)
        target = directory / f'inventory-{uuid.uuid4().hex}.xlsx'
        target.write_bytes(raw)
        try:
            return await asyncio.to_thread(refresh_import, str(target))
        except Exception:
            target.unlink(missing_ok=True)
            raise ValueError('Could not read this workbook. Upload a valid .xlsx file with an Input worksheet.') from None

    @app.patch('/api/settings')
    def settings(data: dict):
        allowed = {'workbook_path', 'currency', 'auto_watch', 'foil_mode'}
        values = {key: value for key, value in data.items() if key in allowed}
        if 'currency' in values and values['currency'] not in {'EUR', 'USD'}:
            raise ValueError('Currency must be EUR or USD.')
        if 'foil_mode' in values and values['foil_mode'] not in {'total', 'additional', 'flag'}:
            raise ValueError('Choose a valid foil convention.')
        if 'auto_watch' in values and not isinstance(values['auto_watch'], bool):
            raise ValueError('Automatic watching must be true or false.')
        if 'workbook_path' in values:
            if not isinstance(values['workbook_path'], str):
                raise ValueError('Workbook path must be text.')
            path = Path(values['workbook_path']).expanduser().resolve()
            if not path.is_file() or path.suffix.lower() != '.xlsx':
                raise ValueError('Workbook path must point to an existing .xlsx file.')
            values['workbook_path'] = str(path)
        store.set_settings(values)
        return store.settings()

    @app.post('/api/decks')
    def create_deck(data: DeckRequest):
        return {'id': save_deck(store, data.model_dump())}

    @app.put('/api/decks/{deck_id}')
    def update_deck(deck_id: int, data: DeckRequest):
        return {'id': save_deck(store, data.model_dump(), deck_id)}

    @app.delete('/api/decks/{deck_id}')
    def delete_deck(deck_id: int):
        store.backup()
        with store.connection() as db:
            db.execute('DELETE FROM decks WHERE id=?', (deck_id,))
        return {'deleted': True}

    @app.post('/api/decks/{deck_id}/active')
    def activate(deck_id: int, data: dict):
        if not isinstance(data.get('active'), bool):
            raise ValueError('Active must be true or false.')
        with store.connection() as db:
            db.execute('UPDATE decks SET active=? WHERE id=?', (int(data['active']), deck_id))
        return {'updated': True}

    @app.get('/api/wishlist')
    def wishlist(deck_ids: str = '', mode: str = 'assembled'):
        try:
            ids = {int(x) for x in deck_ids.split(',') if x}
        except ValueError:
            raise ValueError('Invalid deck selection.') from None
        return Inventory(store).wishlist(ids, mode)

    @app.post('/api/prices/refresh')
    def refresh_prices(force: bool = False):
        return scryfall.start(force)

    @app.get('/api/cards/search')
    def search_cards(q: str):
        return scryfall.search(q)

    @app.post('/api/matches/confirm')
    def confirm_match(data: MatchRequest):
        try:
            uuid.UUID(data.card_id)
        except ValueError:
            raise ValueError('Choose a valid Scryfall card.') from None
        if not store.rows('SELECT printing_key FROM matches WHERE printing_key=?', (data.printing_key,)):
            raise ValueError('Printing not found in this collection.')
        return scryfall.confirm(data.printing_key, data.card_id)

    @app.get('/api/export')
    def export(kind='collection', deck_id: int | None = None, deck_ids='', mode='assembled', zone='all', format='txt', q=''):
        inventory = Inventory(store)
        if kind == 'collection':
            rows = [c for c in inventory.collection() if q.casefold() in c['name'].casefold()]
            filename = 'collection'
        elif kind == 'deck' and deck_id is not None:
            deck = inventory.deck(deck_id)
            rows = [e for e in deck['entries'] if zone == 'all' or e['zone'] == zone]
            filename = 'deck'
        elif kind == 'missing':
            rows = inventory.wishlist({int(x) for x in deck_ids.split(',') if x}, mode)['items']
            filename = 'missing-cards'
        else:
            raise ValueError('Choose a collection, deck, or missing-card export.')
        if format == 'txt':
            content = text_export(rows)
            media = 'text/plain'
        elif format == 'csv':
            columns = ['name', 'quantity', 'printing_key', 'nonfoil', 'foil', 'zone', 'decks', 'notes', 'source_rows', 'value', 'priced_copies', 'fetched_at']
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow(columns)
            for row in rows:
                values = []
                for key in columns:
                    value = row.get(key, '')
                    if isinstance(value, list):
                        value = '; '.join(map(str, value))
                    # Avoid formula execution when a CSV is opened in Excel.
                    if isinstance(value, str) and value.startswith(('=', '+', '-', '@')):
                        value = "'" + value
                    values.append(value)
                writer.writerow(values)
            content, media = '\ufeff' + out.getvalue(), 'text/csv'
        else:
            raise ValueError('Export format must be txt or csv.')
        return Response(content, media_type=media, headers={'Content-Disposition': f'attachment; filename="{filename}.{format}"'})

    @app.get('/api/backup')
    def backup():
        path = store.backup()
        return FileResponse(path, filename=path.name, media_type='application/vnd.sqlite3')

    static = ROOT / 'frontend' / 'dist'
    if static.is_dir():
        app.mount('/', StaticFiles(directory=static, html=True), name='frontend')
    else:
        @app.get('/')
        def build_needed():
            return JSONResponse({'message': 'Build the frontend with npm run build in frontend, or run its development server.'})
    return app


app = create_app()
