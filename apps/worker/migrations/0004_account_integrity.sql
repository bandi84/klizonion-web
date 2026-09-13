PRAGMA foreign_keys = ON;

ALTER TABLE vault_users ADD COLUMN disabled_at INTEGER;
ALTER TABLE vault_users ADD COLUMN disabled_reason TEXT;

CREATE TABLE IF NOT EXISTS vault_security_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  event_type TEXT NOT NULL,
  request_ip TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES vault_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_security_events_user_created
  ON vault_security_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vault_security_events_type_created
  ON vault_security_events(event_type, created_at DESC);
