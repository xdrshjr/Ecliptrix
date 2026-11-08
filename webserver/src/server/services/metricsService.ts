import { getDb } from '@/server/db/client'
import * as usersRepo from '@/server/db/repositories/usersRepo'
import * as sessionsRepo from '@/server/db/repositories/sessionsRepo'
import * as attemptsRepo from '@/server/db/repositories/loginAttemptsRepo'
import * as rolesRepo from '@/server/db/repositories/rolesRepo'

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

function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
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
    const dayStart = startOfDay(from + index * DAY_MS)
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

export function overview(now = Date.now()): OverviewMetrics {
  const db = getDb()
  const byStatus = usersRepo.countByStatus(db)

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
    registrationTrend: registrationTrend(14, now),
    topFailedIdentifiers: attemptsRepo.topFailedIdentifiers(db, now - 7 * DAY_MS, 5),
    generatedAt: new Date(now).toISOString(),
  }
}
