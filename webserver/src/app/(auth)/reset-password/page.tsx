import Link from 'next/link'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

/** Reset confirmation page — the token arrives in the query string. */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)
  const token = params.token?.trim() ?? ''

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('auth.reset.title')}</h1>
      </header>

      {token ? (
        <ResetPasswordForm locale={locale} token={token} />
      ) : (
        <p className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-3 text-sm text-[var(--danger)]">
          {tt('auth.reset.invalid')}
        </p>
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
