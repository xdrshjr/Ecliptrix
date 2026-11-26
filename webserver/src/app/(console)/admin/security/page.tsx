import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { can } from '@/server/auth/guards'
import { posture } from '@/server/services/securityPostureService'
import { SecurityPosturePanel } from '@/components/console/security-posture'

/**
 * Security posture page.
 *
 * Guarded twice like every console page: the layout already refused a
 * session-less visitor, and this page re-checks `security.read` because a layout
 * is not a security boundary in Next.js. Redirecting (rather than rendering a
 * notice in place) is safe here because `/admin/forbidden` is the destination and
 * it does not itself ask for this permission.
 *
 * `?window=` widens the look-back; the API bounds it, and the default is 24 h.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>
}

export default async function AdminSecurityPage({ searchParams }: PageProps) {
  const session = await currentSession()
  if (!session) redirect('/login')
  if (!can(session, 'security.read')) redirect('/admin/forbidden')

  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)

  const raw = Number(params.window)
  const windowHours =
    Number.isFinite(raw) && raw >= 1 && raw <= 24 * 30 ? Math.round(raw) : 24

  const result = posture(windowHours)

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.security.title')}</h1>
        <p className="mt-1 text-xs text-[var(--muted)]">{tt('admin.security.subtitle')}</p>
      </header>
      <SecurityPosturePanel locale={locale} posture={result} windowHours={windowHours} />
    </div>
  )
}
