'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { DataTable, type Column } from '@/components/console/data-table'
import { RelativeTime } from '@/components/shell/relative-time'
import { ApiError } from '@/lib/api/client'
import { mailApi, type MailRow } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Mail outbox table.
 *
 * The detail pane shows the rendered TEXT inside a `<pre>`. It never renders the
 * HTML part: the console would otherwise become a renderer for content an attacker
 * influences through a display name, and the stored body already carries
 * `token=***`.
 *
 * Retry is hidden (not disabled-then-erroring) for rows with `retryable === false`:
 * a one-shot link cannot be replayed, so the honest affordance is "ask the user to
 * request a new one" instead of a button that always answers 409.
 */
export function MailTable({
  locale,
  rows,
  total,
  page,
  pageSize,
  status,
  template,
  canRetry,
  capabilities,
}: {
  locale: Locale
  rows: MailRow[]
  total: number
  page: number
  pageSize: number
  status: string
  template: string
  canRetry: boolean
  capabilities: { mode: string; fromAddress: string; sent24h: number; failed24h: number }
}) {
  const tt = translator(locale)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [detail, setDetail] = useState<(MailRow & { subject: string; text: string }) | null>(null)

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === '') next.delete(key)
      else next.set(key, value)
    }
    router.push(`/admin/mail?${next.toString()}`)
  }

  const retry = async (row: MailRow) => {
    setBusyId(row.id)
    try {
      const result = await mailApi.retry(row.id)
      if (result.status === 'sent') toast.success(tt('admin.mail.status') + ': sent')
      else toast.error(result.lastError || tt('admin.mail.failed24h'))
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusyId(null)
    }
  }

  const openDetail = async (row: MailRow) => {
    try {
      setDetail(await mailApi.detail(row.id))
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    }
  }

  const columns: Column<MailRow>[] = [
    {
      key: 'template',
      header: tt('admin.mail.template'),
      render: (row) => <span className="font-mono text-2xs">{row.template}</span>,
    },
    {
      key: 'recipient',
      header: tt('admin.mail.recipient'),
      render: (row) => <span className="font-mono text-xs">{row.toMasked}</span>,
    },
    {
      key: 'status',
      header: tt('admin.mail.status'),
      render: (row) => (
        <Badge
          tone={row.status === 'sent' ? 'accent' : row.status === 'failed' ? 'danger' : 'neutral'}
        >
          {row.status}
        </Badge>
      ),
    },
    { key: 'attempts', header: tt('admin.mail.attempts'), render: (row) => row.attempts },
    {
      key: 'createdAt',
      header: tt('admin.mail.createdAt'),
      render: (row) => <RelativeTime iso={row.createdAt} locale={locale} />,
    },
    {
      key: 'sentAt',
      header: tt('admin.mail.sentAt'),
      render: (row) => <RelativeTime iso={row.sentAt} locale={locale} />,
    },
    {
      key: 'actions',
      header: tt('common.actions'),
      align: 'right',
      render: (row) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => void openDetail(row)}>
            {tt('admin.mail.detail')}
          </Button>
          {canRetry &&
            (row.retryable ? (
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === row.id}
                onClick={() => void retry(row)}
              >
                {tt('admin.mail.retry')}
              </Button>
            ) : (
              <span className="text-2xs text-[var(--muted)]">{tt('admin.mail.notRetryable')}</span>
            ))}
        </div>
      ),
    },
  ]

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs">
        <span className="text-[var(--muted)]">{tt('admin.mail.mode')}:</span>
        <span>{capabilities.mode === 'smtp' ? tt('admin.mail.modeSmtp') : tt('admin.mail.modeOutbox')}</span>
        <span className="font-mono text-2xs text-[var(--muted)]">{capabilities.fromAddress}</span>
        <span className="ml-auto">
          {tt('admin.mail.sent24h')}: {capabilities.sent24h} · {tt('admin.mail.failed24h')}:{' '}
          {capabilities.failed24h}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={tt('admin.mail.status')}
          className="h-8 rounded-sm border border-[var(--border)] bg-transparent px-2 text-xs"
          value={status}
          onChange={(event) => update({ status: event.target.value, page: '1' })}
        >
          <option value="">{tt('common.none')}</option>
          <option value="captured">captured</option>
          <option value="sent">sent</option>
          <option value="failed">failed</option>
        </select>
        <input
          type="search"
          defaultValue={template}
          aria-label={tt('admin.mail.template')}
          placeholder={tt('admin.mail.template')}
          className="h-8 rounded-sm border border-[var(--border)] bg-transparent px-2 text-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              update({ template: (event.target as HTMLInputElement).value, page: '1' })
            }
          }}
        />
      </div>

      <DataTable columns={columns} rows={rows} rowKey={(row) => row.id} />

      <div className="flex items-center justify-between text-xs text-[var(--muted)]">
        <span>
          {total} · {page}/{totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            {tt('common.prev')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => update({ page: String(page + 1) })}
          >
            {tt('common.next')}
          </Button>
        </div>
      </div>

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={tt('admin.mail.detail')}
        description={detail?.subject}
      >
        <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-sm bg-[var(--surface-raised)] p-3 text-xs">
          {detail?.text ?? ''}
        </pre>
      </Dialog>
    </div>
  )
}
