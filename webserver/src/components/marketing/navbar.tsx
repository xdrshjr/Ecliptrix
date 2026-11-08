'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { LogoLink } from '@/components/shell/logo'
import { ThemeToggle } from '@/components/shell/theme-toggle'
import { translator, type Locale } from '@/lib/i18n'

/**
 * Landing navbar.
 *
 * Becomes translucent once the page scrolls: at the top it is transparent so the
 * hero gradient reads through, after 24px it gains a border and a blur.
 */
export interface NavbarProps {
  locale: Locale
  signedIn: boolean
  consoleHref: string
}

export function Navbar({ locale, signedIn, consoleHref }: NavbarProps) {
  const tt = translator(locale)
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const links = [
    { href: '#features', label: tt('nav.features') },
    { href: '#showcase', label: tt('nav.product') },
    { href: '#pricing', label: tt('nav.pricing') },
    { href: '#faq', label: tt('nav.docs') },
  ]

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-200',
        scrolled
          ? 'border-b border-[var(--border)] bg-[var(--background)]/85 backdrop-blur-md'
          : 'border-b border-transparent',
      )}
    >
      <nav className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-8">
          <LogoLink />
          <ul className="hidden items-center gap-6 md:flex">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <Link
              href={consoleHref}
              className="rounded-sm bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
            >
              {tt('nav.console')} →
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-sm px-3 py-1.5 text-sm text-[var(--muted)] transition-colors hover:text-[var(--foreground)] sm:inline-flex"
              >
                {tt('nav.signIn')}
              </Link>
              <Link
                href="/register"
                className="rounded-sm bg-[var(--accent)] px-3.5 py-1.5 text-sm font-medium text-[var(--accent-fg)] transition-[filter] hover:brightness-110"
              >
                {tt('nav.signUp')}
              </Link>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? tt('common.close') : tt('nav.product')}
            aria-expanded={open}
            className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--border)] text-[var(--muted)] md:hidden"
          >
            {open ? <X size={15} /> : <Menu size={15} />}
          </button>
        </div>
      </nav>

      {open ? (
        <div className="border-t border-[var(--border)] bg-[var(--background)] px-5 py-3 md:hidden">
          <ul className="flex flex-col gap-1">
            {links.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-sm px-2 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <Link
                href="/login"
                className="block rounded-sm px-2 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-2)]"
              >
                {tt('nav.signIn')}
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
    </header>
  )
}
