-- 0005_account_lifecycle.sql — close the account lifecycle: email verification
-- and email change, an auditable mail outbox, and a real (anonymising) deletion
-- with a grace period.
--
-- Additive only: three new tables plus indexes and ONE additive column. No table
-- is rebuilt (the migration iron rule: startup DDL never contains DROP).
--
-- Why the outbox exists even when SMTP is configured: a transactional mail that
-- silently disappears is indistinguishable from a bug, and "did the invite mail
-- go out?" is the first question an operator asks. The row is written BEFORE the
-- send attempt, so a crash mid-send still leaves evidence.
--
-- Tokens are never stored in the outbox: `body_text` stores the rendered message
-- with every `token=`/`invite=` value and every printed invite code replaced by
-- `***` (`mailService.redactTokens`), and `payload` holds only metadata
-- (`{template, toMasked, fields}`) — never a link. Such rows are marked
-- retryable = 0, because a retry cannot replay a redacted secret.

CREATE TABLE email_action_tokens (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose          TEXT NOT NULL CHECK (purpose IN ('verify', 'change_email')),
  -- target address for a change_email confirmation; '' for a plain verification
  email_normalized TEXT NOT NULL DEFAULT '',
  token_hash       TEXT NOT NULL UNIQUE,
  expires_at       INTEGER NOT NULL,
  used_at          INTEGER,
  ip               TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL
);

-- One live token per (user, purpose): issuing a new one consumes the old.
-- The predicate deliberately omits expires_at: an expired-but-unused row would
-- otherwise keep the slot and the next insert would hit SQLITE_CONSTRAINT_UNIQUE,
-- so issuers must invalidate EVERY unused row before inserting (service rule).
CREATE UNIQUE INDEX idx_email_action_live
  ON email_action_tokens (user_id, purpose) WHERE used_at IS NULL;
CREATE INDEX idx_email_action_lookup
  ON email_action_tokens (token_hash, used_at);

CREATE TABLE mail_outbox (
  id          TEXT PRIMARY KEY,
  template    TEXT NOT NULL,
  to_email    TEXT NOT NULL,
  to_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  locale      TEXT NOT NULL DEFAULT 'zh-CN',
  subject     TEXT NOT NULL,
  -- rendered text body, tokens already redacted; html is never persisted
  body_text   TEXT NOT NULL DEFAULT '',
  -- metadata only: no token, no password, no rendered link
  payload     TEXT NOT NULL DEFAULT '{}',
  -- 1 = a retry can succeed; 0 = the row carries a one-shot secret
  retryable   INTEGER NOT NULL DEFAULT 1 CHECK (retryable IN (0, 1)),
  status      TEXT NOT NULL DEFAULT 'captured'
              CHECK (status IN ('captured', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);

CREATE INDEX idx_mail_created ON mail_outbox (created_at DESC);
CREATE INDEX idx_mail_status  ON mail_outbox (status, created_at DESC);
CREATE INDEX idx_mail_user    ON mail_outbox (to_user_id, created_at DESC);

CREATE TABLE account_deletion_requests (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- NULL on the no-SMTP degraded path: a request that never mailed a link has
  -- no token. NOT NULL + UNIQUE here would make the SECOND degraded request
  -- collide on '' and answer 500 (review P0-2), so the column is nullable and
  -- uniqueness is a partial index below.
  token_hash    TEXT,
  reason        TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'awaiting_confirmation'
                CHECK (status IN ('awaiting_confirmation', 'scheduled',
                                  'cancelled', 'completed')),
  requested_at  INTEGER NOT NULL,
  confirmed_at  INTEGER,
  scheduled_for INTEGER,
  cancelled_at  INTEGER,
  completed_at  INTEGER,
  ip            TEXT NOT NULL DEFAULT '',
  request_id    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_deletion_user ON account_deletion_requests (user_id, requested_at DESC);
CREATE UNIQUE INDEX idx_deletion_token
  ON account_deletion_requests (token_hash) WHERE token_hash IS NOT NULL;
-- At most one live request per user; a second request cancels the first.
-- Order matters: UPDATE the old row to 'cancelled' BEFORE inserting the new one.
CREATE UNIQUE INDEX idx_deletion_live
  ON account_deletion_requests (user_id)
  WHERE status IN ('awaiting_confirmation', 'scheduled');

-- Export cooldown lives on the user row, not in the audit log: auditService.record
-- is best-effort (it swallows failures) and audit rows are pruned by
-- audit.retentionDays, so neither can be an authorisation input (review P1-13).
ALTER TABLE users ADD COLUMN last_exported_at INTEGER;

-- Aggregations added by the metrics/trend work: per-day grouping without a scan.
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_created ON login_attempts (created_at DESC);
