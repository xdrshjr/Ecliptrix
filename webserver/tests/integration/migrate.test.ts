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
