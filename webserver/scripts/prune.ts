/**
 * `npm run db:prune -- [--audit-days 180] [--mail-days 30] [--dry-run]`
 *
 * Retention for the tables that grow without bound. Until this script existed the
 * README told operators to run hand-written SQL, which nobody does: the audit table
 * and the outbox end up either huge or manually truncated (and a manual truncate is
 * how evidence disappears).
 *
 * `--dry-run` prints the counts without deleting, which is the right first move on a
 * production database — and the Windows equivalent of a cron job (see
 * `deploy/cron.example`).
 */
import { openDatabase, setDbForTests } from '../src/server/db/client'
import { loadDotEnv } from '../src/server/env/loadEnv'
import { getConfig } from '../src/server/config'
import { runMigrations } from '../src/server/db/migrate'
import { getDb } from '../src/server/db/client'
import * as sessionsRepo from '../src/server/db/repositories/sessionsRepo'
import * as mailOutboxRepo from '../src/server/db/repositories/mailOutboxRepo'
import * as tokensRepo from '../src/server/db/repositories/emailActionTokensRepo'
import * as settingsService from '../src/server/services/settingsService'

const DAY = 24 * 60 * 60 * 1000

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : undefined
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function intArg(argv: string[], name: string, fallback: number): number {
  const raw = readArg(argv, name)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

loadDotEnv()

function main(): void {
  const argv = process.argv.slice(2)
  const dryRun = hasFlag(argv, 'dry-run')

  const config = getConfig()
  const db = openDatabase(config.databasePath)
  setDbForTests(db)
  runMigrations(db)

  const now = Date.now()
  const auditDays = intArg(argv, 'audit-days', settingsService.getNumber('audit.retentionDays'))
  const mailDays = intArg(argv, 'mail-days', 30)
  const capturedDays = 7
  const tokenGraceDays = 7

  const auditCutoff = now - auditDays * DAY
  const counts = {
    audit_events: (
      getDb().prepare('SELECT COUNT(*) AS count FROM audit_events WHERE created_at < ?').get(auditCutoff) as {
        count: number
      }
    ).count,
    mail_outbox: (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS count FROM mail_outbox
            WHERE (status IN ('sent','failed') AND created_at < ?)
               OR (status = 'captured' AND created_at < ?)`,
        )
        .get(now - mailDays * DAY, now - capturedDays * DAY) as { count: number }
    ).count,
    email_action_tokens: (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS count FROM email_action_tokens
            WHERE created_at < ? AND (used_at IS NOT NULL OR expires_at < ?)`,
        )
        .get(now - tokenGraceDays * DAY, now - tokenGraceDays * DAY) as { count: number }
    ).count,
    password_reset_tokens: (
      getDb()
        .prepare('SELECT COUNT(*) AS count FROM password_reset_tokens WHERE expires_at < ?')
        .get(now - tokenGraceDays * DAY) as { count: number }
    ).count,
    reuse_events: (
      getDb()
        .prepare('SELECT COUNT(*) AS count FROM refresh_token_reuse_events WHERE presented_at < ?')
        .get(now - 180 * DAY) as { count: number }
    ).count,
  }

  if (dryRun) {
    console.log(
      `[db:prune] dry-run audit_events=${counts.audit_events} mail_outbox=${counts.mail_outbox} ` +
        `email_action_tokens=${counts.email_action_tokens} ` +
        `password_reset_tokens=${counts.password_reset_tokens} reuse_events=${counts.reuse_events}`,
    )
    db.close()
    return
  }

  const deleted = {
    audit_events: getDb()
      .prepare('DELETE FROM audit_events WHERE created_at < ?')
      .run(auditCutoff).changes,
    mail_outbox: mailOutboxRepo.prune(db, {
      terminalBefore: now - mailDays * DAY,
      capturedBefore: now - capturedDays * DAY,
    }),
    email_action_tokens: tokensRepo.pruneBefore(db, now - tokenGraceDays * DAY),
    password_reset_tokens: getDb()
      .prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?')
      .run(now - tokenGraceDays * DAY).changes,
    reuse_events: getDb()
      .prepare('DELETE FROM refresh_token_reuse_events WHERE presented_at < ?')
      .run(now - 180 * DAY).changes,
    refresh_history: sessionsRepo.pruneRefreshHistory(db, now - 180 * DAY),
  }

  console.log(
    `[db:prune] audit_events=${deleted.audit_events} mail_outbox=${deleted.mail_outbox} ` +
      `email_action_tokens=${deleted.email_action_tokens} ` +
      `password_reset_tokens=${deleted.password_reset_tokens} ` +
      `reuse_events=${deleted.reuse_events} refresh_history=${deleted.refresh_history} ` +
      `(audit-days=${auditDays} mail-days=${mailDays})`,
  )
  db.close()
}

try {
  main()
} catch (error) {
  console.error(`[db:prune] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
