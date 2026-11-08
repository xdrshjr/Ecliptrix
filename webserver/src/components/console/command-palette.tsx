'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { translator, type Locale } from '@/lib/i18n'

/**
 * ⌘K command palette.
 *
 * Navigation only — it jumps between pages the caller can already open, and the
 * list is built on the server from the same permission-filtered nav the sidebar
 * uses. A palette that offers a link the server will refuse is a trap, so no
 * client-side permission logic lives here.
 *
 * Built by hand rather than with a command-menu library: the whole feature is
 * this file, and a dependency would need its own keyboard, focus and a11y work
 * anyway (CLAUDE.md: new dependencies must be necessary).
 */

export interface PaletteCommand {
  href: string
  label: string
  group: string
}

export interface CommandPaletteProps {
  locale: Locale
  commands: PaletteCommand[]
}

export function CommandPalette({ locale, commands }: CommandPaletteProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle))
  }, [commands, query])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((previous) => !previous)
        return
      }
      if (!open) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActive(0)
      return
    }
    inputRef.current?.focus()
  }, [open])

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
    router.refresh()
  }

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((previous) => Math.min(previous + 1, Math.max(0, results.length - 1)))
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((previous) => Math.max(previous - 1, 0))
    }
    if (event.key === 'Enter') {
      const target = results[active]
      if (target) go(target.href)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tt('common.search')}
        className="hidden h-8 items-center gap-2 rounded-sm border border-[var(--border)] px-2.5 text-xs text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)] sm:inline-flex"
      >
        <Search size={13} />
        <span>{tt('common.search')}</span>
        <kbd className="mono rounded border border-[var(--border)] px-1 text-[10px]">⌘K</kbd>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]">
          <div
            className="absolute inset-0"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={tt('common.search')}
            className="relative w-full max-w-md overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3">
              <Search size={14} className="text-[var(--muted)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                onKeyDown={onInputKeyDown}
                placeholder={tt('admin.users.search')}
                aria-label={tt('common.search')}
                className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
              />
            </div>

            <ul className="max-h-72 overflow-y-auto py-1">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-[var(--muted)]">
                  {tt('common.none')}
                </li>
              ) : (
                results.map((command, index) => (
                  <li key={command.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(command.href)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                        index === active
                          ? 'bg-[var(--surface-2)] text-[var(--foreground)]'
                          : 'text-[var(--muted)]',
                      )}
                    >
                      <span className="truncate">{command.label}</span>
                      <span className="mono shrink-0 text-2xs text-[var(--muted)]">
                        {command.group}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>

            <p className="flex items-center gap-1.5 border-t border-[var(--border)] px-3 py-2 text-2xs text-[var(--muted)]">
              <CornerDownLeft size={11} /> Enter · Esc
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}
