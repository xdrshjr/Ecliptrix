import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { overview } from '@/server/services/metricsService'
import { formatNumber, shortDate } from '@/lib/format'

/**
 * Console overview.
 *
 * Guarded twice: the layout already refused a session-less visitor, and this page
 * re-checks the permission because a layout is not a security boundary in Next.js
 * (nested layouts can be bypassed by a parallel route boundary).
 */
export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'users.read')) redirect('/admin/forbidden')

  const locale = await resolveLocale()
  const tt = translator(locale)
  const metrics = overview()
  const peak = Math.max(1, ...metrics.registrationTrend.map((point) => point.count))

  const cards = [
    { label: tt('admin.overview.totalUsers'), value: metrics.totalUsers, href: '/admin/users' },
    { label: tt('admin.overview.active7d'), value: metrics.activeUsers7d },
    { label: tt('admin.overview.newToday'), value: metrics.newToday },
    { label: tt('admin.overview.activeSessions'), value: metrics.activeSessions },
    { label: tt('admin.overview.suspended'), value: metrics.suspendedUsers },
    { label: tt('admin.overview.locked'), value: metrics.lockedUsers },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.overview.title')}</h1>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {new Date(metrics.generatedAt).toLocaleString(locale)}
          </p>
        </div>
        {can(session, 'users.write') ? (
          <Link
            href="/admin/users"
            className="rounded-sm border border-[var(--border-strong)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
          >
            {tt('admin.users.title')} →
          </Link>
        ) : null}
      </header>

      <ul className="grid gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <li key={card.label} className="bg-[var(--surface)] px-4 py-4">
            <p className="text-xs text-[var(--muted)]">{card.label}</p>
            <p className="mono mt-1.5 text-2xl font-semibold tracking-[-0.02em]">
              {formatNumber(card.value, locale)}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-medium">{tt('admin.overview.trend')}</h2>
          <div className="mt-4 flex h-32 items-end gap-1" role="img" aria-label={tt('admin.overview.trend')}>
            {metrics.registrationTrend.map((point) => (
              <div key={point.date} className="group flex flex-1 flex-col items-center justify-end gap-1">
                <span
                  className="w-full rounded-sm bg-[var(--accent)]/70 transition-colors group-hover:bg-[var(--accent)]"
                  style={{ height: `${Math.max(2, (point.count / peak) * 100)}%` }}
                  title={`${point.date}: ${point.count}`}
                />
                <span className="mono text-[9px] text-[var(--muted)]">{shortDate(point.date)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-medium">{tt('admin.overview.topFailures')}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {metrics.topFailedIdentifiers.length === 0 ? (
              <li className="text-xs text-[var(--muted)]">{tt('common.none')}</li>
            ) : (
              metrics.topFailedIdentifiers.map((entry) => (
                <li key={entry.identifier} className="flex items-center justify-between gap-3 text-xs">
                  <span className="mono truncate text-[var(--muted)]">{entry.identifier}</span>
                  <span className="mono text-[var(--danger)]">{entry.failures}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
        <h2 className="text-sm font-medium">{tt('admin.roles.title')}</h2>
        <ul className="mt-3 flex flex-wrap gap-3">
          {metrics.roleBreakdown.map((role) => (
            <li
              key={role.roleKey}
              className="flex items-center gap-2 rounded-sm border border-[var(--border)] px-2.5 py-1.5 text-xs"
            >
              <span className="text-[var(--muted)]">{role.roleName}</span>
              <span className="mono">{formatNumber(role.count, locale)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
