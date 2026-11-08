import Link from 'next/link'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import * as settingsService from '@/server/services/settingsService'

/** Password reset request page. */
export const dynamic = 'force-dynamic'

export default async function ForgotPasswordPage() {
  const locale = await resolveLocale()
  const tt = translator(locale)
  const meta = settingsService.publicMeta()

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('auth.forgot.title')}</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">{tt('auth.forgot.subtitle')}</p>
      </header>

      {meta.smtpEnabled ? (
        <ForgotPasswordForm locale={locale} />
      ) : (
        <div className="rounded-sm border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-5 text-sm leading-6 text-[var(--muted)]">
          {tt('auth.forgot.noMail')}
        </div>
      )}

      <Link
        href="/login"
        className="mt-6 inline-block text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        ← {tt('auth.login.submit')}
      </Link>
    </div>
  )
}
