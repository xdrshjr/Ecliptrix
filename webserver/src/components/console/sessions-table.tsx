'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/console/confirm-dialog'
import { DataTable, type Column } from '@/components/console/data-table'
import { RelativeTime } from '@/components/shell/relative-time'
import { ApiError } from '@/lib/api/client'
import { sessionsApi, type AdminSessionRow } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Global session table.
 *
 * Built on the existing `DataTable` (which already had selection and server-driven
 * sorting from the user list), so the two admin tables cannot drift apart. Every
 * filter lives in the URL: this is the page an operator opens during an incident,
 * and a filter that only exists in React state cannot be bookmarked or shared.
 *
 * The bulk action posts one request for the whole selection (capped at 100 by the
 * schema and again by the repository) and writes ONE aggregated audit row.
 */
export function SessionsTable({
  locale,
  rows,
  total,
  page,
  pageSize,
  sort,
  filters,
  canRevoke,
}: {
  locale: Locale
  rows: AdminSessionRow[]
  total: number
  page: number
  pageSize: number
  sort: { column: string; direction: 'ASC' | 'DESC' }
  filters: { query: string; client: string; platform: string; activeOnly: boolean }
  canRevoke: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reason, setReason] = useState('admin_revoke')
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === '') next.delete(key)
      else next.set(key, value)
    }
    router.push(`/admin/sessions?${next.toString()}`)
  }

  const columns: Column<AdminSessionRow>[] = [
    {
      key: 'user',
      header: tt('common.email'),
      render: (row) => (
        <div>
          <div className="font-mono text-xs">{row.userEmail}</div>
          <div className="text-2xs text-[var(--muted)]">{row.userDisplayName}</div>
        </div>
      ),
    },
    {
      key: 'device',
      header: tt('admin.sessions.device'),
      render: (row) => (
        <span className="text-xs">
          {row.deviceName || '—'}
          <span className="ml-1 text-[var(--muted)]">({row.client})</span>
        </span>
      ),
    },
    { key: 'platform', header: tt('admin.sessions.platform'), render: (row) => row.platform || '—' },
    {
      key: 'appVersion',
      header: tt('admin.sessions.appVersion'),
      render: (row) => <span className="font-mono text-2xs">{row.appVersion || '—'}</span>,
    },
    {
      key: 'deviceKey',
      header: tt('admin.sessions.deviceKey'),
      render: (row) => <span className="font-mono text-2xs">{row.deviceKeyPrefix || '—'}</span>,
    },
    {
      key: 'lastSeen',
      header: tt('admin.sessions.lastSeen'),
      sortable: true,
      render: (row) => <RelativeTime iso={row.lastSeenAt} locale={locale} />,
    },
    {
      key: 'state',
      header: tt('common.status'),
      render: (row) =>
        row.active ? (
          <Badge tone="accent">{tt('admin.sessions.stateActive')}</Badge>
        ) : (
          <Badge tone="neutral">{row.revokedReason ?? tt('admin.sessions.stateRevoked')}</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      // Row-level revoke: kicking ONE device is the common case during a support
      // call ("sign that laptop out"), and `DELETE /admin/sessions/{id}` existed
      // with no way to reach it from this page.
      render: (row) =>
        row.active && canRevoke ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={revokingId === row.id}
            onClick={() => revokeOne(row.id)}
          >
            {tt('admin.sessions.revoke')}
          </Button>
        ) : null,
    },
  ]

  const revokeSelected = async () => {
    setBusy(true)
    try {
      const result = await sessionsApi.revokeMany(selected, reason)
      toast.success(tt('admin.sessions.revoked', { count: result.revoked }))
      if (result.skipped > 0) toast.info(tt('admin.sessions.skipped', { count: result.skipped }))
      setSelected([])
      setConfirmOpen(false)
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusy(false)
    }
  }

  const revokeOne = async (id: string) => {
    setRevokingId(id)
    try {
      // The single-session route records `admin_revoked` itself; the reason
      // selector belongs to the bulk endpoint (one aggregated audit row).
      const result = await sessionsApi.revokeForUser(id)
      if (result.revoked) toast.success(tt('admin.sessions.revoked', { count: 1 }))
      else toast.info(tt('admin.sessions.skipped', { count: 1 }))
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setRevokingId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          defaultValue={filters.query}
          placeholder={tt('admin.sessions.query')}
          aria-label={tt('admin.sessions.query')}
          className="h-8 min-w-[240px] rounded-sm border border-[var(--border)] bg-transparent px-2 text-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              update({ query: (event.target as HTMLInputElement).value, page: '1' })
            }
          }}
        />
        <select
          aria-label={tt('admin.sessions.allClients')}
          className="h-8 rounded-sm border border-[var(--border)] bg-transparent px-2 text-xs"
          value={filters.client}
          onChange={(event) => update({ client: event.target.value, page: '1' })}
        >
          <option value="">{tt('admin.sessions.allClients')}</option>
          <option value="desktop">desktop</option>
          <option value="web">web</option>
        </select>
        {/* `platform` was already accepted by the endpoint and typed here, but no
            control ever rendered it — the documented filter was URL-only. */}
        <input
          type="text"
          defaultValue={filters.platform}
          placeholder={tt('admin.sessions.allPlatforms')}
          aria-label={tt('admin.sessions.allPlatforms')}
          className="h-8 w-[150px] rounded-sm border border-[var(--border)] bg-transparent px-2 text-xs"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              update({ platform: (event.target as HTMLInputElement).value, page: '1' })
            }
          }}
        />
        <label className="flex items-center gap-1 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={filters.activeOnly}
            onChange={(event) => update({ activeOnly: event.target.checked ? '1' : '', page: '1' })}
          />
          {tt('admin.sessions.activeOnly')}
        </label>
        {canRevoke && (
          <div className="ml-auto flex items-center gap-2">
            <select
              aria-label={tt('admin.sessions.reason')}
              className="h-8 rounded-sm border border-[var(--border)] bg-transparent px-2 text-xs"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            >
              <option value="admin_revoke">{tt('admin.sessions.reasonAdmin')}</option>
              <option value="admin_lockdown">{tt('admin.sessions.reasonLockdown')}</option>
              <option value="security_incident">{tt('admin.sessions.reasonIncident')}</option>
            </select>
            <Button
              size="sm"
              variant="danger"
              disabled={selected.length === 0}
              onClick={() => setConfirmOpen(true)}
            >
              {tt('admin.sessions.revokeSelected')}
            </Button>
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyTitle={tt('admin.sessions.empty')}
        sort={sort}
        onSortChange={(column) =>
          update({
            sort:
              sort.column === column
                ? `${sort.direction === 'DESC' ? '' : '-'}${column}`
                : `-${column}`,
          })
        }
        selectable={canRevoke}
        selectedIds={selected}
        onSelectionChange={setSelected}
      />

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

      <ConfirmDialog
        locale={locale}
        open={confirmOpen}
        title={tt('admin.sessions.revokeSelected')}
        description={tt('admin.sessions.reason')}
        confirmLabel={tt('admin.sessions.revoke')}
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void revokeSelected()}
      />
    </div>
  )
}
