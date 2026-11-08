-- 0002_hardening.sql — tables added by design review round 1.
--
-- D1  refresh-token reuse telemetry: a rotated token presented again is an
--     attack signal. 0001_init.sql revokes every session when it happens, but
--     without a durable row the signal is lost at the next restart — exactly
--     when an operator is trying to answer "was that a real compromise or a
--     stale desktop install?".
-- D2  role/permission change history: the console's audit list links to a
--     target that may since have been deleted, so the before/after diff of a
--     permission matrix needs its own row that survives role deletion.
-- D3  email lookup index: login accepts the email as the identifier, so the
--     UNIQUE index on `email_normalized` is already the access path; the extra
--     index covers the console's LIKE-prefix search on the non-normalized copy
--     without forcing a table scan.
-- D4  session revocation reason enum is enforced in code (`REVOKE_REASON`), not
--     in SQL, because SQLite cannot add a CHECK constraint without a rebuild.

CREATE TABLE refresh_token_reuse_events (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  presented_at INTEGER NOT NULL,
  ip           TEXT NOT NULL DEFAULT '',
  user_agent   TEXT NOT NULL DEFAULT '',
  action_taken TEXT NOT NULL DEFAULT 'revoke_all_sessions'
);

CREATE INDEX idx_reuse_user ON refresh_token_reuse_events (user_id, presented_at DESC);

CREATE TABLE role_change_events (
  id          TEXT PRIMARY KEY,
  role_id     TEXT NOT NULL,
  role_key    TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  changed_at  INTEGER NOT NULL,
  before_json TEXT NOT NULL DEFAULT '[]',
  after_json  TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_role_change_role ON role_change_events (role_id, changed_at DESC);

CREATE INDEX idx_users_email ON users (email);
