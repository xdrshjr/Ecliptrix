/**
 * `npm run db:migrate`
 *
 * Applies pending migrations only. Idempotent by construction, so it is safe to run
 * on every deploy. Exits non-zero on failure — a partially migrated database is
 * never left behind because each migration runs in its own transaction.
 */
import { openDatabase } from '../src/server/db/client'
import { discoverMigrations, pendingMigrations, runMigrations } from '../src/server/db/migrate'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'

loadDotEnv()

async function main(): Promise<void> {
  const config = getConfig()
  const db = openDatabase(config.databasePath)
  const all = discoverMigrations()
  const pending = pendingMigrations(db)

  console.log(
    `[db:migrate] ${config.databasePath} — ${all.length} migration(s), ${pending.length} pending`,
  )

  if (pending.length === 0) {
    console.log('[db:migrate] nothing to do')
    db.close()
    return
  }

  const result = runMigrations(db)
  for (const version of result.applied) {
    const migration = all.find((entry) => entry.version === version)
    console.log(`[db:migrate] applied ${version} ${migration?.name ?? ''}`)
  }
  db.close()
  console.log('[db:migrate] done')
}

main().catch((error: unknown) => {
  console.error(`[db:migrate] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
