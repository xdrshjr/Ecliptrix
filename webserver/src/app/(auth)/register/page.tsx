import Link from 'next/link'
import { redirect } from 'next/navigation'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { currentSession } from '@/lib/session'
import { RegisterForm } from '@/components/auth/register-form'
import * as settingsService from '@/server/services/settingsService'

/** Sign-up page. The invite field only exists when the server requires it. */
export const dynamic = 'force-dynamic'

export default async function RegisterPage() {
  const session = await currentSession()
  if (session) redirect('/account')

  const locale = await resolveLocale()
  const tt = translator(locale)
  const meta = settingsService.publicMeta()

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('auth.register.title')}</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">{tt('auth.register.subtitle')}</p>
      </header>

      {meta.registrationEnabled ? (
        <RegisterForm locale={locale} inviteRequired={meta.inviteRequired} />
      ) : (
        <div className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-5 text-sm text-[var(--muted)]">
          {tt('auth.register.disabled')}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2 text-sm">
        <p className="text-[var(--muted)]">
          {tt('auth.register.haveAccount')}{' '}
          <Link href="/login" className="text-[var(--info)] hover:underline">
            {tt('auth.register.signIn')}
          </Link>
        </p>
        <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
          ← {tt('common.back')}
        </Link>
      </div>
    </div>
  )
}
