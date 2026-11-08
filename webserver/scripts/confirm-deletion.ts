/**
 * `npm run account:confirm-deletion -- --email a@b.c [--force]`
 *
 * Break-glass for a user who lost access to their mailbox: confirms their pending
 * deletion request from the command line, exactly like the admin endpoint
 * `POST /api/v1/admin/users/{id}/deletion` does from the console.
 *
 * Neither path skips the grace period and neither skips the audit — only the
 * "click the link" step is replaced by an operator decision.
 *
 * `--force` schedules the request when the user has no live request at all (they
 * cannot even reach the danger zone because they cannot sign in). Without it, a
 * missing request is an error: creating one silently would let an operator delete an
 * account the owner never asked to delete.
 */
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import * as usersRepo from '../src/server/db/repositories/usersRepo'
import * as deletionRepo from '../src/server/db/repositories/deletionRequestsRepo'
import * as accountDeletionService from '../src/server/services/accountDeletionService'
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
  const force = argv.includes('--force')
  if (!email) {
    console.error('usage: npm run account:confirm-deletion -- --email a@b.c [--force]')
    process.exit(2)
  }

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)

  const normalized = normalizeEmail(email)
  const user = usersRepo.findByEmailIncludingDeleted(db, normalized)
  if (!user) {
    console.error(`[account:confirm-deletion] no account for ${normalized}`)
    process.exit(1)
  }
  if (user.status === 'deleted') {
    console.error(`[account:confirm-deletion] ${normalized} is already deleted`)
    process.exit(1)
  }

  const live = deletionRepo.findLiveByUser(db, user.id)
  if (!live) {
    if (!force) {
      console.error(
        `[account:confirm-deletion] no live request for ${normalized}; pass --force to schedule one`,
      )
      process.exit(1)
    }
    // `--force` opens a request first (a password is not required here: this is the
    // operator's deliberate decision, and it is fully audited).
    accountDeletionService.request(
      user,
      { password: '', reason: 'operator break-glass (CLI)' },
      { ip: 'cli', requestId: 'cli', audit: { ...SYSTEM_ACTOR, actorLabel: 'cli' } },
      { allowExistingPending: true },
    )
  }

  const result = accountDeletionService.confirmByAdmin(
    user.id,
    'offline break-glass confirmation (CLI)',
    { ...SYSTEM_ACTOR, actorLabel: 'cli' },
  )
  console.log(
    `[account:confirm-deletion] email=${normalized} status=${result.status} scheduled_for=${result.scheduledFor}`,
  )
  db.close()
}

try {
  main()
} catch (error) {
  console.error(
    `[account:confirm-deletion] failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
}
