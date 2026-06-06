PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  instagram_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  account_type TEXT,
  access_token_encrypted TEXT NOT NULL,
  token_expires_at TEXT,
  token_last_refreshed_at TEXT,
  token_last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instagram_media_id TEXT NOT NULL UNIQUE,
  caption TEXT,
  media_type TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  permalink TEXT,
  timestamp TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id),
  name TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'contains_any' CHECK (match_mode IN ('contains_any')),
  keyword_text TEXT NOT NULL,
  reply_message TEXT NOT NULL,
  dm_failure_reply_message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS comment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instagram_comment_id TEXT NOT NULL UNIQUE,
  media_id INTEGER NOT NULL REFERENCES media(id),
  commenter_id TEXT,
  commenter_username TEXT,
  comment_text TEXT NOT NULL,
  instagram_created_at TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS reply_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES automation_rules(id),
  comment_event_id INTEGER NOT NULL REFERENCES comment_events(id),
  instagram_comment_id TEXT NOT NULL,
  dm_status TEXT NOT NULL CHECK (dm_status IN ('sent', 'failed', 'skipped')),
  comment_like_status TEXT NOT NULL CHECK (comment_like_status IN ('sent', 'failed', 'skipped')),
  fallback_reply_status TEXT NOT NULL CHECK (fallback_reply_status IN ('sent', 'failed', 'skipped')),
  fallback_reply_comment_id TEXT,
  request_payload_json TEXT NOT NULL,
  response_payload_json TEXT NOT NULL,
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(rule_id, instagram_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_media_instagram_media_id ON media(instagram_media_id);
CREATE INDEX IF NOT EXISTS idx_media_timestamp ON media(timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_rules_media_active ON automation_rules(media_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_comment_events_media ON comment_events(media_id);
CREATE INDEX IF NOT EXISTS idx_reply_logs_rule_comment ON reply_logs(rule_id, instagram_comment_id);
CREATE INDEX IF NOT EXISTS idx_reply_logs_created_at ON reply_logs(created_at DESC, id DESC);
