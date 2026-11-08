import Link from 'next/link'
import { cn } from '@/lib/cn'

/** Wordmark. One SVG, no image asset, inherits currentColor. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 15.5 12 7l4 8.5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="18" r="1.15" fill="var(--accent)" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">Ecliptrix</span>
    </span>
  )
}

export function LogoLink({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="text-[var(--foreground)] no-underline" aria-label="Ecliptrix 首页">
      <Logo />
    </Link>
  )
}
