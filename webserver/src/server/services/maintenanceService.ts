import { getDb } from '@/server/db/client'
import * as settingsRepo from '@/server/db/repositories/settingsRepo'
import * as mailOutboxRepo from '@/server/db/repositories/mailOutboxRepo'
import * as emailActionTokensRepo from '@/server/db/repositories/emailActionTokensRepo'
import * as accountDeletionService from '@/server/services/accountDeletionService'
import * as captchaService from '@/server/services/captchaService'
import * as settingsService from '@/server/services/settingsService'
import { log } from '@/server/http/requestContext'

/**
 * Lazy housekeeping.
 *
 * `next start` has no resident worker and the project refuses to add a scheduler,
 * so the things that must happen "eventually" ride on the request path: expired
 * deletion requests are executed, spent tokens and old outbox rows are pruned, and
 * the maintenance timestamp gates the work to at most once an hour.
 *
 * Cost per request is one row read (`app_settings.system.lastSweepAt`) — under
 * 0.1 ms. The sweep itself is batched (`LIMIT 200`) and every step is logged,
 * never propagated: an unrelated user's pending deletion must not fail somebody
 * else's login.
 *
 * Retention here is the serverless equivalent of `npm run db:prune` (spec §4.2
 * assigns it to this service). Without it an installation that never wires a cron
 * job — every Windows deployment, and `deploy/cron.example` says as much — keeps
 * `email_action_tokens` and `mail_outbox` forever, i.e. exactly the rows holding
 * (redacted) one-time links that have long expired.
 */

const SWEEP_KEY = 'system.lastSweepAt'
const SWEEP_INTERVAL_MS = 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
/** Same windows as `scripts/prune.ts`; the CLI can still override them. */
const TOKEN_GRACE_DAYS = 7
const MAIL_TERMINAL_DAYS = 30
const MAIL_CAPTURED_DAYS = 7

/** The timestamp is internal: it is NOT in `SETTING_KEYS`, so no admin can set it. */
export function lastSweepAt(): number {
  const raw = settingsRepo.getAll(getDb())[SWEEP_KEY]
  const value = typeof raw === 'number' ? raw : Number(raw ?? 0)
  return Number.isFinite(value) ? value : 0
}

function stampSweep(now: number): void {
  settingsRepo.setMany(getDb(), { [SWEEP_KEY]: now }, null, now)
}

export interface SweepIfDueResult {
  ran: boolean
  deleted: number
  scanned: number
  failed: number
  /** Spent/expired email-action tokens removed by this round. */
  tokensPruned: number
  /** Outbox rows removed by this round. */
  mailsPruned: number
  /** Challenges dead for an hour or more, removed by this round. */
  captchasPruned: number
}

/**
 * Delete spent email-action tokens, outbox rows past retention, and dead
 * challenges.
 *
 * Its own try/catch: a retention failure (a locked table, a corrupt index) must
 * not skip the deletion sweep, which is the step with a correctness consequence.
 */
function pruneRetained(
  now: number,
): { tokensPruned: number; mailsPruned: number; captchasPruned: number } {
  const db = getDb()
  try {
    const tokensPruned = emailActionTokensRepo.pruneBefore(db, now - TOKEN_GRACE_DAYS * DAY)
    // `audit.retentionDays` is the operator's own knob for how long operational
    // history is kept; mail follows it rather than inventing a second policy.
    const mailDays = Math.max(MAIL_TERMINAL_DAYS, settingsService.getNumber('audit.retentionDays'))
    const mailsPruned = mailOutboxRepo.prune(db, {
      terminalBefore: now - mailDays * DAY,
      capturedBefore: now - MAIL_CAPTURED_DAYS * DAY,
    })
    // Challenges have no value after their TTL: a row exists to be solved once,
    // and an abandoned one is dead weight from `expires_at`. Without this step the
    // table grows with every page load of the sign-up form (spec R-4).
    const captchasPruned = captchaService.pruneRetained(now)
    if (tokensPruned > 0 || mailsPruned > 0 || captchasPruned > 0) {
      log('info', 'retention sweep finished', { tokensPruned, mailsPruned, captchasPruned })
    }
    return { tokensPruned, mailsPruned, captchasPruned }
  } catch (error) {
    log('warn', 'retention sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return { tokensPruned: 0, mailsPruned: 0, captchasPruned: 0 }
  }
}

/**
 * Run the sweep when the last one is older than an hour.
 *
 * Never throws.
 */
export function sweepIfDue(now = Date.now(), force = false): SweepIfDueResult {
  const skipped: SweepIfDueResult = {
    ran: false,
    deleted: 0,
    scanned: 0,
    failed: 0,
    tokensPruned: 0,
    mailsPruned: 0,
    captchasPruned: 0,
  }
  try {
    if (!force && now - lastSweepAt() < SWEEP_INTERVAL_MS) return skipped
    const result = accountDeletionService.sweepDue(now, 200)
    const retained = pruneRetained(now)
    stampSweep(now)
    if (result.deleted > 0 || result.failed > 0) {
      log('info', 'account sweep finished', { ...result })
    }
    return { ran: true, ...result, ...retained }
  } catch (error) {
    log('warn', 'account sweep failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return skipped
  }
}

/** Test/CLI seam: forget the timestamp so the next call sweeps immediately. */
export function resetSweepClockForTests(): void {
  settingsRepo.setMany(getDb(), { [SWEEP_KEY]: 0 }, null, Date.now())
}
