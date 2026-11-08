import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { LoginForm } from '@/components/auth/login-form'
import * as settingsService from '@/server/services/settingsService'

/**
 * Sign-in page.
 *
 * Already-authenticated visitors are redirected by role: an administrator lands
 * in the console, a member in the account centre. Members may still open the
 * landing page — the redirect only applies to the auth pages, so "look at the
 * marketing site" never requires signing out.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ next?: string; reason?: string }>
}

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams
  const session = await currentSession()
  if (session) {
    redirect(params.next && params.next.startsWith('/') ? params.next : defaultLanding(session))
  }

  const locale = await resolveLocale()
  const tt = translator(locale)
  const meta = settingsService.publicMeta()

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('auth.login.title')}</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">{tt('auth.login.subtitle')}</p>
      </header>

      {params.reason === 'session-expired' ? (
        <p
          role="status"
          className="mb-4 rounded-sm border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--warning)]"
        >
          {tt('auth.login.sessionExpired')}
        </p>
      ) : null}

      <LoginForm locale={locale} next={params.next} />

      <div className="mt-6 flex flex-col gap-2 text-sm">
        {meta.registrationEnabled ? (
          <p className="text-[var(--muted)]">
            {tt('auth.login.noAccount')}{' '}
            <Link href="/register" className="text-[var(--info)] hover:underline">
              {tt('auth.login.register')}
            </Link>
          </p>
        ) : (
          <p className="text-xs text-[var(--muted)]">{tt('auth.register.disabled')}</p>
        )}
        <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
          ← {tt('common.back')}
        </Link>
      </div>
    </div>
  )
}

function defaultLanding(session: { permissions: string[] }): string {
  const canReadUsers = session.permissions.includes('*') || session.permissions.includes('users.read')
  return canReadUsers ? '/admin' : '/account'
}
