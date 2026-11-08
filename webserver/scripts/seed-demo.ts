/**
 * `npm run seed:demo`
 *
 * Creates the demo accounts (one per role) so the console can be explored
 * locally without inventing data by hand. Refuses to run against a production
 * configuration — see `seedDemoData`.
 */
import { openDatabase } from '../src/server/db/client'
import { runMigrations } from '../src/server/db/migrate'
import { runSeed, seedDemoData, DEMO_USERS } from '../src/server/db/seed'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'

loadDotEnv()

async function main(): Promise<void> {
  const config = getConfig()
  if (config.nodeEnv === 'production') {
    console.error('[seed:demo] refused — NODE_ENV=production')
    process.exit(1)
  }

  const db = openDatabase(config.databasePath)
  runMigrations(db)
  await runSeed()
  const result = await seedDemoData()
  db.close()

  console.log(`[seed:demo] created ${result.created.length}, skipped ${result.skipped.length}`)
  for (const email of result.created) {
    const password = DEMO_USERS.find((user) => user.email === email)?.password ?? ''
    console.log(`[seed:demo] ${email} / ${password}`)
  }
  for (const email of result.skipped) console.log(`[seed:demo] exists, left alone: ${email}`)
}

main().catch((error: unknown) => {
  console.error(`[seed:demo] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
