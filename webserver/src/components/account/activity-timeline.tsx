import { translator, type Locale } from '@/lib/i18n'
import { RelativeTime } from '@/components/shell/relative-time'

/**
 * Activity timeline.
 *
 * Renders the whitelisted self-visible actions only — this component is not the
 * audit console, and it must not become one by accident: a member seeing every
 * admin action about their account is a privacy decision, not a UI one.
 */
const ACTION_LABELS: Record<string, string> = {
  'auth.login': '登录',
  'auth.login_failed': '登录失败',
  'auth.logout': '退出登录',
  'auth.password_changed': '修改口令',
  'auth.session_revoked': '撤销设备',
  'user.register': '注册账号',
  'user.profile_updated': '更新资料',
  'authz.denied': '访问被拒绝',
}

export function ActivityTimeline({
  locale,
  events,
}: {
  locale: Locale
  events: { id: string; action: string; ip: string; createdAt: string }[]
}) {
  const tt = translator(locale)
  if (events.length === 0) {
    return (
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--muted)]">
        {tt('account.activity.empty')}
      </div>
    )
  }

  return (
    <ol className="relative flex flex-col gap-0 border-l border-[var(--border)] pl-5">
      {events.map((event) => (
        <li key={event.id} className="relative pb-5">
          <span
            aria-hidden
            className="absolute -left-[25px] top-1.5 flex h-2 w-2 items-center justify-center rounded-full bg-[var(--accent)]"
          />
          <p className="text-sm">{ACTION_LABELS[event.action] ?? event.action}</p>
          <p className="mono mt-0.5 text-xs text-[var(--muted)]">
            <RelativeTime iso={event.createdAt} locale={locale} />
            {event.ip ? <span> · {event.ip}</span> : null}
          </p>
        </li>
      ))}
    </ol>
  )
}
