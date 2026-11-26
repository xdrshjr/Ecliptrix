import { getDb } from '@/server/db/client'
import { getConfig } from '@/server/config'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import {
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_NAMES,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_RANK,
} from '@/server/auth/permissions'
import { hashPassword } from '@/server/auth/password'
import { newId } from '@/server/auth/tokens'
import { normalizeEmail, normalizeUsername } from '@/server/services/normalize'
import * as settingsService from '@/server/services/settingsService'
import * as auditService from '@/server/services/auditService'
import { log } from '@/server/http/requestContext'

/**
 * Boot seed.
 *
 * Idempotent by construction: every step checks first, so booting an existing
 * database changes nothing an administrator may have edited. This is the same
 * rule the desktop app follows for its schema (CLAUDE.md "Database").
 */

/**
 * Create the four system roles and their permission sets.
 *
 * Existing roles keep their permissions — an operator who stripped
 * `users.delete` from `admin` must not get it back because the service
 * restarted. The same rule covers `rank` (migration 0007): an existing row is
 * left exactly as the migration set it, because a seed that rewrote it on every
 * start would silently undo manual ranking.
 */
export function seedRoles(now = Date.now()): void {
  const db = getDb()
  const seed = db.transaction(() => {
    for (const key of SYSTEM_ROLE_KEYS) {
      const existing = rolesRepo.findByKey(db, key)
      const meta = SYSTEM_ROLE_NAMES[key]
      if (!existing) {
        rolesRepo.create(db, {
          id: newId(),
          key,
          name: meta.name,
          description: meta.description,
          isSystem: true,
          permissions: SYSTEM_ROLE_PERMISSIONS[key],
          rank: SYSTEM_ROLE_RANK[key],
          now,
        })
        continue
      }
      if (existing.is_system !== 1) {
        db.prepare('UPDATE roles SET is_system = 1, updated_at = ? WHERE id = ?').run(
          now,
          existing.id,
        )
      }
      // The owner set is generated, never stored, so keep it coherent.
      if (key === 'owner' && rolesRepo.permissionsFor(db, existing.id).join(',') !== '*') {
        rolesRepo.replacePermissions(db, existing.id, ['*'])
      }
    }
  })
  seed()
}

/**
 * Create or promote the break-glass super administrator.
 *
 * The password is written only when the account has no hash yet, or when
 * `RESET_ROOT_ADMIN_PASSWORD=true`. Never logged, never in an audit row.
 */
export async function ensureRootAdmin(now = Date.now()): Promise<void> {
  const db = getDb()
  const config = getConfig()
  const ownerRole = rolesRepo.findByKey(db, 'owner')
  if (!ownerRole) throw new Error('owner role missing — seedRoles must run first')

  const emailNormalized = normalizeEmail(config.rootAdminEmail)
  const existing = usersRepo.findByEmailOrUsername(db, emailNormalized, emailNormalized)

  if (!existing) {
    const passwordHash = await hashPassword(config.rootAdminPassword)
    const username = normalizeUsername(config.rootAdminUsername) || 'xdrshjr'
    const id = newId()
    usersRepo.create(db, {
      id,
      email: config.rootAdminEmail,
      emailNormalized,
      username: config.rootAdminUsername,
      usernameNormalized: username,
      displayName: config.rootAdminUsername || 'Owner',
      passwordHash,
      roleId: ownerRole.id,
      status: 'active',
      planTag: 'studio',
      mustChangePassword: false,
      now,
    })
    // The ledger records "granted by nobody", which reads as "created by the
    // system" — accurate, and distinct from "an operator promoted this account".
    // The role pair is already NULL from `create`.
    //
    // The audit row is the security-posture contract: `bootstrapPassword` in
    // `/admin/security` is derived from `password_updated_at <= created_at`, and
    // this row is what lets an incident responder confirm the account was seeded
    // rather than smuggled in later (spec §3.3 point 3).
    auditService.record(auditService.SYSTEM_ACTOR, {
      action: 'security.bootstrap_credential_created',
      targetType: 'user',
      targetId: id,
      metadata: { username: config.rootAdminUsername },
    })
    log('info', 'root administrator created', { email: emailNormalized })
    return
  }

  if (existing.role_id !== ownerRole.id) {
    // A promotion here is the seed correcting an installation whose owner account
    // lost its role; attribute it to the system, not to an absent human.
    usersRepo.grantRole(db, existing.id, ownerRole.id, null, now)
    log('info', 'existing account promoted to owner', { email: emailNormalized })
  }

  if (config.resetRootAdminPassword) {
    const passwordHash = await hashPassword(config.rootAdminPassword)
    usersRepo.update(
      db,
      existing.id,
      { password_hash: passwordHash, password_updated_at: now, must_change_password: 0 },
      now,
    )
    log('warn', 'root administrator password reset from environment', {
      email: emailNormalized,
    })
  }
}

/** Full boot sequence, in order. Safe to re-run. */
export async function runSeed(): Promise<void> {
  seedRoles()
  settingsService.seedDefaults()
  await ensureRootAdmin()
}

export interface DemoUserSpec {
  email: string
  username: string
  displayName: string
  roleKey: string
  planTag: 'free' | 'pro' | 'studio'
  password: string
}

/**
 * Demonstration accounts for a local console (`npm run seed:demo`).
 *
 * Refuses to run against a production configuration: these passwords are printed
 * in the repository, so a demo user in production is an open door, not a sample.
 * Existing accounts are left untouched — re-running must never reset a password
 * an operator has already rotated.
 *
 * @returns the emails it created; skipped accounts are reported separately.
 * @throws {Error} when `NODE_ENV=production`.
 */
export async function seedDemoData(now = Date.now()): Promise<{
  created: string[]
  skipped: string[]
}> {
  const config = getConfig()
  if (config.nodeEnv === 'production') {
    throw new Error('seedDemoData refuses to run with NODE_ENV=production')
  }

  const db = getDb()
  const created: string[] = []
  const skipped: string[] = []

  for (const spec of DEMO_USERS) {
    const emailNormalized = normalizeEmail(spec.email)
    if (usersRepo.findByEmailOrUsername(db, emailNormalized, normalizeUsername(spec.username))) {
      skipped.push(spec.email)
      continue
    }
    const role = rolesRepo.findByKey(db, spec.roleKey)
    if (!role) throw new Error(`demo role missing: ${spec.roleKey} — run the seed first`)

    usersRepo.create(db, {
      id: newId(),
      email: spec.email,
      emailNormalized,
      username: spec.username,
      usernameNormalized: normalizeUsername(spec.username),
      displayName: spec.displayName,
      passwordHash: await hashPassword(spec.password),
      roleId: role.id,
      status: 'active',
      planTag: spec.planTag,
      mustChangePassword: false,
      now,
    })
    created.push(spec.email)
  }

  return { created, skipped }
}

/** Sample accounts: one admin, one support, one member. */
export const DEMO_USERS: readonly DemoUserSpec[] = [
  {
    email: 'demo.admin@example.com',
    username: 'demo_admin',
    displayName: 'Demo Admin',
    roleKey: 'admin',
    planTag: 'studio',
    password: 'demo-admin-password-1',
  },
  {
    email: 'demo.support@example.com',
    username: 'demo_support',
    displayName: 'Demo Support',
    roleKey: 'support',
    planTag: 'pro',
    password: 'demo-support-password-1',
  },
  {
    email: 'demo.member@example.com',
    username: 'demo_member',
    displayName: 'Demo Member',
    roleKey: 'member',
    planTag: 'free',
    password: 'demo-member-password-1',
  },
]
