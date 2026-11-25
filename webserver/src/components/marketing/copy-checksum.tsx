'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { translator, type Locale } from '@/lib/i18n'

/**
 * Copyable SHA-256.
 *
 * A checksum the user cannot easily copy is a checksum nobody verifies, and the
 * installer is unsigned in v1 (analysis §6.10) — this value is the only integrity
 * check available, so it gets its own button and its own live region: a label swap
 * alone is invisible to a screen reader, and a silent failure is indistinguishable
 * from success.
 */
export function CopyChecksum({ sha256, locale }: { sha256: string; locale: Locale }) {
  const tt = translator(locale)
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sha256)
      setState('copied')
      window.setTimeout(() => setState('idle'), 1600)
    } catch {
      // Clipboard permission denied: the value is visible and selectable, so the
      // user can still copy it by hand. Never claim success.
      setState('failed')
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="mono select-all break-all rounded-sm border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--muted)]">
        {sha256}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--border-strong)] px-2 py-1 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      >
        {state === 'copied' ? <Check size={12} /> : <Copy size={12} />}
        {state === 'copied' ? tt('common.copied') : tt('download.checksum.copy')}
      </button>
      <span role="status" aria-live="polite" className="text-2xs text-[var(--danger)]">
        {state === 'failed' ? tt('download.checksum.copyFailed') : ''}
      </span>
    </div>
  )
}
