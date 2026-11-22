CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  config_json TEXT NOT NULL,
  seats_json TEXT NOT NULL,
  narrator_json TEXT,
  state_json TEXT NOT NULL,
  winner_json TEXT,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_matches_workspace_updated
  ON matches (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS match_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  public_json TEXT NOT NULL,
  sealed_json TEXT,
  revealed INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_match_events_match_seq
  ON match_events (match_id, seq ASC);

CREATE TABLE IF NOT EXISTS ratings (
  workspace_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  cli TEXT NOT NULL DEFAULT '',
  rating REAL NOT NULL DEFAULT 1500,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  stats_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, actor_id)
);

CREATE TABLE IF NOT EXISTS replays (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  game TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  seed_commit TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_replays_workspace_created
  ON replays (workspace_id, created_at DESC);
