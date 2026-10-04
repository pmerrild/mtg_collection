CREATE TABLE IF NOT EXISTS onedrive_workbook (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    drive_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    relative_path TEXT NOT NULL,
    selected_at TEXT NOT NULL,
    UNIQUE(drive_id, item_id)
);