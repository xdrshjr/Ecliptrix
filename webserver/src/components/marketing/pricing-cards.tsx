import Link from 'next/link'
import { Check } from 'lucide-react'
import type { Translator } from '@/lib/i18n'
import { cn } from '@/lib/cn'

/** Three pricing cards. Presentation only — there is no billing in this release. */
export function PricingCards({ tt }: { tt: Translator }) {
  const tiers = [
    {
      name: tt('pricing.free.name'),
      desc: tt('pricing.free.desc'),
      price: '¥0',
      features: ['本地渲染', '基础音色库', '单项目工作区'],
      highlighted: false,
    },
    {
      name: tt('pricing.pro.name'),
      desc: tt('pricing.pro.desc'),
      price: '¥89',
      features: ['无限时长', '全部音色', 'AI 生成额度', '封面工作室'],
      highlighted: true,
    },
    {
      name: tt('pricing.studio.name'),
      desc: tt('pricing.studio.desc'),
      price: '定制',
      features: ['统一身份与权限', '邀请码管理', '审计日志', '优先支持'],
      highlighted: false,
    },
  ]

  return (
    <section id="pricing" className="border-y border-[var(--border)] bg-[var(--surface)]">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <header className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">{tt('pricing.title')}</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">{tt('pricing.subtitle')}</p>
        </header>

        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {tiers.map((tier) => (
            <li
              key={tier.name}
              className={cn(
                'flex flex-col rounded-lg border p-6',
                tier.highlighted
                  ? 'border-[var(--accent)]/50 bg-[var(--background)] shadow-[0_8px_30px_rgba(0,0,0,0.25)]'
                  : 'border-[var(--border)] bg-[var(--background)]',
              )}
            >
              <p className="text-sm font-medium">{tier.name}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">{tier.desc}</p>
              <p className="mono mt-5 text-3xl font-semibold tracking-[-0.02em]">{tier.price}</p>
              <ul className="mt-5 flex flex-1 flex-col gap-2">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <Check size={13} className="text-[var(--accent)]" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/register"
                className={cn(
                  'mt-6 inline-flex h-9 items-center justify-center rounded-sm text-sm font-medium transition-[filter]',
                  tier.highlighted
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
                    : 'border border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
                )}
              >
                {tt('pricing.cta')}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
