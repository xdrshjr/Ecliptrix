/**
 * In-process sliding-window rate limiter.
 *
 * Single instance is a documented constraint (spec §2.12), so a `Map` is honest
 * here: multi-replica deployments must move to a shared store, and the README
 * says so. Buckets are pruned lazily on access plus on a coarse timer, so an
 * attacker cycling identifiers cannot grow the map without bound.
 */

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface Bucket {
  hits: number[]
}

const buckets = new Map<string, Bucket>()
const MAX_BUCKETS = 20_000

function prune(bucket: Bucket, now: number, windowMs: number): void {
  const cutoff = now - windowMs
  while (bucket.hits.length > 0 && (bucket.hits[0] ?? 0) <= cutoff) {
    bucket.hits.shift()
  }
}

/**
 * Record one hit and report whether it is within budget.
 *
 * `windowMs` is part of the key: two call sites sharing a key but not a window
 * would otherwise read each other's history.
 */
export function hit(scope: string, key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const composite = `${scope}|${windowMs}|${key}`

  if (buckets.size > MAX_BUCKETS) {
    // Cheap overflow valve: drop the oldest half rather than growing forever.
    const keys = [...buckets.keys()].slice(0, Math.floor(buckets.size / 2))
    for (const stale of keys) buckets.delete(stale)
  }

  const existing = buckets.get(composite)
  const bucket: Bucket = existing ?? { hits: [] }
  prune(bucket, now, windowMs)
  bucket.hits.push(now)
  buckets.set(composite, bucket)

  const used = bucket.hits.length
  const allowed = used <= limit
  const oldest = bucket.hits[0] ?? now
  return {
    allowed,
    remaining: Math.max(0, limit - used),
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
  }
}

/** Remaining budget without recording a hit (used by UI hints and tests). */
export function peek(scope: string, key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(`${scope}|${windowMs}|${key}`)
  if (!bucket) return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
  prune(bucket, now, windowMs)
  const used = bucket.hits.length
  return {
    allowed: used < limit,
    remaining: Math.max(0, limit - used),
    retryAfterSeconds: 0,
  }
}

/** Forget a scope+key, e.g. after a successful login clears prior failures. */
export function reset(scope: string, key: string): void {
  for (const composite of [...buckets.keys()]) {
    if (composite.startsWith(`${scope}|`) && composite.endsWith(`|${key}`)) {
      buckets.delete(composite)
    }
  }
}

/** Drop everything — tests only. */
export function resetAll(): void {
  buckets.clear()
}

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE

/**
 * Fixed budgets (spec §4.6).
 *
 * `loginIdentifier` is deliberately set ABOVE the lockout threshold
 * (`security.loginMaxAttempts`, default 5). With the two equal, the fifth failure
 * locks the account and the sixth request is answered `429` by the limiter — so
 * `423 account_locked` becomes unreachable and the real control (exponential
 * lockout) is never observed. The limiter is a coarse flood guard; the lockout is
 * the credential control.
 */
export const LIMITS = {
  loginIp: { limit: 20, windowMs: 5 * MINUTE },
  loginIdentifier: { limit: 12, windowMs: 5 * MINUTE },
  registerIp: { limit: 10, windowMs: HOUR },
  resetIp: { limit: 3, windowMs: HOUR },
  /**
   * Confirming a reset token gets its own bucket, not a share of `resetIp`.
   *
   * Spec §4.6 lists one `reset:ip` scope and §4.2 does not rate-limit the confirm
   * endpoint at all. Sharing the bucket looks harmless until you count: three
   * mistyped confirmation codes exhaust the hour, and the user can no longer
   * *request* a new link — the endpoint chain locks itself out, which is the one
   * thing a recovery flow must never do. Separate buckets keep the anti-brute-
   * force guard on both endpoints without letting one consume the other.
   */
  resetConfirmIp: { limit: 10, windowMs: HOUR },
  adminWrite: { limit: 120, windowMs: MINUTE },
  heartbeatSession: { limit: 60, windowMs: HOUR },
  readUser: { limit: 600, windowMs: MINUTE },
  /** Resend a verification mail: per account and per source address. */
  mailVerifyResend: { limit: 3, windowMs: HOUR },
  mailVerifyResendIp: { limit: 10, windowMs: HOUR },
  mailChangeEmail: { limit: 3, windowMs: 24 * HOUR },
  mailInvite: { limit: 60, windowMs: HOUR },
  mailDeletion: { limit: 3, windowMs: HOUR },
  /**
   * The two session-less consumers (`/auth/email/verify`, `/auth/deletion/confirm`).
   * The token is 32 random bytes and cannot be brute-forced, but each call does a
   * database lookup and possibly an audit write, so an unbudgeted endpoint is a
   * free amplification surface.
   */
  emailVerifyConsume: { limit: 60, windowMs: HOUR },
  /** Data export is expensive and is meant to be occasional. */
  accountExport: { limit: 10, windowMs: HOUR },
  /**
   * Challenge issuing. Also the table-growth ceiling: one insert per issue, and
   * the hourly retention sweep assumes the issue rate is bounded.
   *
   * ⚠ In a deployment with no trusted forwarder `clientIpFrom` returns the
   * constant `0.0.0.0`, so every visitor shares this bucket. Sixty per hour for a
   * whole site is a registration denial of service rather than a flood guard,
   * which is why `captchaService.issue` adds a second, body-derived dimension
   * when the address is not trustworthy (spec §3.2.2, review R-02).
   */
  captchaIssue: { limit: 60, windowMs: HOUR },
} as const
