-- 0003_refresh_history.sql — make refresh-token reuse detectable.
--
-- 0002 added `refresh_token_reuse_events`, but detection is impossible without
-- keeping the *retired* digests: `sessions.refresh_token_hash` is overwritten on
-- every rotation, so a stolen-but-since-rotated token simply looks "unknown" and
-- the reuse is silently treated as an invalid token.
--
-- This table keeps the chain of retired digests per session. It holds digests
-- only (HMAC-SHA256 hex), never a usable token, and rows are pruned 90 days
-- after retirement — well past every refresh lifetime.

CREATE TABLE refresh_token_history (
  token_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  retired_at INTEGER NOT NULL
);

CREATE INDEX idx_refresh_history_session ON refresh_token_history (session_id, retired_at DESC);
CREATE INDEX idx_refresh_history_user    ON refresh_token_history (user_id, retired_at DESC);
