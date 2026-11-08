import { getDb } from '@/server/db/client'
import * as outboxRepo from '@/server/db/repositories/mailOutboxRepo'
import { isMailEnabled, sendRaw, fromAddress } from '@/server/mail/mailer'
import {
  isRetryableTemplate,
  renderMail,
  type MailParams,
  type MailTemplateKey,
} from '@/server/mail/templates'
import { ERROR_CODE } from '@/server/auth/constants'
import { AppError } from '@/server/http/errors'
import { log } from '@/server/http/requestContext'
import { maskEmail } from '@/server/services/privacy'
import { getConfig } from '@/server/config'
import { newId } from '@/server/auth/tokens'
import type { Locale } from '@/lib/i18n'

/**
 * The single mail exit.
 *
 * Shape of every send (spec §3.3):
 *   render → insert the outbox row (payload already redacted) → ONE bounded
 *   delivery attempt → write the outcome back.
 *
 * The row is inserted first on purpose: a crash mid-send still leaves evidence,
 * and `captured` (SMTP off) is a first-class state rather than an error, because
 * "no SMTP configured" is a supported deployment mode.
 *
 * `queue()` never throws on delivery problems. Callers on a user-facing hot path
 * fire it without awaiting (`void queue(...)`); the outcome lives in the outbox so
 * the console can retry it, and a mail outage must not change an API result.
 */

export const DAILY_CAP_PER_USER = 20

export interface QueueMailInput {
  template: MailTemplateKey
  to: string
  locale?: Locale
  /** Null for mails that are not about an account (an invite to a stranger). */
  userId?: string | null
  params: Omit<MailParams, 'maskedEmail'> & { maskedEmail?: string }
}

export interface QueueResult {
  id: string
  status: outboxRepo.MailStatus
  /** True when the daily cap swallowed it without an attempt. */
  capped: boolean
}

/** `?token=…` in a link. */
const TOKEN_PATTERN = /token=[A-Za-z0-9_%.-]+/g
/** `?invite=…` in a registration link. */
const INVITE_LINK_PATTERN = /invite=[A-Za-z0-9_-]+/g
/**
 * The invite code printed as a line of its own, in both locales:
 * `Your one-time invite code: ECL-XXXX-XXXX-XXXX` / `一次性邀请码：ECL-…`.
 */
const INVITE_CODE_LINE_PATTERN =
  /((?:invite code|邀请码)\s*[:：]\s*)([A-Za-z0-9][A-Za-z0-9-]{3,})/gi

/**
 * Replace every one-time secret in a stored body.
 *
 * The outbox is readable by every administrator; a live reset, verification or
 * invite code in it is a credential in a log. It is also copied by
 * `db:backup`, so "only administrators can read it" is not the whole exposure.
 *
 * Covers all three shapes the templates emit: `token=` (reset, verify, deletion
 * confirm), `invite=` (the registration link) and the bare invite code line.
 * The real secret still exists in the message actually handed to SMTP — only the
 * stored copy is redacted, which is also why those rows are `retryable = 0`.
 */
export function redactTokens(text: string): string {
  return text
    .replace(TOKEN_PATTERN, 'token=***')
    .replace(INVITE_LINK_PATTERN, 'invite=***')
    .replace(INVITE_CODE_LINE_PATTERN, '$1***')
}

/**
 * Queue one mail and attempt it once.
 *
 * @returns the outbox id and the resulting status. Never throws for a delivery
 *          failure; a *rendering* failure is a programming error and does throw.
 */
export async function queue(input: QueueMailInput): Promise<QueueResult> {
  const db = getDb()
  const now = Date.now()
  const locale: Locale = input.locale ?? 'zh-CN'
  const rendered = renderMail(input.template, input.params, locale)
  const retryable = isRetryableTemplate(input.template)
  const id = newId()

  const capped =
    input.userId !== undefined && input.userId !== null
      ? outboxRepo.countForUserSince(db, input.userId, now - 24 * 60 * 60 * 1000) >=
        DAILY_CAP_PER_USER
      : false

  outboxRepo.create(db, {
    id,
    template: input.template,
    toEmail: input.to,
    toUserId: input.userId ?? null,
    locale,
    subject: rendered.subject,
    bodyText: redactTokens(rendered.text),
    payload: {
      template: input.template,
      toMasked: maskEmail(input.to),
      // Never a token, a link or a password: metadata only.
      fields: Object.keys(input.params).filter((key) => key !== 'link'),
    },
    retryable,
    // A capped mail is captured but never attempted; the cap is visible as an
    // outbox row rather than a silent drop, which is the only way an operator can
    // see "a compromised account tried to become a mail relay".
    status: 'captured',
    lastError: capped ? 'daily_cap' : '',
    now,
  })

  if (capped) {
    log('warn', 'mail daily cap reached', { userId: input.userId, template: input.template })
    return { id, status: 'captured', capped: true }
  }

  // The real message (token included) is used for THIS attempt only; the stored
  // copy above is the redacted one.
  const status = await attempt(id, {
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  })
  return { id, status, capped: false }
}

/**
 * Fire-and-forget variant for the user hot paths.
 *
 * A rejection here would be a rendering bug (a delivery failure is already
 * contained), so it is logged and swallowed rather than becoming an unhandled
 * rejection that takes the process down.
 */
export function queueInBackground(input: QueueMailInput): void {
  void queue(input).catch((error: unknown) => {
    log('error', 'mail queue failed', {
      template: input.template,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

interface AttemptMessage {
  subject: string
  text: string
  html?: string
}

function cleanErrorName(name: string): string {
  return name.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60) || 'Error'
}

/** One bounded delivery attempt for an existing row. Never throws for SMTP. */
async function attempt(
  outboxId: string,
  message: AttemptMessage,
): Promise<outboxRepo.MailStatus> {
  const db = getDb()
  if (!isMailEnabled()) {
    // Degraded mode: stay `captured`. Not an error, and not "failed" either —
    // the console renders it as "recorded only".
    return 'captured'
  }
  const row = outboxRepo.findById(db, outboxId)
  if (!row) throw new AppError(ERROR_CODE.notFound, '邮件不存在')
  const result = await sendRaw({ to: row.to_email, ...message })
  outboxRepo.markAttempt(db, outboxId, {
    ok: result.ok,
    errorName: result.ok ? undefined : cleanErrorName(result.errorName),
    now: Date.now(),
  })
  if (!result.ok) {
    log('warn', 'mail delivery failed', {
      outboxId,
      template: row.template,
      errorName: cleanErrorName(result.errorName),
    })
  }
  return result.ok ? 'sent' : 'failed'
}

/**
 * Re-attempt a stored row (the console's retry path).
 *
 * The body comes from `body_text`, which is only correct for `retryable = 1`
 * rows — those carry no token. Secret rows are refused by `retry()` before this
 * is reached.
 *
 * @returns the status after the attempt. Never throws for SMTP failures.
 */
export async function deliver(outboxId: string): Promise<outboxRepo.MailStatus> {
  const row = outboxRepo.findById(getDb(), outboxId)
  if (!row) throw new AppError(ERROR_CODE.notFound, '邮件不存在')
  return attempt(outboxId, { subject: row.subject, text: row.body_text })
}

/**
 * Re-send a captured or failed row from the console.
 *
 * Only `retryable = 1` rows qualify: a token mail stores `token=***`, so a retry
 * would deliver a broken link. The admin is told to ask the user to request a new
 * one instead.
 *
 * @throws {AppError} `not_found` | `conflict` (not retryable / already sent)
 */
export async function retry(outboxId: string): Promise<outboxRepo.MailOutboxRow> {
  const db = getDb()
  const row = outboxRepo.findById(db, outboxId)
  if (!row) throw new AppError(ERROR_CODE.notFound, '邮件不存在')
  if (row.retryable !== 1) {
    throw new AppError(ERROR_CODE.conflict, '该邮件含一次性链接，不能重试；请让用户重新申请', {
      details: { retryable: false },
    })
  }
  if (row.status === 'sent') {
    throw new AppError(ERROR_CODE.conflict, '该邮件已经发送成功')
  }
  outboxRepo.resetForRetry(db, outboxId)
  await deliver(outboxId)
  const updated = outboxRepo.findById(db, outboxId)
  if (!updated) throw new AppError(ERROR_CODE.notFound, '邮件不存在')
  return updated
}

export interface MailCapabilities {
  mode: 'smtp' | 'outbox'
  fromAddress: string
  configured: boolean
  sent24h: number
  failed24h: number
  sendTimeoutMs: number
}

/** Read-only capability block for the settings page (not a setting key). */
export function capabilities(): MailCapabilities {
  const counts = outboxRepo.countByStatusSince(getDb(), Date.now() - 24 * 60 * 60 * 1000)
  return {
    mode: isMailEnabled() ? 'smtp' : 'outbox',
    fromAddress: fromAddress(),
    configured: isMailEnabled(),
    sent24h: counts.sent,
    failed24h: counts.failed,
    sendTimeoutMs: getConfig().mailSendTimeoutMs,
  }
}

export { isMailEnabled }
