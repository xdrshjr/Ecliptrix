-- 0001_init.sql — base schema for the Ecliptrix account server.
--
-- Conventions shared with the root project (CLAUDE.md "Database"):
--   * timestamps are INTEGER epoch milliseconds;
--   * migrations are additive only — never DROP;
--   * every statement must run inside the runner's single transaction.

PRAGMA foreign_keys = ON;

-- IF NOT EXISTS: the runner creates this bookkeeping table before it reads the
-- applied set, and the first migration is then a no-op for it.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE roles (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system   INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE role_permissions (
  role_id    TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
) WITHOUT ROWID;

CREATE TABLE users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL,
  email_normalized      TEXT NOT NULL UNIQUE,
  username              TEXT NOT NULL,
  username_normalized   TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  password_hash         TEXT NOT NULL,
  password_updated_at   INTEGER NOT NULL,
  role_id               TEXT NOT NULL REFERENCES roles(id),
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'pending', 'deleted')),
  plan_tag              TEXT NOT NULL DEFAULT 'free',
  must_change_password  INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  email_verified_at     INTEGER,
  avatar_url            TEXT,
  locale                TEXT NOT NULL DEFAULT 'zh-CN',
  timezone              TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  note                  TEXT NOT NULL DEFAULT '',
  last_login_at         INTEGER,
  failed_login_count    INTEGER NOT NULL DEFAULT 0,
  lock_count            INTEGER NOT NULL DEFAULT 0,
  locked_until          INTEGER,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER
);

CREATE INDEX idx_users_status_created ON users (status, created_at DESC);
CREATE INDEX idx_users_role           ON users (role_id);
CREATE INDEX idx_users_last_login     ON users (last_login_at DESC);

CREATE TABLE sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client             TEXT NOT NULL CHECK (client IN ('web', 'desktop')),
  access_token_hash  TEXT NOT NULL UNIQUE,
  refresh_token_hash TEXT UNIQUE,
  device_name        TEXT NOT NULL DEFAULT '',
  platform           TEXT NOT NULL DEFAULT '',
  app_version        TEXT NOT NULL DEFAULT '',
  ip                 TEXT NOT NULL DEFAULT '',
  user_agent         TEXT NOT NULL DEFAULT '',
  created_at         INTEGER NOT NULL,
  last_seen_at       INTEGER NOT NULL,
  access_expires_at  INTEGER NOT NULL,
  refresh_expires_at INTEGER,
  revoked_at         INTEGER,
  revoked_reason     TEXT
);

CREATE INDEX idx_sessions_user   ON sessions (user_id, created_at DESC);
CREATE INDEX idx_sessions_active ON sessions (user_id, revoked_at, access_expires_at);

CREATE TABLE registration_invites (
  id          TEXT PRIMARY KEY,
  code_hash   TEXT NOT NULL UNIQUE,
  code_hint   TEXT NOT NULL,
  -- Nullable + SET NULL: an inviter's hard delete must not be blocked by the
  -- invites they issued, and an invite without an author is still valid history.
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  role_id     TEXT NOT NULL REFERENCES roles(id),
  max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER,
  revoked_at  INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE password_reset_tokens (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_reset_user ON password_reset_tokens (user_id, created_at DESC);

CREATE TABLE login_attempts (
  id                    TEXT PRIMARY KEY,
  identifier_normalized TEXT NOT NULL,
  ip                    TEXT NOT NULL,
  success               INTEGER NOT NULL CHECK (success IN (0, 1)),
  reason                TEXT NOT NULL,
  created_at            INTEGER NOT NULL
);

CREATE INDEX idx_attempts_identifier ON login_attempts (identifier_normalized, created_at DESC);
CREATE INDEX idx_attempts_ip         ON login_attempts (ip, created_at DESC);

CREATE TABLE audit_events (
  id            TEXT PRIMARY KEY,
  -- SET NULL is required, not stylistic: a hard delete of the last reference to a
  -- user would otherwise fail with FOREIGN KEY constraint, making `?hard=true`
  -- unusable for any account that ever performed an action.
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label   TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL DEFAULT '',
  metadata      TEXT NOT NULL DEFAULT '{}',
  ip            TEXT NOT NULL DEFAULT '',
  request_id    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_audit_created ON audit_events (created_at DESC);
CREATE INDEX idx_audit_action  ON audit_events (action, created_at DESC);
CREATE INDEX idx_audit_target  ON audit_events (target_type, target_id);
CREATE INDEX idx_audit_actor   ON audit_events (actor_user_id, created_at DESC);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  -- SET NULL for the same reason as audit_events.actor_user_id: whoever last
  -- saved a setting is a reference, not an owner. Without it `?hard=true` dies
  -- with FOREIGN KEY constraint failed the moment any account ever touched the
  -- settings page, which is every install that was ever administered.
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;
