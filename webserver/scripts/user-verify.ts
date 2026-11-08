/**
 * `npm run user:verify -- --email a@b.c`
 * `npm run user:verify -- --all-unverified [--dry-run]`
 *
 * Bulk pre-flight for `mail.verificationRequired`.
 *
 * Every account that existed before migration 0005 has `email_verified_at = NULL`.
 * Switching the desktop policy on therefore answers 403 to every desktop user at
 * once — including an operator who cannot verify because their own mail never
 * arrives. This command is the documented way out:
 *
 *   npm run user:verify -- --all-unverified --dry-run   # see who is affected
 *   npm run user:verify -- --all-unverified             # mark the real ones verified
 *   npm run user:verify -- --email ada@example.com      # or just one
 *
 * The bulk form skips soft-deleted accounts and accounts whose address is already a
 * tombstone.
 */
import { openDatabase, setDbForTests, getDb } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import * as usersRepo from '../src/server/db/repositories/usersRepo'
import * as auditService from '../src/server/services/auditService'
import { normalizeEmail } from '../src/server/services/normalize'
import { SYSTEM_ACTOR } from '../src/server/services/auditService'

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

loadDotEnv()

function main(): void {
  const argv = process.argv.slice(2)
  const email = readArg(argv, 'email')
  const all = argv.includes('--all-unverified')
  const dryRun = argv.includes('--dry-run')

  if (!email && !all) {
    console.error('usage: npm run user:verify -- --email a@b.c | --all-unverified [--dry-run]')
    process.exit(2)
  }

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)
  const now = Date.now()

  if (email) {
    const user = usersRepo.findByEmailIncludingDeleted(db, normalizeEmail(email))
    if (!user) {
      console.error(`[user:verify] no account for ${normalizeEmail(email)}`)
      process.exit(1)
    }
    if (user.email_verified_at !== null) {
      console.log(`[user:verify] email=${user.email} already verified`)
      db.close()
      return
    }
    if (dryRun) {
      console.log(`[user:verify] dry-run email=${user.email} would be marked verified`)
      db.close()
      return
    }
    usersRepo.update(db, user.id, { email_verified_at: now } as never, now)
    auditService.record({ ...SYSTEM_ACTOR, actorLabel: 'cli' }, {
      action: 'user.email_verified_by_admin',
      targetType: 'user',
      targetId: user.id,
      metadata: { actor: 'cli', bulk: false },
    })
    console.log(`[user:verify] email=${user.email} verified_at=${new Date(now).toISOString()}`)
    db.close()
    return
  }

  const candidates = getDb()
    .prepare(
      `SELECT id, email FROM users
        WHERE email_verified_at IS NULL AND status <> 'deleted'
        ORDER BY created_at ASC`,
    )
    .all() as { id: string; email: string }[]

  if (dryRun) {
    console.log(`[user:verify] dry-run would verify ${candidates.length} account(s)`)
    for (const candidate of candidates.slice(0, 20)) console.log(`  - ${candidate.email}`)
    db.close()
    return
  }

  const update = db.transaction(() => {
    for (const candidate of candidates) {
      usersRepo.update(db, candidate.id, { email_verified_at: now } as never, now)
      auditService.record({ ...SYSTEM_ACTOR, actorLabel: 'cli' }, {
        action: 'user.email_verified_by_admin',
        targetType: 'user',
        targetId: candidate.id,
        metadata: { actor: 'cli', bulk: true },
      })
    }
  })
  update()
  console.log(`[user:verify] batch updated=${candidates.length} skipped=0`)
  db.close()
}

try {
  main()
} catch (error) {
  console.error(`[user:verify] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
