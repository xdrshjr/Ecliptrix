'use client'

import { Download } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { meApi } from '@/lib/api/endpoints'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * "Export my data" block.
 *
 * A fetch-and-blob rather than `<a download>`, for the same reason as the console's
 * CSV export: an anchor cannot read a response status or a header. Two consequences
 * it fixes —
 *  - once the cooldown has started the button is disabled, so a click cannot
 *    navigate the whole tab onto a raw `429` JSON envelope;
 *  - a failed export stays on the page and prints the envelope's message.
 *
 * The cooldown itself comes from the server (`users.last_exported_at`); the client
 * only renders it.
 */
export function DataExportPanel({
  locale,
  cooldownMinutes,
}: {
  locale: Locale
  cooldownMinutes: number
}) {
  const tt = translator(locale)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cooling = cooldownMinutes > 0

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(meApi.exportUrl(), { credentials: 'same-origin' })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: { code?: string } }
          | null
        setError(errorMessage(body?.error?.code ?? 'internal_error', locale))
        return
      }
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'ecliptrix-account.json'
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError(tt('errors.network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="export-heading" className="mt-6 rounded-md border border-[var(--border)] p-5">
      <h2 id="export-heading" className="text-sm font-medium">
        {tt('account.export.title')}
      </h2>
      <p className="mt-2 text-xs text-[var(--muted)]">{tt('account.export.desc')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={cooling}
          onClick={() => void download()}
        >
          <Download size={14} className="mr-1" />
          {tt('account.export.submit')}
        </Button>
        {cooling && (
          <span className="text-2xs text-[var(--muted)]">
            {tt('account.export.cooldown', { minutes: cooldownMinutes })}
          </span>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
