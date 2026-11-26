import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as auditRepo from '@/server/db/repositories/auditRepo'
import * as captchaRepo from '@/server/db/repositories/captchaRepo'
import * as captchaService from '@/server/services/captchaService'
import * as settingsService from '@/server/services/settingsService'
import { maskEmail } from '@/server/services/privacy'
import { FALLBACK_IP } from '@/server/http/requestContext'

/**
 * Security posture — read-only aggregation for `/admin/security`.
 *
 * Four questions an operator asks during an incident, answered in one pass:
 *
 *  1. Is the highest-privilege account still on its bootstrap password?
 *  2. Is the human-verification gate actually stopping anything?
 *  3. Is anybody probing permissions they do not hold?
 *  4. Who holds authority, and who handed it out recently?
 *
 * Read-only by construction: there is no mutation here, so the panel cannot become
 * a second administration surface. Numbers with no data answer zero rather than
 * throwing, because a brand-new installation is the most likely caller.
 */

export interface RootAdminPosture {
  id: string
  username: string
  /** Masked — the posture panel shows a recognisable address, not a readable one. */
  email: string
  /**
   * True when the hash was written once, at seeding, and never changed.
   *
   * Derived from `password_updated_at <= created_at`, which needs no extra
   * column: `ensureRootAdmin` sets both to the same instant, and any password
   * change (self-service or CLI) moves `password_updated_at` forward. The first
   * change flips this to false with nothing to clean up (spec §3.3 point 3).
   */
  bootstrapPassword: boolean
  passwordUpdatedAt: string
  lastLoginAt: string | null
}

export interface CaptchaPosture {
  issued24h: number
  solved24h: number
  /** Abandoned with at least one wrong attempt — the ones the gate stopped. */
  failed24h: number
  /** `solved / (solved + failed)`, or null before anything has been answered. */
  solveRate: number | null
  /**
   * Failures after which a sign-in demands a challenge (0 = never).
   *
   * Reported so the panel answers "why did I see a puzzle?" with the number the
   * gate is actually using, instead of the reader having to cross-reference
   * settings — the two would otherwise drift the first time an operator tunes it.
   */
  loginThreshold: number
}

export interface AuthorityDistribution {
  owner: number
  admin: number
  support: number
  member: number
  /** Custom roles, counted together — the panel names them in `customRoles`. */
  custom: number
}

export interface DenialPosture {
  /** `authz.denied` in the window. */
  denied: number
  /** `authz.escalation_denied` in the window — attempted grants above the caller. */
  escalationDenied: number
  topPermissions: { permission: string; count: number }[]
}

export interface RoleChangeEntry {
  at: string
  actorLabel: string
  targetLabel: string
  action: string
}

export interface SecurityPosture {
  rootAdmin: RootAdminPosture | null
  captcha: CaptchaPosture
  authorities: AuthorityDistribution
  denials: DenialPosture
  recentRoleChanges: RoleChangeEntry[]
  /**
   * Share of challenges issued to callers whose address could not be trusted
   * (`0.0.0.0`) in the window. A high value means `TRUST_PROXY` is misconfigured,
   * which silently turns every per-IP budget into a site-wide one (review R-02).
   */
  untrustedIpRatio: number
}

function rootAdminPosture(): RootAdminPosture | null {
  const db = getDb()
  const ownerRole = rolesRepo.findByKey(db, 'owner')
  if (!ownerRole) return null
  const owners = usersRepo.idsByRole(db, ownerRole.id)
  // The seeded root is the oldest owner account; a CLI transfer keeps exactly one
  // owner, so this is stable across handovers.
  const rows = owners
    .map((id) => usersRepo.findById(db, id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.created_at - b.created_at)
  const owner = rows[0]
  if (!owner) return null

  // `password_updated_at <= created_at` is the whole detection: the seed writes
  // both to one instant, and any later change (self-service or CLI) moves the
  // password timestamp forward. A lockout or a login touches neither, so the flag
  // cannot flip back on its own.
  const bootstrapPassword = owner.password_updated_at <= owner.created_at
  return {
    id: owner.id,
    username: owner.username,
    email: maskEmail(owner.email),
    bootstrapPassword,
    passwordUpdatedAt: new Date(owner.password_updated_at).toISOString(),
    lastLoginAt: owner.last_login_at ? new Date(owner.last_login_at).toISOString() : null,
  }
}

function authorityDistribution(): AuthorityDistribution {
  const rows = rolesRepo.userCountsByRoleKey(getDb())
  const out: AuthorityDistribution = { owner: 0, admin: 0, support: 0, member: 0, custom: 0 }
  for (const row of rows) {
    if (row.key === 'owner' || row.key === 'admin' || row.key === 'support' || row.key === 'member') {
      out[row.key] = row.count
    } else {
      out.custom += row.count
    }
  }
  return out
}

/** Top permissions named by `authz.denied` rows in the window. */
function topDeniedPermissions(sinceMs: number): { permission: string; count: number }[] {
  return auditRepo.topDeniedPermissions(getDb(), sinceMs)
}

function recentRoleChanges(limit = 5): RoleChangeEntry[] {
  const rows = auditRepo.recentRoleEvents(getDb(), limit)

  return rows.map((row) => {
    let target = row.target_id
    try {
      const parsed = JSON.parse(row.metadata) as Record<string, unknown>
      const roleKey = parsed.roleKey ?? parsed.to
      if (typeof roleKey === 'string') target = `${row.target_id ? `${row.target_id.slice(0, 8)} · ` : ''}${roleKey}`
    } catch {
      // A malformed metadata blob must not blank the panel.
    }
    return {
      at: new Date(row.created_at).toISOString(),
      actorLabel: row.actor_label ? maskEmail(row.actor_label) : '—',
      targetLabel: target || '—',
      action: row.action,
    }
  })
}

/**
 * Count issued challenges whose source address was the untrusted fallback.
 *
 * A ratio near 1 means no forwarder header ever reached the server, so every
 * per-IP budget in this deployment is shared by the whole site.
 */
function untrustedIssueRatio(sinceMs: number): number {
  const counts = captchaRepo.untrustedIssueCounts(getDb(), FALLBACK_IP, sinceMs)
  if (counts.issued === 0) return 0
  return counts.untrusted / counts.issued
}

/**
 * Assemble the whole panel.
 *
 * @param windowHours how far back the "24h" cards look; the query parameter exists
 *        so a test can move the window without waiting a day.
 */
export function posture(windowHours = 24): SecurityPosture {
  const now = Date.now()
  const since = now - windowHours * 60 * 60 * 1000

  const captchaCounts = captchaService.windowCounts(since)
  const answered = captchaCounts.solved + captchaCounts.failed
  const denied = auditRepo.countForAction(getDb(), 'authz.denied', since)
  const escalationDenied = auditRepo.countForAction(getDb(), 'authz.escalation_denied', since)

  return {
    rootAdmin: rootAdminPosture(),
    captcha: {
      issued24h: captchaCounts.issued,
      solved24h: captchaCounts.solved,
      failed24h: captchaCounts.failed,
      solveRate: answered === 0 ? null : captchaCounts.solved / answered,
      // The live value, not a card constant: an operator who raised the threshold
      // must see the number the gate actually enforces (spec §3.2.4).
      loginThreshold: settingsService.getNumber('captcha.requiredOnLoginAfterFailures'),
    },
    authorities: authorityDistribution(),
    denials: {
      denied,
      escalationDenied,
      topPermissions: topDeniedPermissions(since),
    },
    recentRoleChanges: recentRoleChanges(),
    untrustedIpRatio: untrustedIssueRatio(since),
  }
}
