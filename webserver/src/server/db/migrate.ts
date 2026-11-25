import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Db } from '@/server/db/client'

/**
 * Minimal forward-only migration runner.
 *
 * Why not a library: the schema is five tables and two files, the service owns
 * its database file, and a dependency-free runner is one of the few places
 * where "we can read all of it in one sitting" is worth more than features.
 *
 * Guarantees (spec §5.5):
 *  - every migration runs in ONE transaction with its `schema_migrations` row,
 *    so a failure leaves the database exactly as it was;
 *  - applied versions are never re-run;
 *  - a missing or unreadable directory is an error, never "no migrations".
 */

export interface Migration {
  readonly version: number
  readonly name: string
  readonly sql: string
  readonly path: string
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/

const CANDIDATE_DIRS = [
  process.env.MIGRATIONS_DIR,
  join(process.cwd(), 'src', 'server', 'db', 'migrations'),
  join(process.cwd(), 'migrations'),
  join(process.cwd(), 'webserver', 'src', 'server', 'db', 'migrations'),
].filter((dir): dir is string => Boolean(dir))

/** First existing candidate directory, or the primary default for the error. */
export function resolveMigrationsDir(explicitDir?: string): string {
  if (explicitDir) return explicitDir
  const found = CANDIDATE_DIRS.find((dir) => existsSync(dir))
  return found ?? CANDIDATE_DIRS[1] ?? resolve('src/server/db/migrations')
}

/** Read and validate every migration file in `dir`, ordered by version. */
export function discoverMigrations(dir = resolveMigrationsDir()): Migration[] {
  const entries = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
  const migrations: Migration[] = []
  for (const entry of entries) {
    const match = FILE_PATTERN.exec(entry)
    if (!match) continue
    const version = Number(match[1])
    const name = match[2] ?? ''
    migrations.push({
      version,
      name,
      sql: readFileSync(join(dir, entry), 'utf8'),
      path: join(dir, entry),
    })
  }
  migrations.sort((a, b) => a.version - b.version)
  const duplicate = migrations.find(
    (migration, index) => index > 0 && migrations[index - 1]?.version === migration.version,
  )
  if (duplicate) {
    throw new Error(`duplicate migration version ${duplicate.version} in ${dir}`)
  }
  return migrations
}

/** Versions recorded as applied. Creates the bookkeeping table if absent. */
export function appliedVersions(db: Db): number[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      'version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)',
  )
  const rows = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: number
  }[]
  return rows.map((row) => row.version)
}

/** Migrations that still need to run, in order. */
export function pendingMigrations(db: Db, dir?: string): Migration[] {
  const applied = new Set(appliedVersions(db))
  const migrations = discoverMigrations(dir)
  // Same collision check as `runMigrations`: with AUTO_MIGRATE off this is the
  // function that decides whether the server may start at all.
  assertNoVersionCollision(db, migrations)
  return migrations.filter((migration) => !applied.has(migration.version))
}

export interface MigrationResult {
  applied: number[]
  skipped: number[]
}

/** Applied rows as `version → name`, for the collision check below. */
export function appliedRecords(db: Db): { version: number; name: string }[] {
  appliedVersions(db)
  return db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as {
    version: number
    name: string
  }[]
}

/**
 * Refuse to run when a version number on disk is already applied under a
 * different file name.
 *
 * The runner keys purely on the version integer, so a collision makes the new
 * migration look "already applied" and silently skips it — the code then queries a
 * table that was never created and answers 500 at the first click. That is exactly
 * how a development database can quietly disagree with the source tree (a database
 * left behind by another branch or another checkout), so it fails here with both
 * names in the message instead of hours later.
 *
 * @throws {Error} naming the file, its version and the recorded name.
 */
export function assertNoVersionCollision(db: Db, migrations: readonly Migration[]): void {
  const recorded = new Map(appliedRecords(db).map((row) => [row.version, row.name]))
  for (const migration of migrations) {
    const previous = recorded.get(migration.version)
    if (previous === undefined || previous === migration.name) continue
    throw new Error(
      `migration version ${migration.version} is already applied as "${previous}" but this ` +
        `tree has "${migration.name}" (${migration.path}). The database was built by a ` +
        'different migration lineage; point DATABASE_PATH at a fresh file, or reconcile ' +
        'schema_migrations before starting the server.',
    )
  }
}

/**
 * Apply every pending migration.
 *
 * @throws when a migration fails — the transaction is rolled back first, so the
 *         caller can exit without leaving a half-migrated database behind.
 */
export function runMigrations(db: Db, dir?: string): MigrationResult {
  const applied = new Set(appliedVersions(db))
  const migrations = discoverMigrations(dir)
  assertNoVersionCollision(db, migrations)
  const result: MigrationResult = { applied: [], skipped: [] }
  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      result.skipped.push(migration.version)
      continue
    }
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      record.run(migration.version, migration.name, Date.now())
    })
    apply()
    result.applied.push(migration.version)
  }
  return result
}
