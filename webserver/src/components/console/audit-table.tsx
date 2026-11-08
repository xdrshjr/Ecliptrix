'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { Pagination } from '@/components/console/data-table'
import { RelativeTime } from '@/components/shell/relative-time'
import { translator, type Locale } from '@/lib/i18n'
import type { PageMeta } from '@/server/db/types'

/**
 * Audit table.
 *
 * Rows expand to show the before/after metadata as JSON. It is collapsed by
 * default because the list's job is "what happened and when"; the payload matters
 * only once a specific row is under investigation.
 */
export interface AuditEvent {
  id: string
  actorLabel: string
  action: string
  targetType: string
  targetId: string
  ip: string
  createdAt: string
  metadata: Record<string, unknown>
}

export function AuditTable({
  locale,
  events,
  page,
}: {
  locale: Locale
  events: AuditEvent[]
  page: PageMeta
}) {
  const tt = translator(locale)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [query, setQuery] = useState(searchParams.get('query') ?? '')
  const [expanded, setExpanded] = useState<string | null>(null)

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (!value) next.delete(key)
      else next.set(key, value)
    }
    startTransition(() => router.push(`/admin/audit?${next.toString()}`))
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setParam({ query, page: null })
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--muted)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="actor / action / target id"
            className="pl-8"
            aria-label={tt('common.search')}
          />
        </div>
        <Button type="submit" variant="secondary">
          {tt('common.search')}
        </Button>
      </form>

      <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {[
                tt('admin.audit.time'),
                tt('admin.audit.actor'),
                tt('admin.audit.action'),
                tt('admin.audit.target'),
                tt('admin.audit.ip'),
                '',
              ].map((header) => (
                <th key={header} scope="col" className="px-3 py-2.5 text-left text-xs font-medium text-[var(--muted)]">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => {
              const open = expanded === event.id
              return (
                <>
                  <tr
                    key={event.id}
                    className={`border-b border-[var(--border)] ${pending ? 'opacity-60' : ''}`}
                  >
                    <td className="mono whitespace-nowrap px-3 py-2.5 text-xs text-[var(--muted)]">
                      <RelativeTime iso={event.createdAt} locale={locale} />
                    </td>
                    <td className="px-3 py-2.5 text-xs">{event.actorLabel}</td>
                    <td className="mono px-3 py-2.5 text-xs text-[var(--foreground)]">{event.action}</td>
                    <td className="mono px-3 py-2.5 text-xs text-[var(--muted)]">
                      {event.targetType}
                      {event.targetId ? `:${event.targetId.slice(0, 8)}` : ''}
                    </td>
                    <td className="mono px-3 py-2.5 text-xs text-[var(--muted)]">{event.ip || '—'}</td>
                    <td className="px-3 py-2.5 text-right">
                      {Object.keys(event.metadata).length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : event.id)}
                          aria-expanded={open}
                          aria-label="detail"
                          className="inline-flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                        >
                          <ChevronDown
                            size={13}
                            className={open ? 'rotate-180 transition-transform' : 'transition-transform'}
                          />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {open ? (
                    <tr key={`${event.id}-detail`} className="border-b border-[var(--border)] bg-[var(--surface-2)]">
                      <td colSpan={6} className="px-3 py-3">
                        <pre className="mono overflow-x-auto whitespace-pre-wrap text-2xs leading-5 text-[var(--muted)]">
                          {JSON.stringify(event.metadata, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </>
              )
            })}
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                  {tt('common.none')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page.page}
        pageSize={page.pageSize}
        total={page.total}
        totalPages={page.totalPages}
        onPageChange={(next) => setParam({ page: String(next) })}
      />
    </div>
  )
}
