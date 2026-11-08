import Link from 'next/link'
import type { Translator } from '@/lib/i18n'

/**
 * Hero.
 *
 * The product "screenshot" is a CSS reconstruction of the editor shell: it scales
 * cleanly, follows the theme, and never depends on a binary asset that a fresh
 * clone might not have.
 */
export function Hero({ tt }: { tt: Translator }) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--border)]">
      <div className="absolute inset-0 bg-grid opacity-60" aria-hidden />
      <div className="absolute inset-0 bg-radial-glow" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-16 sm:pt-24">
        <p className="mono inline-flex items-center gap-2 rounded-full border border-[var(--border-strong)] px-3 py-1 text-2xs uppercase tracking-wider text-[var(--muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
          {tt('hero.eyebrow')}
        </p>

        <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-[-0.02em] sm:text-[56px]">
          {tt('hero.title')}
        </h1>

        <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--muted)]">{tt('hero.subtitle')}</p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/register"
            className="inline-flex h-10 items-center rounded-sm bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
          >
            {tt('hero.ctaPrimary')}
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-sm border border-[var(--border-strong)] px-5 text-sm font-medium transition-colors hover:bg-[var(--surface-2)]"
          >
            {tt('hero.ctaSecondary')}
          </Link>
          <span className="text-xs text-[var(--muted)]">{tt('hero.note')}</span>
        </div>

        <EditorMock />
      </div>
    </section>
  )
}

function EditorMock() {
  return (
    <div
      aria-hidden
      className="mt-14 overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_24px_60px_rgba(0,0,0,0.45)]"
      style={{ transform: 'perspective(1400px) rotateX(1.5deg)' }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
        <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
        <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
        <span className="mono ml-3 text-2xs text-[var(--muted)]">Ecliptrix — 项目 / 品牌短片 v3</span>
        <span className="mono ml-auto rounded-sm border border-[var(--accent)]/40 px-2 py-0.5 text-2xs text-[var(--accent)]">
          export ready
        </span>
      </div>

      <div className="grid grid-cols-1 gap-px bg-[var(--border)] md:grid-cols-[220px_1fr]">
        <div className="hidden flex-col gap-2 bg-[var(--background)] p-3 md:flex">
          {[78, 62, 88, 46, 70].map((width, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]/70" />
              <span
                className="h-1.5 rounded-full bg-[var(--border-strong)]"
                style={{ width: `${width}%` }}
              />
            </div>
          ))}
        </div>

        <div className="bg-[var(--background)] p-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface-2)]">
            <div className="absolute inset-0 bg-radial-glow" />
            <div className="absolute bottom-2 left-1/2 h-1 w-1/3 -translate-x-1/2 rounded-full bg-[var(--accent)]/50" />
          </div>

          <div className="mt-3 space-y-1.5">
            {[
              { label: 'V1', width: '62%', left: '4%', tone: 'accent' },
              { label: 'A1', width: '40%', left: '30%', tone: 'info' },
              { label: 'S1', width: '76%', left: '10%', tone: 'info' },
              { label: 'M1', width: '28%', left: '56%', tone: 'warning' },
            ].map((track) => (
              <div key={track.label} className="flex items-center gap-2">
                <span className="mono w-6 text-2xs text-[var(--muted)]">{track.label}</span>
                <div className="relative h-3.5 flex-1 rounded-sm bg-[var(--surface-2)]">
                  <div
                    className="absolute inset-y-0 rounded-sm"
                    style={{
                      width: track.width,
                      left: track.left,
                      background:
                        track.tone === 'accent'
                          ? 'color-mix(in srgb, var(--accent) 65%, transparent)'
                          : track.tone === 'warning'
                            ? 'color-mix(in srgb, var(--warning) 45%, transparent)'
                            : 'color-mix(in srgb, var(--info) 40%, transparent)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
