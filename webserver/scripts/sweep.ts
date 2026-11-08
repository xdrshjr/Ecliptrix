/**
 * `npm run accounts:sweep -- [--dry-run] [--limit 500]`
 *
 * Executes every deletion whose grace period has elapsed. Same implementation as the
 * lazy sweep that rides on the request path (`maintenanceService.sweepIfDue`), so a
 * deployment that sets a cron job and one that relies on traffic behave identically —
 * only the latency differs (up to an hour vs up to the next request).
 *
 * `--dry-run` lists what would be executed and touches nothing.
 */
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import * as deletionRepo from '../src/server/db/repositories/deletionRequestsRepo'
import * as accountDeletionService from '../src/server/services/accountDeletionService'

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function intArg(argv: string[], name: string, fallback: number): number {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const parsed = Number(argv[index + 1])
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

loadDotEnv()

function main(): void {
  const argv = process.argv.slice(2)
  const dryRun = hasFlag(argv, 'dry-run')
  const limit = intArg(argv, 'limit', 500)

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)

  const now = Date.now()
  if (dryRun) {
    const due = deletionRepo.listDue(db, now, limit)
    console.log(
      `[accounts:sweep] dry-run scanned=${due.length} ` +
        `scheduled_for=${due.map((row) => row.scheduled_for).join(',') || '-'}`,
    )
    db.close()
    return
  }

  const result = accountDeletionService.sweepDue(now, limit)
  console.log(
    `[accounts:sweep] deleted=${result.deleted} failed=${result.failed} scanned=${result.scanned}`,
  )
  db.close()
}

try {
  main()
} catch (error) {
  console.error(`[accounts:sweep] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
