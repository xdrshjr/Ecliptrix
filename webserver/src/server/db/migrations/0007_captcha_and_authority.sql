-- 0007_captcha_and_authority.sql — human verification and authority convergence.
--
-- Additive only: one new table, two ADD COLUMN pairs, indexes and idempotent
-- permission grants. No table is rebuilt and no DROP appears anywhere — the same
-- iron rule every earlier migration follows.
--
-- Why a table instead of a signed cookie: a challenge has to be single-use
-- (DM-1), attempt-limited, and revoked the moment it is consumed, which only a
-- row can express. It also lets the security posture page count real solves
-- instead of guessing.
--
-- `answer_hash` is HMAC(SESSION_SECRET, `${id}.${normalisedAnswer}`). The plain
-- answer never reaches this database, any response, any log line or any audit
-- row (spec §3.1 rule 2), so a dump of this table cannot be replayed.

CREATE TABLE captcha_challenges (
  id           TEXT PRIMARY KEY,
  purpose      TEXT NOT NULL CHECK (purpose IN ('register', 'login')),
  -- HMAC digest, 64 hex characters. Never the plaintext answer.
  answer_hash  TEXT NOT NULL,
  -- Recorded so a genuine network switch can be recognised in the audit log.
  -- It is NOT an authorisation input: a mismatched address is tolerated (spec
  -- §3.2.2), because mobile carriers reassign addresses mid-session.
  ip           TEXT NOT NULL DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);

-- Drives the hourly retention sweep (`maintenanceService.pruneRetained`).
CREATE INDEX idx_captcha_expiry ON captcha_challenges (expires_at);

-- Role rank: the level gate (INV-1) compares `actor.rank > target.rank`.
--
-- Written ONLY here. `createRoleSchema` / `updateRoleSchema` deliberately do not
-- carry the field, so there is no API path that can raise a role's rank — that
-- would be a brand-new escalation surface for the sake of a column.
ALTER TABLE roles ADD COLUMN rank INTEGER NOT NULL DEFAULT 20;

-- Grant ledger: who granted whom which role. `audit_events` already records the
-- change, but audit rows are pruned after `audit.retentionDays`; this pair
-- survives, so "why is this person an administrator" always has an answer.
--
-- ON DELETE SET NULL is mandatory, not decorative: without it a hard delete
-- (`?hard=true`) of anybody who ever granted a role fails on a foreign key. It is
-- the fourth such reference in this schema, and SQLite cannot alter a key in
-- place, so it must be right the first time.
ALTER TABLE users ADD COLUMN role_granted_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN role_granted_at INTEGER;

-- System role ranks. Idempotent, and deliberately in the migration rather than
-- the boot seed: rank is a structural invariant, and a seed that rewrote it on
-- every start would silently undo an operator's manual ranking adjustment.
UPDATE roles SET rank = 100 WHERE key = 'owner';
UPDATE roles SET rank = 80  WHERE key = 'admin';
UPDATE roles SET rank = 40  WHERE key = 'support';
UPDATE roles SET rank = 10  WHERE key = 'member';

-- `security.read` for an UPGRADED database.
--
-- `seedRoles()` never touches a role that already exists, so the key added to
-- `SYSTEM_ROLE_PERMISSIONS.admin` reaches fresh databases only. A deployed
-- installation therefore needs this statement, and a fresh one needs the seed
-- table: BOTH paths must name the permission or one of the two answers 403
-- (spec §6.1 point 4, review R-10).
--
-- `security.read` is only ever granted together with `users.read`, never alone:
-- `(console)/admin/layout.tsx` requires `users.read` for every `/admin/*` page,
-- so an isolated grant would render as a 403 page instead of the new panel.
-- `admin` already holds `users.read`; `support` is deliberately NOT granted
-- (review R-16 — the posture page shows the root administrator's account state,
-- which a read-only support role has no business knowing).
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT id, 'security.read' FROM roles WHERE key = 'admin';
