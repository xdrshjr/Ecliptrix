'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut, Menu, ShieldCheck, User, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { LogoLink } from '@/components/shell/logo'
import { ThemeToggle } from '@/components/shell/theme-toggle'
import { RoleBadge } from '@/components/ui/badge'
import { CommandPalette, type PaletteCommand } from '@/components/console/command-palette'
import { api } from '@/lib/api/client'
import { translator, type Locale } from '@/lib/i18n'

/**
 * Console shell: sidebar + topbar.
 *
 * Navigation is filtered on the server before it reaches this component, so a
 * member never sees an admin link — hiding it client-side would still ship the
 * link and invite a dead end.
 */
export interface ConsoleNavItem {
  href: string
  label: string
  /** Which group the item belongs to; the shell only draws the divider. */
  section: 'account' | 'admin'
}

export interface ConsoleShellProps {
  locale: Locale
  /** Already filtered against the caller's permissions on the server. */
  nav: ConsoleNavItem[]
  user: {
    displayName: string
    email: string
    roleKey: string
    roleName: string
    mustChangePassword: boolean
  }
  children: React.ReactNode
}

export function ConsoleShell({ locale, nav, user, children }: ConsoleShellProps) {
  const tt = translator(locale)
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  // One list for the sidebar and the ⌘K palette, so the palette can never offer a
  // page the sidebar hides. Both groups come from the server, already filtered
  // against the caller's real permissions.
  const accountNav = nav.filter((item) => item.section === 'account')
  const adminNav = nav.filter((item) => item.section === 'admin')

  const commands: PaletteCommand[] = [
    ...accountNav.map((item) => ({
      href: item.href,
      label: item.label,
      group: tt('account.title'),
    })),
    ...adminNav.map((item) => ({ href: item.href, label: item.label, group: tt('admin.title') })),
    { href: '/', label: tt('nav.product'), group: tt('nav.product') },
  ]

  const signOut = async () => {
    try {
      await api.post('/api/v1/auth/logout')
    } catch {
      // Signing out must never be blocked by the network: the cookies are cleared
      // by the server response when it arrives, and locally we navigate anyway.
    }
    router.replace('/login')
    router.refresh()
  }

  const sidebar = (
    <nav aria-label={tt('account.title')} className="flex h-full flex-col gap-6 p-3">
      <div className="px-1">
        <LogoLink href={adminNav.length > 0 ? '/admin' : '/account'} />
      </div>

      <ul className="flex flex-col gap-0.5">
        {accountNav.map((item) => {
          const active = pathname === item.href || (item.href !== '/account' && pathname.startsWith(`${item.href}/`))
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-[var(--surface-2)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
                )}
              >
                <User size={14} />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>

      {adminNav.length > 0 ? (
        <div className="flex flex-col gap-0.5 border-t border-[var(--border)] pt-3">
          {adminNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-[var(--surface-2)] text-[var(--foreground)]'
                    : 'text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]',
                )}
              >
                <ShieldCheck size={14} />
                {item.label}
              </Link>
            )
          })}
        </div>
      ) : null}

      <div className="mt-auto rounded-sm border border-[var(--border)] p-3">
        <p className="truncate text-sm font-medium">{user.displayName || user.email}</p>
        <p className="truncate text-xs text-[var(--muted)]">{user.email}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <RoleBadge roleKey={user.roleKey} name={user.roleName} />
        </div>
      </div>
    </nav>
  )

  return (
    <div className="grid min-h-screen lg:grid-cols-[240px_1fr]">
      <aside className="hidden border-r border-[var(--border)] bg-[var(--surface)] lg:block">
        {sidebar}
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <div className="relative h-full w-64 border-r border-[var(--border)] bg-[var(--surface)]">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label={tt('common.close')}
              className="absolute right-2 top-2 rounded-sm p-1.5 text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <X size={16} />
            </button>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--background)]/85 px-4 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={tt('common.search')}
              className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--border)] text-[var(--muted)] lg:hidden"
            >
              <Menu size={15} />
            </button>
            <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
              ← {tt('nav.product')}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <CommandPalette locale={locale} commands={commands} />
            <ThemeToggle />
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[var(--border)] px-2.5 text-xs text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
            >
              <LogOut size={13} />
              {tt('nav.signOut')}
            </button>
          </div>
        </header>

        {user.mustChangePassword ? (
          <div
            role="status"
            className="border-b border-[var(--warning)]/40 bg-[var(--warning)]/5 px-4 py-2 text-xs text-[var(--warning)]"
          >
            {tt('errors.password_change_required')} —{' '}
            <Link href="/account/security" className="underline">
              {tt('account.security')}
            </Link>
          </div>
        ) : null}

        <main id="main" className="flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
      </div>
    </div>
  )
}
