'use client'

import { Moon, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { applyTheme, currentTheme, nextTheme, type Theme } from '@/lib/theme'

/**
 * Theme toggle.
 *
 * Reads the painted theme rather than a prop: the boot script has already
 * decided it by the time React hydrates, and re-deriving it here would either
 * duplicate that logic or disagree with it.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    setTheme(currentTheme())
  }, [])

  const toggle = () => {
    const next = nextTheme(theme)
    applyTheme(next)
    setTheme(next)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
      className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--border)] text-[var(--muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)]"
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}
