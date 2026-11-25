-- 0006_client_releases.sql — the client release catalogue.
--
-- Background: the desktop app has no auto-updater. Its ONLY upgrade path is
-- `/download` on this account server (see docs/diagnoses/
-- client-download-unavailable/analysis.md). The version gate shipped, the
-- distribution surface did not, so a non-empty `client.minVersion` used to lock
-- an entire fleet onto a 404 page. This migration builds the missing half:
-- "which build is current, for each platform" answered by one row.
--
-- Additive only: two new tables plus indexes and idempotent permission grants.
-- No table is rebuilt (the migration iron rule: startup DDL never contains DROP).
--
-- Three model decisions worth reading before touching the code that writes them:
--
--  1. Uniqueness is `(version, platform, arch)`, NEVER `version` alone. One
--     release of 1.0.2 may legitimately ship a win-x64 installer and, later, a
--     mac-arm64 one; a single-column unique index would make macOS impossible to
--     publish without a table rebuild.
--  2. The channel pointer's primary key is `(channel, platform)` for the same
--     reason: "what is current" has one answer PER platform.
--  3. The pointer table carries the channel, the artifact rows do not. A build
--     can therefore be promoted from `beta` to `stable`, or a `stable` channel
--     can be rolled back onto a build that shipped as `beta` first, as one pure
--     pointer move — and `retract` is the same move to NULL.
--
-- Storage: `storage_key` is the artifact's path RELATIVE to `RELEASES_DIR`,
-- derived from content (`<version>/<platform>/<sha256><ext>`), never from the
-- uploaded file name. `file_name` is display-only (Content-Disposition). The
-- upload service re-validates the key against the root before every read, so a
-- hand-edited row cannot become a path traversal.
--
-- The artifact directory deliberately lives OUTSIDE `public/`: a standalone
-- `next start` never serves files copied into `public/` after the build, which
-- would make an uploaded installer silently undownloadable.

CREATE TABLE client_releases (
  id           TEXT PRIMARY KEY,
  -- `x.y.z` as published by the desktop build; ordered in the service, not here
  version      TEXT NOT NULL,
  -- 'win' today; deliberately NOT a CHECK list, because adding 'mac' must stay a
  -- data change. The service validates against RELEASE_PLATFORMS.
  platform     TEXT NOT NULL,
  arch         TEXT NOT NULL,
  -- display name for Content-Disposition, sanitised on write (no '/', '\', '..')
  file_name    TEXT NOT NULL,
  -- relative path under RELEASES_DIR; content-addressed, so two uploads of the
  -- same bytes cannot collide and a rename cannot overwrite a shipped build
  storage_key  TEXT NOT NULL,
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  -- lowercase hex; doubles as the download ETag and the integrity value users check
  sha256       TEXT NOT NULL,
  notes        TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft', 'published', 'retracted')),
  -- how many times the authenticated download endpoint served this row
  downloads    INTEGER NOT NULL DEFAULT 0,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  published_at INTEGER,
  retracted_at INTEGER
);

-- A version may exist once per platform+arch, and no more.
CREATE UNIQUE INDEX idx_client_releases_unique
  ON client_releases (version, platform, arch);
CREATE INDEX idx_client_releases_status ON client_releases (status, created_at DESC);
CREATE INDEX idx_client_releases_platform ON client_releases (platform, arch, created_at DESC);

-- "Which release is current" — the single source of truth for /download and for
-- the 426 `downloadUrl`. NULL release_id means the channel is empty (retracted).
CREATE TABLE client_release_channels (
  channel    TEXT NOT NULL,
  platform   TEXT NOT NULL,
  release_id TEXT REFERENCES client_releases(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (channel, platform)
) WITHOUT ROWID;

-- Grant the new permission to EXISTING system roles.
--
-- `seedRoles()` deliberately does nothing to a role that already exists, so the
-- new keys in SYSTEM_ROLE_PERMISSIONS would only ever reach roles created after
-- this release: an upgraded deployment would answer 403 to its own administrator
-- while a fresh development database works. INSERT OR IGNORE (not REPLACE) keeps
-- the "an operator's edits are never reverted" rule intact.
--
-- On a fresh database both statements match nothing, and the boot seed creates
-- the roles with the full set — the two paths agree.
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT id, 'releases.read' FROM roles WHERE key IN ('admin', 'support');
INSERT OR IGNORE INTO role_permissions (role_id, permission)
  SELECT id, 'releases.write' FROM roles WHERE key = 'admin';
