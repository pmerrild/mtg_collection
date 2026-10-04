CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holdings (
    id INTEGER PRIMARY KEY,
    source_row INTEGER NOT NULL,
    name TEXT NOT NULL,
    card_type TEXT NOT NULL,
    color TEXT NOT NULL,
    rarity TEXT NOT NULL,
    set_code TEXT NOT NULL,
    collector_number TEXT NOT NULL,
    printing_key TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    finish TEXT NOT NULL,
    notes TEXT NOT NULL,
    deck_label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS holdings_printing ON holdings(printing_key);

CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY,
    source_row INTEGER NOT NULL,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    raw TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    oracle_id TEXT,
    name TEXT NOT NULL,
    set_code TEXT NOT NULL,
    collector_number TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    printing_key TEXT PRIMARY KEY,
    card_id TEXT,
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    candidate_id TEXT,
    checked_at TEXT,
    FOREIGN KEY(card_id) REFERENCES cards(id)
);

CREATE TABLE IF NOT EXISTS decks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    format TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    source_label TEXT UNIQUE,
    seeded INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    deck_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    zone TEXT NOT NULL DEFAULT 'main',
    printing_key TEXT,
    FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('foil_mode', '"total"'),
    ('currency', '"EUR"'),
    ('auto_watch', 'false'),
    ('last_import_error', '""'),
    ('last_price_success', 'null'),
    ('seeded_deck_labels', '[]'),
    ('workbook_item_id', 'null');