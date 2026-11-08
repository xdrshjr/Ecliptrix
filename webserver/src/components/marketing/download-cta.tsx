import Link from 'next/link'
import { Monitor, Apple, Terminal } from 'lucide-react'
import type { Translator } from '@/lib/i18n'

/**
 * Download CTA.
 *
 * The platform hint is CSS-only in the static case: rendering Windows/macOS
 * buttons unconditionally avoids shipping a client-side UA sniff that would
 * hydrate the whole section just to hide one button.
 */
export function DownloadCta({ tt }: { tt: Translator }) {
  return (
    <section id="download" className="mx-auto max-w-6xl px-5 py-20">
      <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-10 sm:px-10">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">{tt('hero.ctaPrimary')}</h2>
        <p className="mt-2 max-w-prose text-sm text-[var(--muted)]">{tt('hero.note')}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/register"
            className="inline-flex h-10 items-center gap-2 rounded-sm bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
          >
            <Monitor size={15} />
            Windows
          </Link>
          <Link
            href="/register"
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-[var(--border-strong)] px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
          >
            <Apple size={15} />
            macOS
          </Link>
          <Link
            href="/legal/terms"
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-[var(--border)] px-5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <Terminal size={14} />
            {tt('nav.docs')}
          </Link>
        </div>
      </div>
    </section>
  )
}
