PRAGMA foreign_keys = ON;

-- Secure Vault for KLIZONION authentication state.
-- Never store plaintext passwords, verification codes, or bearer tokens here.

CREATE TABLE IF NOT EXISTS vault_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vault_users_email
  ON vault_users(email);

CREATE INDEX IF NOT EXISTS idx_vault_users_username
  ON vault_users(username);

CREATE TABLE IF NOT EXISTS vault_verification_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_vault_verification_email
  ON vault_verification_sessions(email);

CREATE INDEX IF NOT EXISTS idx_vault_verification_expiry
  ON vault_verification_sessions(expires_at);

CREATE TABLE IF NOT EXISTS vault_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES vault_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_auth_sessions_user
  ON vault_auth_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_vault_auth_sessions_expiry
  ON vault_auth_sessions(expires_at);
