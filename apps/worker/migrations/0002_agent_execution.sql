PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS builder_runners (
  runner_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  hardware_json TEXT NOT NULL DEFAULT '{}',
  last_seen INTEGER NOT NULL,
  connected_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS builder_missions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  effort TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step TEXT NOT NULL,
  workspace_id TEXT,
  runner_id TEXT,
  iteration_count INTEGER NOT NULL DEFAULT 0,
  max_iterations INTEGER NOT NULL DEFAULT 20,
  agent_message TEXT,
  error TEXT,
  evaluation_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES vault_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_builder_missions_user_updated
  ON builder_missions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS builder_actions (
  action_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  runner_id TEXT,
  workspace_id TEXT,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  lease_expires_at INTEGER,
  FOREIGN KEY (mission_id) REFERENCES builder_missions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_builder_actions_pending
  ON builder_actions(status, runner_id, workspace_id, created_at);

CREATE TABLE IF NOT EXISTS builder_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  mission_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (mission_id) REFERENCES builder_missions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_builder_events_mission_created
  ON builder_events(mission_id, created_at);
