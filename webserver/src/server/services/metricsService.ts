import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as attemptsRepo from '@/server/db/repositories/loginAttemptsRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'
import * as deletionRepo from '@/server/db/repositories/deletionRequestsRepo'
import * as releasesRepo from '@/server/db/repositories/releasesRepo'

/**
 * Operational metrics for the console overview.
 *
 * Every figure is one indexed aggregate; no figure scans the audit table. The
 * console renders these inside a single request, so the budget is per-query
 * sub-millisecond on SQLite at 10k users (spec §8.2).
 */

const DAY_MS = 24 * 60 * 60 * 1000

export interface TrendPoint {
  date: string
  count: number
}

export interface OverviewMetrics {
  totalUsers: number
  activeUsers7d: number
  newToday: number
  newLast7d: number
  activeSessions: number
  suspendedUsers: number
  lockedUsers: number
  mustChangePassword: number
  roleBreakdown: { roleKey: string; roleName: string; count: number }[]
  registrationTrend: TrendPoint[]
  topFailedIdentifiers: { identifier: string; failures: number }[]
  generatedAt: string
}

/**
 * The overview grew by four series and two ratios (spec §3.9).
 *
 * Everything is still one indexed aggregate per figure — the new indexes on
 * `sessions(created_at)` and `login_attempts(created_at)` (migration 0005) exist
 * precisely so the per-day grouping does not degrade into a table scan.
 */
export interface OverviewMetricsV2 extends OverviewMetrics {
  /** `registrationTrend` is already part of the base shape. */
  loginsTrend: TrendPoint[]
  sessionsTrend: TrendPoint[]
  emailVerifiedRate: number
  pendingDeletions: number
  clientBreakdown: { platform: string; appVersion: string; sessions: number }[]
  /** Echoed back so the chart can label its own x-axis without guessing. */
  rangeDays: number
  /**
   * Client-release counters (R9). Reuses the existing overview rather than adding
   * a second metrics surface: "did the new build actually get downloaded?" is the
   * question an operator asks right after publishing.
   */
  releaseDownloads: number
  releaseStatus: { draft: number; published: number; retracted: number }
  releaseBreakdown: { version: string; platform: string; downloads: number }[]
}

/**
 * UTC midnight of the day containing `ms`.
 *
 * Deliberately UTC, and it is the only time base in this file. The per-day SQL
 * groups on `created_at / 86400000`, which *is* a UTC day, so a local-midnight
 * boundary produces three different bases in one series: the query window starts
 * at a local midnight, the buckets are UTC days, and the labels were rendered from
 * the local instant with `toISOString()`. On a UTC+8 host that made every label one
 * day early and left the "today" bar at 0 for most of the working day, because
 * local-midnight→08:00 events land in the previous UTC bucket.
 *
 * A deployment-local timezone would be nicer to look at and wrong to reason about:
 * the console must agree with the rows it is counting.
 */
function startOfDay(ms: number): number {
  return Math.floor(ms / DAY_MS) * DAY_MS
}

function registrationTrend(days: number, now: number): TrendPoint[] {
  const db = getDb()
  const from = startOfDay(now - (days - 1) * DAY_MS)
  const rows = db
    .prepare(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS count
         FROM users
        WHERE created_at >= ? AND status <> 'deleted'
        GROUP BY day`,
    )
    .all(from) as { day: number; count: number }[]

  const byDay = new Map(rows.map((row) => [row.day, row.count]))
  const points: TrendPoint[] = []
  for (let index = 0; index < days; index += 1) {
    // `from` is already day-aligned, so this stays on the same UTC grid the SQL
    // grouped on and `Math.floor(dayStart / DAY_MS)` is exactly `row.day`.
    const dayStart = from + index * DAY_MS
    const isoDate = new Date(dayStart).toISOString().slice(0, 10)
    points.push({ date: isoDate, count: byDay.get(Math.floor(dayStart / DAY_MS)) ?? 0 })
  }
  return points
}

function roleBreakdown(): { roleKey: string; roleName: string; count: number }[] {
  return rolesRepo.listAll(getDb()).map((role) => ({
    roleKey: role.key,
    roleName: role.name,
    count: usersRepo.countByRole(getDb(), role.id),
  }))
}

const SERIES_TABLES = new Set(['login_attempts', 'sessions'])

/**
 * One per-day series.
 *
 * The table name is whitelisted rather than interpolated from a caller string:
 * these are the only two tables with a `created_at` worth trending, and a template
 * literal is how an ORDER BY injection starts. `extraWhere` is a fixed literal
 * written by this file, never user input.
 */
function dailySeries(
  table: 'login_attempts' | 'sessions',
  extraWhere: string | null,
  days: number,
  now: number,
): TrendPoint[] {
  if (!SERIES_TABLES.has(table)) throw new Error(`unsupported trend table: ${table}`)
  const db = getDb()
  const from = startOfDay(now - (days - 1) * DAY_MS)
  const where = extraWhere ? `AND ${extraWhere}` : ''
  const rows = db
    .prepare(
      `SELECT CAST(created_at / 86400000 AS INTEGER) AS day, COUNT(*) AS count
         FROM ${table}
        WHERE created_at >= ? ${where}
        GROUP BY day`,
    )
    .all(from) as { day: number; count: number }[]

  const byDay = new Map(rows.map((row) => [row.day, row.count]))
  const points: TrendPoint[] = []
  for (let index = 0; index < days; index += 1) {
    const dayStart = from + index * DAY_MS
    points.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      count: byDay.get(Math.floor(dayStart / DAY_MS)) ?? 0,
    })
  }
  return points
}

/** Which client builds are actually in use — the "did the update land" question. */
function clientBreakdown(now: number): { platform: string; appVersion: string; sessions: number }[] {
  return getDb()
    .prepare(
      `SELECT platform, app_version AS appVersion, COUNT(*) AS sessions
         FROM sessions
        WHERE revoked_at IS NULL AND access_expires_at > ?
        GROUP BY platform, app_version
        ORDER BY sessions DESC
        LIMIT 10`,
    )
    .all(now) as { platform: string; appVersion: string; sessions: number }[]
}

export function overview(now = Date.now(), days = 14): OverviewMetricsV2 {
  const db = getDb()
  const byStatus = usersRepo.countByStatus(db)
  const range = Math.min(90, Math.max(7, Math.trunc(days) || 14))

  const activeUsers7d = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM users
          WHERE last_login_at IS NOT NULL AND last_login_at >= ? AND status <> 'deleted'`,
      )
      .get(now - 7 * DAY_MS) as { count: number }
  ).count

  const lockedUsers = (
    db
      .prepare('SELECT COUNT(*) AS count FROM users WHERE locked_until IS NOT NULL AND locked_until > ?')
      .get(now) as { count: number }
  ).count

  const mustChangePassword = (
    db
      .prepare(
        // Single quotes: SQLite treats a double-quoted token as an identifier and
        // fails with `no such column: "deleted"` at runtime, not at build time.
        "SELECT COUNT(*) AS count FROM users WHERE must_change_password = 1 AND status <> 'deleted'",
      )
      .get() as { count: number }
  ).count

  const verifiedRow = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN email_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified
       FROM users WHERE status <> 'deleted'`,
    )
    .get() as { total: number; verified: number | null }

  return {
    totalUsers: usersRepo.countAll(db),
    activeUsers7d,
    newToday: usersRepo.countAll(db, startOfDay(now)),
    newLast7d: usersRepo.countAll(db, now - 7 * DAY_MS),
    activeSessions: sessionsRepo.countActive(db, now),
    suspendedUsers: byStatus.suspended ?? 0,
    lockedUsers,
    mustChangePassword,
    roleBreakdown: roleBreakdown(),
    registrationTrend: registrationTrend(range, now),
    topFailedIdentifiers: attemptsRepo.topFailedIdentifiers(db, now - 7 * DAY_MS, 5),
    loginsTrend: dailySeries('login_attempts', 'success = 1', range, now),
    sessionsTrend: dailySeries('sessions', null, range, now),
    emailVerifiedRate:
      verifiedRow.total === 0 ? 0 : Number((((verifiedRow.verified ?? 0) / verifiedRow.total) * 100).toFixed(1)),
    pendingDeletions: deletionRepo.countLive(db),
    clientBreakdown: clientBreakdown(now),
    rangeDays: range,
    releaseDownloads: releasesRepo.sumDownloads(db),
    releaseStatus: releasesRepo.countByStatus(db),
    releaseBreakdown: releasesRepo.topDownloads(db, 5),
    generatedAt: new Date(now).toISOString(),
  }
}
