import { mkdirSync } from 'node:fs'
import { getConfig } from '@/server/config'
import { closeDatabase, getDb } from '@/server/db/client'
import { pendingMigrations, runMigrations } from '@/server/db/migrate'
import { runSeed } from '@/server/db/seed'
import { log } from '@/server/http/requestContext'

/**
 * Boot sequence (spec §2.3): config → database → migrate → seed.
 *
 * Why it is lazy rather than a Next.js `instrumentation.ts` hook: that file is
 * compiled for the Edge runtime as well, and Edge cannot resolve the native
 * `better-sqlite3` module — the build fails outright. Booting on the first
 * server-side entry point (root layout, or any API route) keeps the native
 * dependency inside the Node runtime, where it belongs.
 *
 * Failure is fatal by design: a security service that starts half-configured is
 * worse than one that refuses to start.
 */

let booted: Promise<void> | undefined

function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

async function boot(): Promise<void> {
  const config = getConfig()
  const db = getDb()

  if (config.autoMigrate) {
    const result = runMigrations(db)
    if (result.applied.length > 0) {
      log('info', 'migrations applied', { versions: result.applied })
    }
  } else {
    const pending = pendingMigrations(db)
    if (pending.length > 0) {
      throw new Error(
        `database schema is behind: pending migrations ${pending
          .map((migration) => migration.version)
          .join(', ')}. Run \`npm run db:migrate\` first.`,
      )
    }
  }

  await runSeed()

  // The release directory must exist before the first upload. Creating it here (not
  // inside a service) means every entry point — boot, CLI, migrate — inherits it,
  // and an operator who restored the database but not the artifacts gets an empty
  // "/download" instead of a 500 on the first publish.
  mkdirSync(config.releasesDir, { recursive: true })

  log('info', 'webserver ready', {
    nodeEnv: config.nodeEnv,
    port: config.port,
    databasePath: config.databasePath,
    rootAdminEmail: config.rootAdminEmail,
    registrationEnabled: config.registrationEnabled,
    mailEnabled: config.smtp.enabled,
  })
}

/**
 * Run the boot sequence once per process.
 *
 * A failure is fatal: a server that answers 500 to every request because a required
 * environment variable is missing looks "up" to any process supervisor and to the
 * health check's first impression, which turns a five-second config fix into an
 * outage investigation. Print the concrete reason and exit non-zero instead.
 *
 * @throws {Error} in `NODE_ENV=test`, so a test can assert the failure rather than
 *         terminate the runner.
 */
export function ensureBooted(): Promise<void> {
  if (isBuildPhase()) return Promise.resolve()
  booted ??= boot().catch(async (error: unknown) => {
    await terminatePool()
    if (process.env.NODE_ENV === 'test') throw error
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[webserver] boot failed — refusing to start:\n${message}`)
    process.exit(1)
  })
  return booted
}

/** Test seam: forget that boot ran. */
export function resetBootForTests(): void {
  booted = undefined
}

async function terminatePool(): Promise<void> {
  try {
    closeDatabase()
  } catch {
    // Closing a pool that never opened is not interesting.
  }
}
