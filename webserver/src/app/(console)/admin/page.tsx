import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { overview } from '@/server/services/metricsService'
import { TrendChart } from '@/components/console/trend-chart'
import { formatNumber, shortDate } from '@/lib/format'

/**
 * Console overview.
 *
 * Guarded twice: the layout already refused a session-less visitor, and this page
 * re-checks the permission because a layout is not a security boundary in Next.js
 * (nested layouts can be bypassed by a parallel route boundary).
 *
 * `?days=14|30` drives the three series. The database slice is bounded to 7–90 by
 * the API; here the URL is the input and the service clamps it again.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function AdminOverviewPage({ searchParams }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'users.read')) redirect('/admin/forbidden')

  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)
  const days = params.days === '30' ? 30 : 14
  const metrics = overview(Date.now(), days)

  const cards = [
    { label: tt('admin.overview.totalUsers'), value: metrics.totalUsers, href: '/admin/users' },
    { label: tt('admin.overview.active7d'), value: metrics.activeUsers7d },
    { label: tt('admin.overview.newToday'), value: metrics.newToday },
    { label: tt('admin.overview.activeSessions'), value: metrics.activeSessions },
    { label: tt('admin.overview.suspended'), value: metrics.suspendedUsers },
    { label: tt('admin.overview.locked'), value: metrics.lockedUsers },
    { label: tt('admin.overview.pendingDeletions'), value: metrics.pendingDeletions },
    {
      label: tt('admin.releases.downloads'),
      value: metrics.releaseDownloads,
      href: '/admin/releases',
    },
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
        <div className="flex items-center gap-2">
          <nav className="flex overflow-hidden rounded-sm border border-[var(--border-strong)] text-xs">
            {[14, 30].map((value) => (
              <Link
                key={value}
                href={`/admin?days=${value}`}
                className={`px-2.5 py-1.5 transition-colors ${
                  value === days
                    ? 'bg-[var(--surface-2)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                }`}
              >
                {value === 14 ? tt('admin.overview.range14') : tt('admin.overview.range30')}
              </Link>
            ))}
          </nav>
          {can(session, 'users.write') ? (
            <Link
              href="/admin/users"
              className="rounded-sm border border-[var(--border-strong)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
            >
              {tt('admin.users.title')} →
            </Link>
          ) : null}
        </div>
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
        <li className="bg-[var(--surface)] px-4 py-4">
          <p className="text-xs text-[var(--muted)]">{tt('admin.overview.verifiedRate')}</p>
          <p className="mono mt-1.5 text-2xl font-semibold tracking-[-0.02em]">
            {metrics.emailVerifiedRate}%
          </p>
        </li>
      </ul>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <TrendChart
          locale={locale}
          title={tt('admin.overview.trend')}
          points={metrics.registrationTrend}
        />
        <TrendChart
          locale={locale}
          title={tt('admin.overview.loginsTrend')}
          points={metrics.loginsTrend}
          tone="info"
        />
        <TrendChart
          locale={locale}
          title={tt('admin.overview.sessionsTrend')}
          points={metrics.sessionsTrend}
          tone="info"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
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

        <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-sm font-medium">{tt('admin.overview.clientMix')}</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {metrics.clientBreakdown.length === 0 ? (
              <li className="text-xs text-[var(--muted)]">{tt('common.none')}</li>
            ) : (
              metrics.clientBreakdown.map((entry) => (
                <li
                  key={`${entry.platform}-${entry.appVersion}`}
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="truncate text-[var(--muted)]">
                    {entry.platform || '—'} · <span className="mono">{entry.appVersion || '—'}</span>
                  </span>
                  <span className="mono">{entry.sessions}</span>
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
        <p className="mt-3 text-2xs text-[var(--muted)]">
          {metrics.registrationTrend[0] ? shortDate(metrics.registrationTrend[0].date) : ''} →{' '}
          {metrics.registrationTrend.at(-1) ? shortDate(metrics.registrationTrend.at(-1)!.date) : ''}
        </p>
      </section>
    </div>
  )
}
