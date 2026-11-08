import type { Db } from '@/server/db/client'
import type { PageRequest } from '@/server/http/pagination'
import { scalarCount, scalarCountNamed } from '@/server/db/repositories/shared'

/**
 * Mail outbox.
 *
 * The row is written BEFORE any delivery attempt, so "the process died mid-send"
 * still leaves evidence and the console can answer "did that mail go out?".
 *
 * `body_text` is stored with tokens already redacted (`token=***`) and `html` is
 * never persisted: the outbox is an operational log that administrators read, not
 * a copy of the message that was sent.
 */

export type MailStatus = 'captured' | 'sent' | 'failed'

export interface MailOutboxRow {
  id: string
  template: string
  to_email: string
  to_user_id: string | null
  locale: string
  subject: string
  body_text: string
  payload: string
  retryable: number
  status: MailStatus
  attempts: number
  last_error: string
  created_at: number
  sent_at: number | null
}

export interface CreateMailInput {
  id: string
  template: string
  toEmail: string
  toUserId: string | null
  locale: string
  subject: string
  bodyText: string
  payload: Record<string, unknown>
  retryable: boolean
  status: MailStatus
  /** `daily_cap` even though the mail was never attempted. */
  lastError?: string
  now: number
}

export function create(db: Db, input: CreateMailInput): void {
  db.prepare(
    `INSERT INTO mail_outbox (
       id, template, to_email, to_user_id, locale, subject, body_text, payload,
       retryable, status, attempts, last_error, created_at
     ) VALUES (
       @id, @template, @toEmail, @toUserId, @locale, @subject, @bodyText, @payload,
       @retryable, @status, 0, @lastError, @now
     )`,
  ).run({
    ...input,
    payload: JSON.stringify(input.payload ?? {}),
    retryable: input.retryable ? 1 : 0,
    lastError: input.lastError ?? '',
  })
}

export function findById(db: Db, id: string): MailOutboxRow | undefined {
  return db.prepare('SELECT * FROM mail_outbox WHERE id = ?').get(id) as MailOutboxRow | undefined
}

/** Record the outcome of one attempt. `sent` also stamps `sent_at`. */
export function markAttempt(
  db: Db,
  id: string,
  input: { ok: boolean; errorName?: string; now: number },
): void {
  if (input.ok) {
    db.prepare(
      `UPDATE mail_outbox
          SET status = 'sent', attempts = attempts + 1, last_error = '', sent_at = @now
        WHERE id = @id`,
    ).run({ id, now: input.now })
    return
  }
  db.prepare(
    `UPDATE mail_outbox
        SET status = 'failed', attempts = attempts + 1, last_error = @errorName
      WHERE id = @id`,
  ).run({ id, now: input.now, errorName: (input.errorName ?? 'Error').slice(0, 200) })
}

/** Put a retryable row back into `captured` before its next attempt. */
export function resetForRetry(db: Db, id: string): void {
  db.prepare("UPDATE mail_outbox SET status = 'captured' WHERE id = ?").run(id)
}

export interface MailFilter {
  status?: MailStatus
  template?: string
  toUserId?: string
}

function buildFilter(filter: MailFilter): { where: string; params: Record<string, unknown> } {
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.status) {
    clauses.push('status = @status')
    params.status = filter.status
  }
  if (filter.template) {
    clauses.push('template = @template')
    params.template = filter.template
  }
  if (filter.toUserId) {
    clauses.push('to_user_id = @toUserId')
    params.toUserId = filter.toUserId
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

export function list(
  db: Db,
  filter: MailFilter,
  page: PageRequest,
): { rows: MailOutboxRow[]; total: number } {
  const { where, params } = buildFilter(filter)
  const total = scalarCountNamed(db, `SELECT COUNT(*) AS count FROM mail_outbox ${where}`, params)
  const rows = db
    .prepare(
      `SELECT * FROM mail_outbox ${where} ORDER BY created_at DESC
        LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit: page.pageSize, offset: page.offset }) as MailOutboxRow[]
  return { rows, total }
}

/** Rows written for one account in a window — the daily cap reads this. */
export function countForUserSince(db: Db, userId: string, sinceMs: number): number {
  return scalarCount(
    db,
    'SELECT COUNT(*) AS count FROM mail_outbox WHERE to_user_id = ? AND created_at >= ?',
    [userId, sinceMs],
  )
}

/** Last-24h counters for the settings page ("31 sent / 0 failed"). */
export function countByStatusSince(db: Db, sinceMs: number): Record<MailStatus, number> {
  const rows = db
    .prepare(
      'SELECT status, COUNT(*) AS count FROM mail_outbox WHERE created_at >= ? GROUP BY status',
    )
    .all(sinceMs) as { status: MailStatus; count: number }[]
  const out: Record<MailStatus, number> = { captured: 0, sent: 0, failed: 0 }
  for (const row of rows) out[row.status] = row.count
  return out
}

/**
 * Retention sweep.
 *
 * Terminal rows follow the configured window; `captured` rows are kept for a
 * week only, because an un-attempted row is either a degraded-mode artefact or a
 * bug, and neither is worth keeping forever.
 */
export function prune(
  db: Db,
  input: { terminalBefore: number; capturedBefore: number },
): number {
  const terminal = db
    .prepare(
      "DELETE FROM mail_outbox WHERE status IN ('sent', 'failed') AND created_at < ?",
    )
    .run(input.terminalBefore).changes
  const captured = db
    .prepare("DELETE FROM mail_outbox WHERE status = 'captured' AND created_at < ?")
    .run(input.capturedBefore).changes
  return terminal + captured
}
