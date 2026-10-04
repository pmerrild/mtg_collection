from __future__ import annotations

import json
import sqlite3
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'cloudflare' / 'migrations' / '0001_initial_schema.sql'


class CloudflareSchemaTest(unittest.TestCase):
    def test_initial_migration_creates_app_tables_and_defaults(self):
        with sqlite3.connect(':memory:') as db:
            db.executescript(MIGRATION.read_text())
            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertTrue({'settings', 'imports', 'holdings', 'issues', 'cards',
                             'matches', 'decks', 'entries'}.issubset(tables))
            settings = dict(db.execute('SELECT key, value FROM settings'))

        self.assertEqual(json.loads(settings['currency']), 'EUR')
        self.assertEqual(json.loads(settings['foil_mode']), 'total')
        self.assertIsNone(json.loads(settings['workbook_item_id']))


if __name__ == '__main__':
    unittest.main()