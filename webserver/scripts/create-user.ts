/**
 * `npm run user:create -- --email a@b.c --password '…' --role admin`
 *
 * Break-glass CLI: talks straight to the database and the service layer, never to
 * HTTP. Used when the console is unreachable or when the owner role itself needs
 * to be minted.
 */
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import { seedRoles } from '../src/server/db/seed'
import { hashPassword, validatePasswordPolicy } from '../src/server/auth/password'
import { newId } from '../src/server/auth/tokens'
import * as usersRepo from '../src/server/db/repositories/usersRepo'
import * as rolesRepo from '../src/server/db/repositories/rolesRepo'
import { normalizeEmail, normalizeUsername } from '../src/server/services/normalize'

interface Args {
  email?: string
  password?: string
  role?: string
  username?: string
  displayName?: string
}

function parseArgs(argv: string[]): Args {
  const args: Args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token?.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) continue
    index += 1
    if (key === 'email') args.email = value
    else if (key === 'password') args.password = value
    else if (key === 'role') args.role = value
    else if (key === 'username') args.username = value
    else if (key === 'display-name') args.displayName = value
  }
  return args
}

loadDotEnv()

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!args.email || !args.password) {
    console.error('usage: npm run user:create -- --email a@b.c --password <pw> [--role member] [--username x]')
    process.exit(2)
  }

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)
  seedRoles()

  const emailNormalized = normalizeEmail(args.email)
  const username = args.username ?? emailNormalized.split('@')[0] ?? 'user'
  const usernameNormalized = normalizeUsername(username)

  if (usersRepo.emailExists(db, emailNormalized)) {
    console.error(`[user:create] ${emailNormalized} already exists`)
    process.exit(1)
  }

  const policy = validatePasswordPolicy({
    password: args.password,
    email: emailNormalized,
    username: usernameNormalized,
  })
  if (!policy.ok) {
    console.error(`[user:create] weak password: ${policy.reasons.join(', ')}`)
    process.exit(1)
  }

  const role = rolesRepo.findByKey(db, args.role ?? 'member')
  if (!role) {
    console.error(`[user:create] unknown role ${args.role}`)
    process.exit(1)
  }

  const id = newId()
  usersRepo.create(db, {
    id,
    email: args.email,
    emailNormalized,
    username,
    usernameNormalized,
    displayName: args.displayName ?? username,
    passwordHash: await hashPassword(args.password),
    roleId: role.id,
    status: 'active',
    planTag: 'free',
    mustChangePassword: false,
    now: Date.now(),
  })

  // Print identity only. The password was supplied by the operator; echoing it
  // would put a credential in shell history and CI logs.
  console.log(`[user:create] created ${emailNormalized} (${role.key}) id=${id}`)
  db.close()
}

main().catch((error: unknown) => {
  console.error(`[user:create] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
