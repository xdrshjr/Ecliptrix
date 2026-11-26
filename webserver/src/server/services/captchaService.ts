import { createHash, randomInt } from 'node:crypto'
import { getConfig } from '@/server/config'
import { getDb } from '@/server/db/client'
import * as captchaRepo from '@/server/db/repositories/captchaRepo'
import * as loginAttemptsRepo from '@/server/db/repositories/loginAttemptsRepo'
import * as auditService from '@/server/services/auditService'
import * as settingsService from '@/server/services/settingsService'
import { renderCaptcha, CAPTCHA_HEIGHT, CAPTCHA_WIDTH } from '@/server/services/captchaRender'
import { CAPTCHA_ALPHABET } from '@/server/services/captchaGlyphs'
import { newId } from '@/server/auth/tokens'
import { hit, LIMITS } from '@/server/auth/rateLimit'
import { errors } from '@/server/http/errors'
import { ERROR_CODE } from '@/server/auth/constants'
import { FALLBACK_IP } from '@/server/http/requestContext'
import type { CaptchaPurpose } from '@/server/db/types'

/**
 * Human verification — issuing, checking and expiring challenges.
 *
 * The service is the only place that sees a plaintext answer in flight: it draws
 * one, hashes it, renders the stroke image and forgets it. `captchaRepo` stores
 * only `HMAC(SESSION_SECRET, ${id}.${answer})`, so a dump of `captcha_challenges`
 * cannot be replayed (spec §3.1 rule 2).
 *
 * ## Why there is no `captcha.enabled` switch
 *
 * The first switch an operator turns off during an incident is the safety switch.
 * A deployment that can disable its own registration gate from the console can be
 * walked past by anybody holding one stolen admin session. Turning the gate off is
 * a version rollback (spec §10 回滚). `requiredOnLoginAfterFailures = 0` disables
 * only the LOGIN escalation, which is not unconditional to begin with.
 */

/** Normalise an answer the way a human types it: trim, drop spaces, fold case. */
export function normaliseAnswer(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '')
    .normalize('NFKC')
    .toUpperCase()
}

/**
 * `HMAC(SESSION_SECRET, id.answer)` in hex.
 *
 * The id is part of the input so two challenges that happen to draw the same
 * letters still hash differently — otherwise a solved challenge would fingerprint
 * every future one with the same answer.
 */
function answerHash(id: string, answer: string): string {
  return createHash('sha256')
    .update(`${getConfig().sessionSecret}|${id}|${normaliseAnswer(answer)}`, 'utf8')
    .digest('hex')
}

function drawAnswer(length: number): string {
  let out = ''
  for (let index = 0; index < length; index += 1) {
    // `randomInt` is drawn from the CSPRNG; a challenge built with `Math.random`
    // would be predictable to a script that watched a few thousand of them.
    out += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)]
  }
  return out
}

/**
 * Stable per-caller key when the address is not trustworthy.
 *
 * `clientIpFrom` returns the constant `0.0.0.0` whenever `TRUST_PROXY` is on and
 * no forwarder header arrived. Bucketing all of those under one key would make
 * `60/hour` a site-wide cap — one script could deny registration to everybody
 * (spec §3.2.2, review R-02). The fingerprint keeps the budget per user agent
 * instead of per site.
 */
export function rateKeyFor(ip: string, userAgent: string): string {
  if (ip !== FALLBACK_IP) return ip
  return `fp:${createHash('sha256').update(`${ip}|${userAgent}`).digest('hex').slice(0, 24)}`
}

/** Why the caller is being challenged, as returned to the client. */
export interface IssuedCaptcha {
  id: string
  purpose: CaptchaPurpose
  svg: string
  width: number
  height: number
  /**
   * How many characters this challenge shows.
   *
   * Sent because the answer length is a runtime setting (4–7) while the input's
   * `maxLength` is client-side: a hard-coded six would silently refuse the seventh
   * character of a `captcha.length = 7` challenge, and the user would see a full
   * image and a field that will not take the last letter.
   */
  length: number
  expiresAt: string
  /** Only when `e2eMode` and the caller is loopback — see `debugAnswerAllowed`. */
  debugAnswer?: string
}

/**
 * Is the e2e debug answer permitted for this context?
 *
 * Two gates: `e2eMode` (impossible in production — `config.ts` refuses it) AND a
 * loopback source. The loopback set includes `0.0.0.0` on purpose: that is what
 * `clientIpFrom` returns for a direct connection with no forwarder header, which
 * is exactly how `scripts/smoke.mjs` reaches the server. Excluding it made the
 * backdoor unreachable (review R-02). The two conditions cannot coincide in
 * production because `e2eMode` is then always false.
 */
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', FALLBACK_IP])

export function debugAnswerAllowed(ip: string): boolean {
  return getConfig().e2eMode && LOOPBACK_ADDRESSES.has(ip)
}

/**
 * Issue a challenge.
 *
 * @throws {AppError} `rate_limited` when this caller is over its issue budget.
 */
export function issue(
  purpose: CaptchaPurpose,
  context: { ip: string; userAgent: string; requestId: string },
): IssuedCaptcha {
  const limit = hit(
    'captcha:issue',
    rateKeyFor(context.ip, context.userAgent),
    LIMITS.captchaIssue.limit,
    LIMITS.captchaIssue.windowMs,
  )
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfterSeconds)

  const now = Date.now()
  const length = settingsService.getNumber('captcha.length')
  const ttlSeconds = settingsService.getNumber('captcha.ttlSeconds')
  const maxAttempts = settingsService.getNumber('captcha.maxAttempts')

  const id = newId()
  const answer = drawAnswer(length)
  const expiresAt = now + ttlSeconds * 1000

  captchaRepo.insert(getDb(), {
    id,
    purpose,
    answerHash: answerHash(id, answer),
    ip: context.ip,
    maxAttempts,
    expiresAt,
    now,
  })

  // The audit row records the fact, never the answer or even the id's fate.
  auditService.record(
    { actorUserId: null, actorLabel: 'anonymous', ip: context.ip, requestId: context.requestId },
    { action: 'captcha.issued', targetType: 'captcha', targetId: '', metadata: { purpose } },
  )

  const issued: IssuedCaptcha = {
    id,
    purpose,
    svg: renderCaptcha({ id, answer, width: CAPTCHA_WIDTH, height: CAPTCHA_HEIGHT }),
    width: CAPTCHA_WIDTH,
    height: CAPTCHA_HEIGHT,
    length,
    expiresAt: new Date(expiresAt).toISOString(),
  }
  if (debugAnswerAllowed(context.ip)) issued.debugAnswer = answer
  return issued
}

export interface CaptchaSubmission {
  captchaId?: string
  captchaAnswer?: string
}

/** Everything a check needs beyond the submission itself. */
export interface CaptchaCheckContext {
  purpose: CaptchaPurpose
  ip: string
  requestId: string
}

/**
 * Consume a challenge inside the caller's transaction.
 *
 * Must be called FIRST inside the registration transaction (spec §3.7, review
 * R-03): if the uniqueness check ran before this, a failed sign-up would leave
 * the challenge unconsumed and the same id could be replayed to probe whether an
 * address exists. Consuming first means a wrong attempt always costs the image.
 *
 * @throws {AppError} `captcha_required` when nothing was submitted;
 *         `captcha_expired` when the challenge is past its TTL;
 *         `captcha_invalid` for a wrong answer, an already-used id, a purpose
 *         mismatch or an exhausted attempt budget.
 */
export function consumeOrThrow(submission: CaptchaSubmission, context: CaptchaCheckContext): void {
  const id = submission.captchaId?.trim()
  const answer = submission.captchaAnswer?.trim()
  if (!id || !answer) throw errors.captchaRequired(context.purpose)

  const db = getDb()
  const row = captchaRepo.findById(db, id)
  const now = Date.now()

  // Unknown id, wrong purpose, already consumed: all one answer. Distinguishing
  // them would let a caller probe which ids ever existed.
  if (!row || row.purpose !== context.purpose || row.consumed_at !== null) {
    recordFailure(context, row?.purpose ?? context.purpose, row?.attempts ?? 0, 'unknown_or_used')
    throw errors.captchaInvalid(0)
  }
  if (row.expires_at <= now) {
    recordFailure(context, context.purpose, row.attempts, 'expired')
    throw errors.captchaExpired(new Date(row.expires_at).toISOString())
  }
  if (row.attempts >= row.max_attempts) {
    recordFailure(context, context.purpose, row.attempts, 'exhausted')
    throw errors.captchaInvalid(0)
  }

  if (answerHash(id, answer) !== row.answer_hash) {
    const attempts = captchaRepo.bumpAttempts(db, id)
    const remaining = Math.max(0, row.max_attempts - attempts)
    recordFailure(context, context.purpose, attempts, 'wrong_answer')
    throw errors.captchaInvalid(remaining)
  }

  // Atomic: two concurrent requests holding the same id produce one winner.
  if (!captchaRepo.consume(db, id, now)) {
    recordFailure(context, context.purpose, row.attempts, 'race_lost')
    throw errors.captchaInvalid(0)
  }

  // A genuine network switch is tolerated (mobile carriers reassign addresses
  // mid-session); the mismatch is still worth a line for an incident responder.
  if (row.ip !== '' && row.ip !== context.ip) {
    auditService.record(
      { actorUserId: null, actorLabel: 'anonymous', ip: context.ip, requestId: context.requestId },
      {
        action: 'captcha.ip_mismatch',
        targetType: 'captcha',
        targetId: '',
        metadata: { purpose: context.purpose, issuedIp: row.ip, usedIp: context.ip },
      },
    )
  }
}

function recordFailure(
  context: CaptchaCheckContext,
  purpose: CaptchaPurpose,
  attempts: number,
  reason: string,
): void {
  auditService.record(
    { actorUserId: null, actorLabel: 'anonymous', ip: context.ip, requestId: context.requestId },
    {
      action: 'captcha.failed',
      targetType: 'captcha',
      targetId: '',
      metadata: { purpose, attempts, reason },
    },
  )
}

/**
 * Does a login from this caller have to solve a challenge?
 *
 * The threshold catches the blind spot the per-account lockout leaves: one host
 * walking a list of accounts never trips any single account's counter. Login is
 * NOT gated unconditionally — that would put a step in front of every legitimate
 * sign-in while the lockout already handles targeted brute force (spec §3.2.4).
 *
 * Two dimensions, both required by the spec: the identifier counter catches a
 * targeted attack, the address counter catches one machine sweeping accounts.
 * `countFailuresByIpSince` did not exist before this feature even though its index
 * (`idx_attempts_ip`) did (review R-08).
 *
 * `0` disables the escalation entirely.
 */
export function loginRequiresCaptcha(
  identifierNormalized: string,
  ip: string,
  userAgent = '',
): boolean {
  const threshold = settingsService.getNumber('captcha.requiredOnLoginAfterFailures')
  if (threshold <= 0) return false
  const since = Date.now() - 15 * 60 * 1000
  if (loginAttemptsRepo.countFailuresSince(getDb(), identifierNormalized, since) >= threshold) {
    return true
  }
  // The address dimension MUST read through `rateKeyFor`, and `recordAttempt` must
  // write through the same function, or the two disagree and this counter stays at
  // zero forever (review R-V4-03 / RV-8). Under a direct connection with no
  // forwarder header the address is the constant `0.0.0.0`; counting that raw value
  // would pool every visitor into one bucket, so three failures by anybody would
  // demand a captcha from everybody — a site-wide login denial of service.
  return loginAttemptsRepo.countFailuresByIpSince(getDb(), rateKeyFor(ip, userAgent), since) >= threshold
}

/** One way a caller can fail, for the posture page's "how much did the gate stop". */
export function windowCounts(sinceMs: number): captchaRepo.CaptchaWindowCounts {
  return captchaRepo.windowCounts(getDb(), sinceMs)
}

/** Retention: drop challenges dead for an hour or more. Returns rows removed. */
export function pruneRetained(now: number): number {
  return captchaRepo.pruneBefore(getDb(), now - 60 * 60 * 1000)
}

export { ERROR_CODE }
export type { CaptchaPurpose }
