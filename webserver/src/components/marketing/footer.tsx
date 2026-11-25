import Link from 'next/link'
import type { Translator } from '@/lib/i18n'
import { Logo } from '@/components/shell/logo'

/** Landing footer: three link columns, a status dot and the copyright line. */
export function Footer({ tt }: { tt: Translator }) {
  const columns = [
    {
      title: tt('footer.product'),
      links: [
        { label: tt('nav.features'), href: '#features' },
        { label: tt('nav.pricing'), href: '#pricing' },
        { label: tt('nav.download'), href: '/download' },
      ],
    },
    {
      title: tt('footer.resources'),
      links: [
        { label: tt('nav.docs'), href: '#faq' },
        { label: tt('nav.console'), href: '/login' },
      ],
    },
    {
      title: tt('footer.legal'),
      links: [
        { label: tt('footer.privacy'), href: '/legal/privacy' },
        { label: tt('footer.terms'), href: '/legal/terms' },
      ],
    },
  ]

  return (
    <footer className="border-t border-[var(--border)]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-[22ch] text-xs leading-5 text-[var(--muted)]">
            {tt('brand.tagline')}
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden />
            {tt('footer.status')}
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              {column.title}
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-[var(--border)] px-5 py-5">
        <p className="mx-auto max-w-6xl text-xs text-[var(--muted)]">
          © {new Date().getFullYear()} Ecliptrix. {tt('footer.rights')}
        </p>
      </div>
    </footer>
  )
}
