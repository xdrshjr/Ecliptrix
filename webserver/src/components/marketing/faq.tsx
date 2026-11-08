import type { Translator } from '@/lib/i18n'

/**
 * FAQ.
 *
 * Native `<details>`: keyboard accessible, works before hydration, and cannot be
 * broken by a state bug. The only styling needed is the marker and spacing.
 */
export function Faq({ tt }: { tt: Translator }) {
  const items = [
    { q: tt('faq.q1'), a: tt('faq.a1') },
    { q: tt('faq.q2'), a: tt('faq.a2') },
    { q: tt('faq.q3'), a: tt('faq.a3') },
    { q: tt('faq.q4'), a: tt('faq.a4') },
    { q: tt('faq.q5'), a: tt('faq.a5') },
    { q: tt('faq.q6'), a: tt('faq.a6') },
  ]

  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
      <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{tt('faq.title')}</h2>
      <div className="mt-8 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {items.map((item) => (
          <details key={item.q} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium marker:hidden">
              {item.q}
              <span
                aria-hidden
                className="text-[var(--muted)] transition-transform duration-150 group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-2 max-w-prose text-sm leading-6 text-[var(--muted)]">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
