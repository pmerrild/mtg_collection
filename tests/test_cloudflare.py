from __future__ import annotations

import json
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / 'cloudflare' / 'migrations').glob('*.sql'))


class CloudflareSchemaTest(unittest.TestCase):
    def test_initial_migration_creates_app_tables_and_defaults(self):
        with sqlite3.connect(':memory:') as db:
            for migration in MIGRATIONS:
                db.executescript(migration.read_text())
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({'settings', 'imports', 'holdings', 'issues', 'cards',
                             'matches', 'decks', 'entries', 'oauth_states',
                             'onedrive_connection'}.issubset(tables))
            settings = dict(db.execute('SELECT key, value FROM settings'))

        self.assertEqual(json.loads(settings['currency']), 'EUR')
        self.assertEqual(json.loads(settings['foil_mode']), 'total')
        self.assertIsNone(json.loads(settings['workbook_item_id']))


if __name__ == '__main__':
    unittest.main()