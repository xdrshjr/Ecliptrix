/**
 * `npm run owner:transfer -- --email next-owner@example.com [--dry-run]`
 *
 * Hand ownership to another account in ONE transaction: the target gains `owner`,
 * the current owner becomes `admin`, both grant-ledger pairs are written, and a
 * single `user.owner_transferred` audit row records it.
 *
 * Deliberately a CLI, not an API. Ownership transfer is a break-glass operation of
 * the same rank as `user:reset`: it can hand every permission in the system to
 * somebody, so it must require shell access to the server, not a stolen console
 * session (spec §3.3 point 4). The console cannot reach this file.
 */
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import * as usersRepo from '../src/server/db/repositories/usersRepo'
import * as rolesRepo from '../src/server/db/repositories/rolesRepo'
import * as auditService from '../src/server/services/auditService'
import { normalizeEmail, normalizeUsername } from '../src/server/services/normalize'

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

const log = (message: string): void => console.log(`[owner:transfer] ${message}`)

loadDotEnv()

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const email = readArg(argv, 'email')
  const dryRun = argv.includes('--dry-run')
  if (!email) {
    console.error('usage: npm run owner:transfer -- --email a@b.c [--dry-run]')
    process.exit(2)
  }

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)

  const ownerRole = rolesRepo.findByKey(db, 'owner')
  const adminRole = rolesRepo.findByKey(db, 'admin')
  if (!ownerRole || !adminRole) {
    console.error('[owner:transfer] the owner/admin roles are missing — run the seed first')
    process.exit(1)
  }

  const emailNormalized = normalizeEmail(email)
  const target = usersRepo.findByEmailOrUsername(
    db,
    emailNormalized,
    normalizeUsername(email),
  )
  if (!target) {
    console.error(`[owner:transfer] no account for ${emailNormalized}`)
    process.exit(1)
  }
  if (target.status === 'deleted') {
    console.error('[owner:transfer] that account is deleted; restore it before transferring')
    process.exit(1)
  }
  if (target.status === 'suspended') {
    console.error('[owner:transfer] that account is suspended; activate it first')
    process.exit(1)
  }
  if (target.role_id === ownerRole.id) {
    console.error('[owner:transfer] that account is already the owner')
    process.exit(1)
  }

  // Exactly one owner is an invariant, not a preference: `posture()` reads "the
  // oldest owner row" as the root administrator, and two owners would make that
  // answer arbitrary. Refuse rather than produce an ambiguous installation.
  const currentOwnerIds = usersRepo.idsByRole(db, ownerRole.id)
  if (currentOwnerIds.length !== 1) {
    console.error(
      `[owner:transfer] expected exactly one owner, found ${currentOwnerIds.length}; ` +
        'resolve that by hand before transferring',
    )
    process.exit(1)
  }
  const currentOwnerId = currentOwnerIds[0]
  if (!currentOwnerId) {
    console.error('[owner:transfer] the current owner row could not be read')
    process.exit(1)
  }
  const current = usersRepo.findById(db, currentOwnerId)
  if (!current) {
    console.error('[owner:transfer] the current owner row could not be read')
    process.exit(1)
  }

  log(`current owner: ${current.email_normalized} (${current.username_normalized})`)
  log(`target:        ${target.email_normalized} (${target.username_normalized})`)

  if (dryRun) {
    log('dry run — nothing written')
    db.close()
    return
  }

  const now = Date.now()
  // One transaction: a half-applied transfer (new owner set, old owner still
  // owner, or the reverse) leaves two owners or none, and both break `posture()`.
  db.transaction(() => {
    usersRepo.grantRole(db, target.id, ownerRole.id, current.id, now)
    usersRepo.grantRole(db, current.id, adminRole.id, target.id, now)
    auditService.record(auditService.SYSTEM_ACTOR, {
      action: 'user.owner_transferred',
      targetType: 'user',
      targetId: target.id,
      metadata: {
        from: current.email_normalized,
        to: target.email_normalized,
        previousOwnerNewRole: 'admin',
      },
    })
  })()

  log(`done — ${target.email_normalized} is now the owner; ${current.email_normalized} is an admin`)
  db.close()
}

main().catch((error: unknown) => {
  console.error(
    `[owner:transfer] failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exit(1)
})
