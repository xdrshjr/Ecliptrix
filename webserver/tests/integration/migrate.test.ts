import { afterEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from '../setup/harness'
import { appliedVersions, discoverMigrations, pendingMigrations, runMigrations } from '@/server/db/migrate'
import { getDb } from '@/server/db/client'

let harness: TestHarness | undefined

afterEach(() => {
  harness?.teardown()
  harness = undefined
})

describe('migrations', () => {
  it('applies every migration and records each version once', async () => {
    harness = await createHarness()
    const versions = appliedVersions(getDb())
    expect(versions.length).toBe(discoverMigrations().length)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
  })

  it('is idempotent: a second run applies nothing', async () => {
    harness = await createHarness()
    const before = appliedVersions(getDb()).length
    const result = runMigrations(getDb())
    expect(result.applied).toEqual([])
    expect(appliedVersions(getDb()).length).toBe(before)
    expect(pendingMigrations(getDb())).toEqual([])
  })

  it('creates every table the service depends on', async () => {
    harness = await createHarness()
    const rows = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
    const names = rows.map((row) => row.name)
    for (const table of [
      'users',
      'roles',
      'role_permissions',
      'sessions',
      'registration_invites',
      'password_reset_tokens',
      'login_attempts',
      'audit_events',
      'app_settings',
      'schema_migrations',
      'refresh_token_history',
      'refresh_token_reuse_events',
      'role_change_events',
    ]) {
      expect(names).toContain(table)
    }
  })

  it('enables foreign keys on the connection', async () => {
    harness = await createHarness()
    const row = getDb().pragma('foreign_keys', { simple: true })
    expect(row).toBe(1)
  })

  it('creates the client release catalogue with the pointer table', async () => {
    harness = await createHarness()
    const db = getDb()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)
    expect(tables).toContain('client_releases')
    expect(tables).toContain('client_release_channels')

    // The pointer's primary key is (channel, platform): one answer per platform,
    // not one per channel (a single-column key would make a second platform
    // impossible without a table rebuild).
    const columns = db.pragma('table_info(client_release_channels)') as {
      name: string
      pk: number
    }[]
    expect(columns.filter((column) => column.pk > 0).map((column) => column.name).sort()).toEqual([
      'channel',
      'platform',
    ])

    // Uniqueness is per (version, platform, arch), never per version alone — that
    // is what lets one version ship for two platforms.
    const indexes = db
      .prepare("SELECT name, " + '"unique"' + " AS is_unique FROM pragma_index_list('client_releases')")
      .all() as { name: string; is_unique: number }[]
    expect(indexes.find((index) => index.name === 'idx_client_releases_unique')?.is_unique).toBe(1)
  })

  it('grants the new permissions to roles that already existed (upgrade path)', async () => {
    // A real upgrade: build a database at schema version 5, create the system
    // roles, strip the permissions 0006 introduces — then apply 0006 and assert
    // the existing roles gain them. Without the idempotent INSERT in the
    // migration, `seedRoles()` would leave them alone and the deployment's own
    // administrator would answer 403 while a fresh install works.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { openDatabase, setDbForTests } = await import('@/server/db/client')
    const { discoverMigrations, runMigrations } = await import('@/server/db/migrate')
    const { SYSTEM_ROLE_KEYS, SYSTEM_ROLE_NAMES, SYSTEM_ROLE_PERMISSIONS } = await import(
      '@/server/auth/permissions'
    )

    const scratch = mkdtempSync(join(tmpdir(), 'ws-upgrade-'))
    const all = discoverMigrations()
    for (const migration of all.filter((entry) => entry.version < 6)) {
      writeFileSync(join(scratch, `${String(migration.version).padStart(4, '0')}_${migration.name}.sql`), migration.sql)
    }

    const db = openDatabase(':memory:')
    setDbForTests(db)
    runMigrations(db, scratch)
    // Seed the four system roles with raw SQL instead of `seedRoles()`.
    //
    // `rolesRepo.create` writes `rank` unconditionally, and `rank` only exists
    // after migration 0007 — which this test deliberately has not applied yet.
    // Calling the seed here would throw `no such column: rank` and mask the
    // upgrade assertion it is supposed to protect (review R-V3-06). Inserting
    // the rows the way the pre-0007 code did keeps the fixture faithful to the
    // schema it claims to be.
    const insertRole = db.prepare(
      `INSERT INTO roles (id, key, name, description, is_system, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 1, 1)`,
    )
    const insertPermission = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)',
    )
    for (const key of SYSTEM_ROLE_KEYS) {
      const meta = SYSTEM_ROLE_NAMES[key]
      const roleId = `role-${key}`
      insertRole.run(roleId, key, meta.name, meta.description)
      for (const permission of SYSTEM_ROLE_PERMISSIONS[key]) insertPermission.run(roleId, permission)
    }
    db.prepare("DELETE FROM role_permissions WHERE permission LIKE 'releases.%'").run()

    runMigrations(db)

    const granted = db
      .prepare(
        `SELECT r.key AS role_key, p.permission
           FROM role_permissions p JOIN roles r ON r.id = p.role_id
          WHERE p.permission LIKE 'releases.%'
          ORDER BY r.key, p.permission`,
      )
      .all() as { role_key: string; permission: string }[]
    expect(granted).toEqual([
      { role_key: 'admin', permission: 'releases.read' },
      { role_key: 'admin', permission: 'releases.write' },
      { role_key: 'support', permission: 'releases.read' },
    ])

    db.close()
    rmSync(scratch, { recursive: true, force: true })
  })

  it('applies 0005 once and is idempotent afterwards', async () => {
    harness = await createHarness()
    const versions = appliedVersions(getDb())
    expect(versions).toContain(5)
    const again = runMigrations(getDb())
    expect(again.applied).toEqual([])
    expect(again.skipped).toContain(5)
  })

  it('rejects a second live deletion request but allows many cancelled ones', async () => {
    harness = await createHarness()
    const db = getDb()
    const role = db.prepare("SELECT id FROM roles WHERE key = 'member'").get() as { id: string }
    db.prepare(
      `INSERT INTO users (id, email, email_normalized, username, username_normalized,
         display_name, password_hash, password_updated_at, role_id, status, plan_tag,
         must_change_password, created_at, updated_at)
       VALUES ('u-live','a@b.c','a@b.c','a','a','A','h',0,?, 'active','free',0,0,0)`,
    ).run(role.id)

    // Two cancelled rows with a NULL token_hash coexist (this is the P0-2 fix).
    db.prepare(
      `INSERT INTO account_deletion_requests (id,user_id,status,requested_at)
       VALUES ('d1','u-live','cancelled',1), ('d2','u-live','cancelled',2)`,
    ).run()

    db.prepare(
      `INSERT INTO account_deletion_requests (id,user_id,status,requested_at)
       VALUES ('d3','u-live','scheduled',3)`,
    ).run()
    expect(() =>
      db
        .prepare(
          `INSERT INTO account_deletion_requests (id,user_id,status,requested_at)
           VALUES ('d4','u-live','scheduled',4)`,
        )
        .run(),
    ).toThrow(/UNIQUE/)
  })

  it('added users.last_exported_at as an additive column', async () => {
    harness = await createHarness()
    const columns = getDb().pragma('table_info(users)') as { name: string }[]
    expect(columns.map((column) => column.name)).toContain('last_exported_at')
    // Existing rows read as NULL rather than failing.
    const row = getDb().prepare('SELECT last_exported_at FROM users LIMIT 1').get() as {
      last_exported_at: number | null
    }
    expect(row.last_exported_at).toBeNull()
  })

  it('creates the three lifecycle tables and the partial indexes', async () => {
    harness = await createHarness()
    const db = getDb()
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)
    for (const table of [
      'email_action_tokens',
      'mail_outbox',
      'account_deletion_requests',
    ]) {
      expect(tables).toContain(table)
    }
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((row) => row.name)
    for (const index of [
      'idx_email_action_live',
      'idx_deletion_live',
      'idx_deletion_token',
      'idx_mail_status',
      'idx_sessions_created',
      'idx_attempts_created',
    ]) {
      expect(indexes).toContain(index)
    }
  })

  it('refuses to run when a version number is already applied under another name', async () => {
    // A database built by a different migration lineage (another branch, another
    // checkout) records version 6 under a name this tree does not have. Keying on
    // the integer alone would skip this tree's 0006 and leave the code querying a
    // table that was never created — a 500 at the first click, hours later.
    harness = await createHarness()
    const db = getDb()
    db.prepare('DELETE FROM schema_migrations WHERE version = 6').run()
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (6, ?, ?)').run(
      'api_gateway',
      Date.now(),
    )

    expect(() => runMigrations(db)).toThrowError(/already applied as "api_gateway"/)
    expect(() => pendingMigrations(db)).toThrowError(/different migration lineage/)
  })

  it('rolls back an entire migration file when one statement fails', async () => {
    // The runner wraps each file in ONE transaction, so a failure mid-file must
    // leave none of that file's objects behind. A scratch migrations directory is
    // used so the real migration set is never mutated by a test.
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { openDatabase } = await import('@/server/db/client')
    const { runMigrations, appliedVersions } = await import('@/server/db/migrate')

    const dir = mkdtempSync(join(tmpdir(), 'ws-migrations-'))
    writeFileSync(
      join(dir, '0001_broken.sql'),
      'CREATE TABLE first (id TEXT PRIMARY KEY);\nCREATE TABLE second (id TEXT PRIMARY KEY,);',
    )

    const db = openDatabase(':memory:')
    expect(() => runMigrations(db, dir)).toThrow()
    expect(appliedVersions(db)).toEqual([])
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('first','second')")
      .all() as { name: string }[]
    expect(tables).toEqual([])
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
