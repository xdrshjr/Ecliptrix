import Link from 'next/link'
import { resolveLocale } from '@/lib/locale'
import { translator } from '@/lib/i18n'
import { Logo } from '@/components/shell/logo'

/**
 * Auth shell: a card centred on the page with a brand panel on large screens.
 *
 * No image and no gradient blob — the reference aesthetic here is a quiet, almost
 * empty canvas, so the form is the only thing with contrast.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const locale = await resolveLocale()
  const tt = translator(locale)

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_46%]">
      <main id="main" className="flex flex-col justify-center px-5 py-12 sm:px-10">
        <div className="mb-10 flex items-center justify-between">
          <Link href="/" className="text-[var(--foreground)]" aria-label="返回首页">
            <Logo />
          </Link>
          <Link href="/" className="text-xs text-[var(--muted)] transition-colors hover:text-[var(--foreground)]">
            {tt('common.back')}
          </Link>
        </div>
        <div className="mx-auto w-full max-w-sm lg:mx-0">{children}</div>
      </main>

      <aside className="relative hidden overflow-hidden border-l border-[var(--border)] bg-[var(--surface)] lg:block">
        <div className="absolute inset-0 bg-grid opacity-70" aria-hidden />
        <div className="absolute inset-0 bg-radial-glow" aria-hidden />
        <div className="relative flex h-full flex-col justify-end p-10">
          <p className="mono text-2xs uppercase tracking-[0.2em] text-[var(--muted)]">
            {tt('brand.tagline')}
          </p>
          <p className="mt-3 max-w-sm text-lg leading-8 text-[var(--foreground)]">
            {tt('hero.subtitle')}
          </p>
          <ul className="mt-8 flex flex-col gap-2 text-xs text-[var(--muted)]">
            <li>· {tt('features.timeline.title')}</li>
            <li>· {tt('features.account.title')}</li>
            <li>· {tt('footer.status')}</li>
          </ul>
        </div>
      </aside>
    </div>
  )
}
