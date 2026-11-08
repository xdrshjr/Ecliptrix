import Link from 'next/link'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { EmailVerifyPanel } from '@/components/auth/email-verify-panel'

/**
 * `/verify-email?token=…` — server shell around the consuming panel.
 *
 * The RSC passes a string only (never a translation function): a function prop
 * throws at render time inside a client component and 500s the page.
 *
 * `no-referrer` matters here: the token is in the URL, and a leaked `Referer` on
 * any outbound navigation would hand it to a third party. The global middleware
 * sets it; this page keeps the same header explicitly because this is the one route
 * where it is load-bearing.
 */
export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const params = await searchParams
  const locale = await resolveLocale()
  const tt = translator(locale)
  const token = params.token?.trim() ?? ''

  return (
    <div className="w-full max-w-sm">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('verify.title')}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{tt('verify.subtitle')}</p>
      </header>

      {token ? (
        <EmailVerifyPanel locale={locale} token={token} />
      ) : (
        <p className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-3 text-sm text-[var(--danger)]">
          {tt('verify.invalid')}
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
