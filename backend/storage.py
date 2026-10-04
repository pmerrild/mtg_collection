from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Store:
    def __init__(self, directory: Path | None = None):
        self.directory = directory or Path(os.environ.get('MTG_DATA_DIR', ROOT / 'data'))
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'vault.sqlite3'
        with self.connection() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS imports (
                    id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL, created_at TEXT NOT NULL,
                    source TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS holdings (
                    id INTEGER PRIMARY KEY, source_row INTEGER NOT NULL, name TEXT NOT NULL,
                    card_type TEXT NOT NULL, color TEXT NOT NULL, rarity TEXT NOT NULL,
                    set_code TEXT NOT NULL, collector_number TEXT NOT NULL, printing_key TEXT NOT NULL,
                    quantity INTEGER NOT NULL CHECK(quantity > 0), finish TEXT NOT NULL,
                    notes TEXT NOT NULL, deck_label TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS holdings_printing ON holdings(printing_key);
                CREATE TABLE IF NOT EXISTS issues (
                    id INTEGER PRIMARY KEY, source_row INTEGER NOT NULL,
                    name TEXT NOT NULL, message TEXT NOT NULL, raw TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cards (
                    id TEXT PRIMARY KEY, oracle_id TEXT, name TEXT NOT NULL,
                    set_code TEXT NOT NULL, collector_number TEXT NOT NULL,
                    fetched_at TEXT NOT NULL, payload TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS matches (
                    printing_key TEXT PRIMARY KEY, card_id TEXT,
                    status TEXT NOT NULL, message TEXT NOT NULL DEFAULT '',
                    candidate_id TEXT, checked_at TEXT,
                    FOREIGN KEY(card_id) REFERENCES cards(id)
                );
                CREATE TABLE IF NOT EXISTS decks (
                    id INTEGER PRIMARY KEY, name TEXT NOT NULL, format TEXT NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 0,
                    source_label TEXT UNIQUE, seeded INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS entries (
                    id INTEGER PRIMARY KEY, deck_id INTEGER NOT NULL,
                    name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
                    zone TEXT NOT NULL DEFAULT 'main', printing_key TEXT,
                    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
                );
            ''')
            defaults = {
                'workbook_path': str(ROOT / 'sample-inventory.xlsx'),
                'foil_mode': 'total', 'currency': 'EUR', 'auto_watch': True,
                'last_import_error': '', 'last_price_success': None,
                'seeded_deck_labels': [],
            }
            for key, value in defaults.items():
                db.execute('INSERT OR IGNORE INTO settings VALUES (?, ?)', (key, json.dumps(value)))

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def settings(self) -> dict:
        with self.connection() as db:
            return {r['key']: json.loads(r['value']) for r in db.execute('SELECT * FROM settings')}

    def set_settings(self, values: dict):
        with self.connection() as db:
            for key, value in values.items():
                db.execute('INSERT OR REPLACE INTO settings VALUES (?, ?)', (key, json.dumps(value)))

    def rows(self, sql: str, params=()) -> list[dict]:
        with self.connection() as db:
            return [dict(r) for r in db.execute(sql, params)]

    def backup(self) -> Path:
        target = self.directory / 'backups' / f'vault-{datetime.now().strftime("%Y%m%d-%H%M%S-%f")}.sqlite3'
        target.parent.mkdir(exist_ok=True)
        with sqlite3.connect(target) as destination, self.connection() as source:
            source.backup(destination)
        return target

    def save_card(self, card: dict, db=None):
        def save(connection):
            connection.execute('''INSERT OR REPLACE INTO cards
                (id, oracle_id, name, set_code, collector_number, fetched_at, payload)
                VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (card['id'], card.get('oracle_id'), card['name'], card['set'],
                 str(card['collector_number']), now(), json.dumps(card)))
        if db is not None:
            save(db)
        else:
            with self.connection() as connection:
                save(connection)
