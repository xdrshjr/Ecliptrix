-- 0004_device_identity.sql — let the server recognise a *device*, so signing in
-- again from the same machine replaces that machine's previous session instead of
-- consuming another slot of the per-user concurrent-session budget.
--
-- Additive only: ALTER TABLE ADD COLUMN plus one new index. No column is dropped,
-- no table is rebuilt (the migration iron rule: startup DDL never contains DROP).
--
-- Legacy rows keep device_key = '', so the partial index only covers rows that
-- carry a real device identity; a browser login sends no deviceKey and behaves
-- exactly as before.
--
-- Why not a UNIQUE index: same-device replacement is "revoke the old row, insert
-- the new one" inside one transaction. A unique index would turn a concurrent
-- second login (a double click, two instances of the same profile) into
-- SQLITE_CONSTRAINT → 500. The index exists for lookup cost only; the
-- transaction is what provides the guarantee.

ALTER TABLE sessions ADD COLUMN device_key TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_sessions_device
  ON sessions (user_id, device_key)
  WHERE device_key <> '';
