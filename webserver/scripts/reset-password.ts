/**
 * `npm run user:reset -- --email a@b.c --password '…'`
 *
 * Break-glass password reset: rewrites the hash, clears the lockout, revokes every
 * session of that account. This is the documented recovery path when the console is
 * unreachable and the owner has locked themselves out of the web UI.
 */
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import { hashPassword, validatePasswordPolicy } from '../src/server/auth/password'
import * as usersRepo from '../src/server/db/repositories/usersRepo'
import * as sessionsRepo from '../src/server/db/repositories/sessionsRepo'
import { normalizeEmail, normalizeUsername } from '../src/server/services/normalize'

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

loadDotEnv()

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const email = readArg(argv, 'email')
  const password = readArg(argv, 'password')
  if (!email || !password) {
    console.error('usage: npm run user:reset -- --email a@b.c --password <pw>')
    process.exit(2)
  }

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)

  const emailNormalized = normalizeEmail(email)
  const user = usersRepo.findByEmailOrUsername(db, emailNormalized, normalizeUsername(email))
  if (!user) {
    console.error(`[user:reset] no account for ${emailNormalized}`)
    process.exit(1)
  }

  const policy = validatePasswordPolicy({
    password,
    email: user.email_normalized,
    username: user.username_normalized,
  })
  if (!policy.ok) {
    console.error(`[user:reset] weak password: ${policy.reasons.join(', ')}`)
    process.exit(1)
  }

  const now = Date.now()
  usersRepo.update(
    db,
    user.id,
    {
      password_hash: await hashPassword(password),
      password_updated_at: now,
      must_change_password: 0,
      failed_login_count: 0,
      lock_count: 0,
      locked_until: null,
    },
    now,
  )
  const revoked = sessionsRepo.revokeAllForUser(db, user.id, now, 'password_changed')

  console.log(
    `[user:reset] reset ${user.email_normalized}; ${revoked} session(s) revoked; account unlocked`,
  )
  db.close()
}

main().catch((error: unknown) => {
  console.error(`[user:reset] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
