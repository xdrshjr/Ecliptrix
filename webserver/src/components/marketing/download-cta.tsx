import Link from 'next/link'
import { Monitor } from 'lucide-react'
import type { Translator } from '@/lib/i18n'
import { platformLabel } from '@/lib/releases'

/**
 * Download CTA.
 *
 * The block renders **only the platforms that have a published installer**. It
 * used to show a Windows and a macOS button unconditionally, both pointing at
 * `/register`: the desktop app produces only a Windows x64 NSIS installer, so the
 * macOS button promised an artifact that does not exist (analysis D4). Rendering
 * from real data removes the false promise instead of replacing it with a second
 * hard-coded list.
 */
export function DownloadCta({
  tt,
  platforms,
  version,
}: {
  tt: Translator
  platforms: readonly string[]
  version: string | null
}) {
  return (
    <section id="download" className="mx-auto max-w-6xl px-5 py-20">
      <div className="rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-6 py-10 sm:px-10">
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">{tt('hero.ctaPrimary')}</h2>
        <p className="mt-2 max-w-prose text-sm text-[var(--muted)]">{tt('hero.note')}</p>
        {version ? (
          <p className="mono mt-1 text-xs text-[var(--muted)]">
            {tt('download.version')} {version}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {platforms.length === 0 ? (
            <Link
              href="/download"
              className="inline-flex h-10 items-center gap-2 rounded-sm border border-[var(--border-strong)] px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
            >
              {tt('download.title')}
            </Link>
          ) : (
            platforms.map((platform) => (
              <Link
                key={platform}
                href="/download"
                className="inline-flex h-10 items-center gap-2 rounded-sm bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
              >
                <Monitor size={15} />
                {platformLabel(platform)}
              </Link>
            ))
          )}
          <Link
            href="/login"
            className="inline-flex h-10 items-center gap-2 rounded-sm border border-[var(--border)] px-5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)]"
          >
            {tt('nav.console')}
          </Link>
        </div>
      </div>
    </section>
  )
}
