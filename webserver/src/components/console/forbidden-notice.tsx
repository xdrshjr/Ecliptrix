import Link from 'next/link'
import { translator, type Locale } from '@/lib/i18n'

/**
 * 403 body.
 *
 * Shared by `/admin/forbidden` and by the `/admin` layout, because the layout
 * must not redirect a member to `/admin/forbidden` — that route lives under the
 * same layout, so the redirect would loop forever. Rendering the notice in place
 * answers the request instead of bouncing it.
 */
export function ForbiddenNotice({ locale }: { locale: Locale }) {
  const tt = translator(locale)

  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="mono text-4xl font-semibold text-[var(--border-strong)]">403</p>
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.01em]">{tt('admin.forbidden.title')}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{tt('admin.forbidden.desc')}</p>
      <Link
        href="/account"
        className="mt-6 inline-flex h-9 items-center rounded-sm border border-[var(--border-strong)] px-4 text-sm transition-colors hover:bg-[var(--surface-2)]"
      >
        {tt('account.title')}
      </Link>
    </div>
  )
}
