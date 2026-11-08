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
