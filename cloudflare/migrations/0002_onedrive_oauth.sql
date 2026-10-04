CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    code_verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS oauth_states_expiry ON oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS onedrive_connection (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    encrypted_tokens TEXT NOT NULL,
    iv TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    connected_at TEXT NOT NULL
);