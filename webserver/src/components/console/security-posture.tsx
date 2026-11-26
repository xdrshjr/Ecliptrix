import Link from 'next/link'
import { translator, type Locale } from '@/lib/i18n'
import { formatNumber } from '@/lib/format'
import type { SecurityPosture } from '@/server/services/securityPostureService'

/**
 * Security posture cards.
 *
 * Server component on purpose: the data is read once per request and nothing here
 * is interactive, so shipping a client bundle for four static cards would be cost
 * without benefit.
 *
 * Visual rule (spec §7): red is reserved for the ONE condition that is an active
 * risk — the root administrator still using the bootstrap credential. Everything
 * else uses `--muted`. Warning inflation is how a panel gets ignored, and this one
 * only exists to be read during an incident.
 */
export function SecurityPosturePanel({
  locale,
  posture,
  windowHours,
}: {
  locale: Locale
  posture: SecurityPosture
  windowHours: number
}) {
  const tt = translator(locale)
  const root = posture.rootAdmin

  return (
    <div className="flex flex-col gap-4">
      {/* Root administrator ------------------------------------------------- */}
      <section
        className={`rounded-md border bg-[var(--surface)] px-5 py-4 ${
          root?.bootstrapPassword ? 'border-[var(--danger)]/50' : 'border-[var(--border)]'
        }`}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium">{tt('admin.security.rootAdmin')}</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{tt('admin.security.rootAdminHint')}</p>
          </div>
          {root?.bootstrapPassword ? (
            <span className="shrink-0 rounded-sm border border-[var(--danger)]/50 bg-[var(--danger)]/5 px-2 py-0.5 text-2xs uppercase tracking-wider text-[var(--danger)]">
              {tt('admin.security.bootstrapPassword')}
            </span>
          ) : (
            <span className="shrink-0 rounded-sm border border-[var(--border)] px-2 py-0.5 text-2xs uppercase tracking-wider text-[var(--muted)]">
              {tt('admin.security.rotated')}
            </span>
          )}
        </header>

        {root ? (
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">{tt('admin.security.username')}</dt>
              <dd className="mono">{root.username}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">{tt('common.email')}</dt>
              <dd className="mono">{root.email}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">{tt('admin.security.passwordUpdatedAt')}</dt>
              <dd className="mono">{new Date(root.passwordUpdatedAt).toLocaleString(locale)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">{tt('admin.security.lastLoginAt')}</dt>
              <dd className="mono">
                {root.lastLoginAt
                  ? new Date(root.lastLoginAt).toLocaleString(locale)
                  : tt('admin.security.never')}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="mt-3 text-xs text-[var(--muted)]">{tt('admin.security.noOwner')}</p>
        )}

        {root?.bootstrapPassword ? (
          <p className="mt-3 text-xs text-[var(--danger)]">
            {tt('admin.security.bootstrapWarning')}
          </p>
        ) : null}
      </section>

      {/* Challenge effectiveness --------------------------------------------- */}
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <h2 className="text-sm font-medium">{tt('admin.security.captcha')}</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">
          {tt('admin.security.windowHint', { hours: String(windowHours) })}
        </p>
        <ul className="mt-3 grid gap-px overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--border)] sm:grid-cols-4">
          {[
            { label: tt('admin.security.issued'), value: posture.captcha.issued24h },
            { label: tt('admin.security.solved'), value: posture.captcha.solved24h },
            { label: tt('admin.security.failed'), value: posture.captcha.failed24h },
            {
              label: tt('admin.security.solveRate'),
              value:
                posture.captcha.solveRate === null
                  ? '—'
                  : `${Math.round(posture.captcha.solveRate * 100)}%`,
            },
            {
              // Answers "why did I get a puzzle?" with the number the gate is
              // actually using; 0 reads as its own sentence rather than "after 0
              // failures", which would be nonsense.
              label: tt('admin.security.loginThreshold'),
              value:
                posture.captcha.loginThreshold === 0
                  ? tt('admin.security.loginThresholdNever')
                  : formatNumber(posture.captcha.loginThreshold, locale),
            },
          ].map((cell) => (
            <li key={cell.label} className="bg-[var(--surface)] px-3 py-3">
              <p className="text-xs text-[var(--muted)]">{cell.label}</p>
              <p className="mono mt-1 text-lg font-semibold tracking-[-0.02em]">
                {typeof cell.value === 'number' ? formatNumber(cell.value, locale) : cell.value}
              </p>
            </li>
          ))}
        </ul>
        {posture.untrustedIpRatio >= 0.5 && posture.captcha.issued24h > 0 ? (
          <p className="mt-3 text-xs text-[var(--warning)]">
            {tt('admin.security.untrustedIp', {
              percent: String(Math.round(posture.untrustedIpRatio * 100)),
            })}
          </p>
        ) : null}
      </section>

      {/* Escalation attempts -------------------------------------------------- */}
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <h2 className="text-sm font-medium">{tt('admin.security.authority')}</h2>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{tt('admin.security.denialsHint')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-sm border border-[var(--border)] px-2.5 py-1.5">
            {tt('admin.security.denied')}{' '}
            <span className="mono text-[var(--foreground)]">
              {formatNumber(posture.denials.denied, locale)}
            </span>
          </span>
          <span className="rounded-sm border border-[var(--border)] px-2.5 py-1.5">
            {tt('admin.security.escalationDenied')}{' '}
            <span className="mono text-[var(--foreground)]">
              {formatNumber(posture.denials.escalationDenied, locale)}
            </span>
          </span>
        </div>
        {posture.denials.topPermissions.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1.5">
            {posture.denials.topPermissions.map((entry) => (
              <li
                key={entry.permission}
                className="flex items-center justify-between gap-3 text-xs"
              >
                <span className="mono truncate text-[var(--muted)]">{entry.permission}</span>
                <span className="mono">{entry.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-[var(--muted)]">{tt('common.none')}</p>
        )}
      </section>

      {/* Who holds authority -------------------------------------------------- */}
      <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
        <footer className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">{tt('admin.security.distribution')}</h2>
          <Link
            href="/admin/users"
            className="text-xs text-[var(--info)] hover:underline"
          >
            {tt('admin.security.manageUsers')} →
          </Link>
        </footer>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['owner', posture.authorities.owner],
              ['admin', posture.authorities.admin],
              ['support', posture.authorities.support],
              ['member', posture.authorities.member],
              ['custom', posture.authorities.custom],
            ] as const
          ).map(([key, count]) => (
            <li
              key={key}
              className="flex items-center gap-2 rounded-sm border border-[var(--border)] px-2.5 py-1.5 text-xs"
            >
              <span className="text-[var(--muted)]">{tt(`permissions.role.${key}`)}</span>
              <span className="mono">{formatNumber(count, locale)}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-4 text-xs font-medium text-[var(--muted)]">
          {tt('admin.security.recentRoleChanges')}
        </h3>
        {posture.recentRoleChanges.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">{tt('common.none')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {posture.recentRoleChanges.map((entry, index) => (
              <li
                key={`${entry.at}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs"
              >
                <span className="mono text-[var(--muted)]">
                  {entry.actorLabel} → {entry.targetLabel}
                </span>
                <span className="mono text-[var(--muted)]">
                  {new Date(entry.at).toLocaleString(locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
