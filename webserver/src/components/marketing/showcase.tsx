import type { Translator } from '@/lib/i18n'
import { cn } from '@/lib/cn'

/**
 * Three alternating text/visual blocks.
 *
 * "Visual" is drawn in CSS rather than shipped as a screenshot: a marketing page
 * whose images 404 on a fresh clone is worse than an honest schematic, and the
 * schematic can follow the theme.
 */
export function Showcase({ tt }: { tt: Translator }) {
  const blocks = [
    { id: 'timeline', title: tt('showcase.timeline.title'), desc: tt('showcase.timeline.desc'), reverse: false, variant: 'timeline' as const },
    { id: 'voice', title: tt('showcase.voice.title'), desc: tt('showcase.voice.desc'), reverse: true, variant: 'voice' as const },
    { id: 'admin', title: tt('showcase.admin.title'), desc: tt('showcase.admin.desc'), reverse: false, variant: 'admin' as const },
  ]

  return (
    <section id="showcase" className="border-y border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-16 px-5 py-20">
        {blocks.map((block) => (
          <article
            key={block.id}
            className={cn(
              'grid items-center gap-8 md:grid-cols-2',
              block.reverse && 'md:[&>*:first-child]:order-2',
            )}
          >
            <div>
              <h3 className="text-xl font-semibold tracking-[-0.01em] sm:text-2xl">{block.title}</h3>
              <p className="mt-3 max-w-prose text-sm leading-6 text-[var(--muted)]">{block.desc}</p>
            </div>
            <Schematic variant={block.variant} />
          </article>
        ))}
      </div>
    </section>
  )
}

function Schematic({ variant }: { variant: 'timeline' | 'voice' | 'admin' }) {
  return (
    <div
      aria-hidden
      className="overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--background)]"
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
        <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
        <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
        <span className="mono ml-2 text-2xs text-[var(--muted)]">ecliptrix</span>
      </div>

      {variant === 'timeline' ? (
        <div className="space-y-1.5 p-3">
          {[
            ['60%', '25%'],
            ['35%', '45%'],
            ['80%', '15%'],
            ['45%', '50%'],
          ].map(([width, offset], index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="w-10 shrink-0 text-2xs text-[var(--muted)]">
                {['V1', 'A1', 'S1', 'M1'][index]}
              </span>
              <div className="relative h-4 flex-1 rounded-sm bg-[var(--surface-2)]">
                <div
                  className={cn(
                    'absolute inset-y-0 rounded-sm',
                    index === 0 ? 'bg-[var(--accent)]/70' : 'bg-[var(--info)]/40',
                  )}
                  style={{ width, left: offset }}
                />
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between text-2xs text-[var(--muted)]">
            <span className="mono">00:00:00:12</span>
            <span className="mono">00:04:38:00</span>
          </div>
        </div>
      ) : null}

      {variant === 'voice' ? (
        <div className="space-y-2 p-3">
          {[92, 74, 58, 84].map((width, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="mono w-8 shrink-0 text-2xs text-[var(--muted)]">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="flex h-5 flex-1 items-center gap-[2px]">
                {Array.from({ length: 28 }).map((_, bar) => (
                  <span
                    key={bar}
                    className="w-[3px] rounded-full bg-[var(--accent)]/60"
                    style={{ height: `${20 + ((bar * 37 + index * 13) % 80)}%` }}
                  />
                ))}
              </div>
              <span className="mono w-9 shrink-0 text-right text-2xs text-[var(--muted)]">
                {width}%
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {variant === 'admin' ? (
        <div className="p-3">
          <table className="w-full text-2xs">
            <tbody>
              {[
                { role: 'owner', done: 4, tone: 'accent' as const },
                { role: 'admin', done: 3, tone: 'accent' as const },
                { role: 'support', done: 1, tone: 'warning' as const },
                { role: 'member', done: 0, tone: 'neutral' as const },
              ].map((row) => (
                <tr key={row.role} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-1.5 pr-2 text-[var(--muted)]">{row.role}</td>
                  <td className="py-1.5">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((slot) => (
                        <span
                          key={slot}
                          className={cn(
                            'h-3 w-6 rounded-sm',
                            slot < row.done
                              ? row.tone === 'neutral'
                                ? 'bg-[var(--border-strong)]'
                                : row.tone === 'warning'
                                  ? 'bg-[var(--warning)]/60'
                                  : 'bg-[var(--accent)]/60'
                              : 'bg-[var(--surface-2)]',
                          )}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="py-1.5 text-right text-[var(--muted)]">{row.done} / 4</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
