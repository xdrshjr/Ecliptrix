import { cn } from '@/lib/cn'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Data table.
 *
 * Server-driven: sorting and paging are links/queries, not client state, so a
 * reload keeps the view and the URL is shareable. Empty and loading states are
 * part of the component because a table that renders a bare `<tbody>` looks
 * broken rather than empty.
 */

export interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
  className?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  sort?: { column: string; direction: 'ASC' | 'DESC' }
  onSortChange?: (column: string) => void
  selectable?: boolean
  selectedIds?: string[]
  onSelectionChange?: (ids: string[]) => void
  onRowClick?: (row: T) => void
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = '暂无数据',
  emptyDescription,
  emptyAction,
  sort,
  onSortChange,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  onRowClick,
}: DataTableProps<T>) {
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(rowKey(row)))

  const toggleAll = () => {
    if (!onSelectionChange) return
    onSelectionChange(allSelected ? [] : rows.map(rowKey))
  }

  const toggleOne = (id: string) => {
    if (!onSelectionChange) return
    onSelectionChange(
      selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id],
    )
  }

  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface)]">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--surface)]">
            <tr className="border-b border-[var(--border)]">
              {selectable ? (
                <th scope="col" className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="全选"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const active = sort?.column === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn(
                      'whitespace-nowrap px-3 py-2.5 text-xs font-medium text-[var(--muted)]',
                      column.align === 'right' ? 'text-right' : 'text-left',
                      column.className,
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1 transition-colors hover:text-[var(--foreground)]',
                          active && 'text-[var(--foreground)]',
                        )}
                      >
                        {column.header}
                        {active ? (
                          sort?.direction === 'ASC' ? (
                            <ArrowUp size={12} />
                          ) : (
                            <ArrowDown size={12} />
                          )
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, index) => (
                  <tr key={`skeleton-${index}`} className="border-b border-[var(--border)]">
                    <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-3">
                      <div className="skeleton h-6 w-full rounded-sm" />
                    </td>
                  </tr>
                ))
              : rows.map((row) => {
                  const id = rowKey(row)
                  const selected = selectedIds.includes(id)
                  return (
                    <tr
                      key={id}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cn(
                        'border-b border-[var(--border)] transition-colors duration-75',
                        'hover:bg-[var(--surface-2)]',
                        onRowClick && 'cursor-pointer',
                        selected && 'bg-[var(--surface-2)]',
                      )}
                    >
                      {selectable ? (
                        <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label={`选择 ${id}`}
                            checked={selected}
                            onChange={() => toggleOne(id)}
                            className="h-3.5 w-3.5 accent-[var(--accent)]"
                          />
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={cn(
                            'px-3 py-2.5 align-middle',
                            column.align === 'right' && 'text-right',
                            column.className,
                          )}
                        >
                          {column.render(row)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
          </tbody>
        </table>
      </div>

      {!loading && rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-strong)] text-[var(--muted)]">
            <Search size={18} />
          </div>
          <div>
            <p className="text-sm font-medium">{emptyTitle}</p>
            {emptyDescription ? (
              <p className="mt-1 text-xs text-[var(--muted)]">{emptyDescription}</p>
            ) : null}
          </div>
          {emptyAction}
        </div>
      ) : null}
    </div>
  )
}

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, pageSize, total, totalPages, onPageChange }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--muted)]">
      <p className="mono">
        {from}–{to} / {total}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="上一页"
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--border)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="mono px-2">
          {page} / {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="下一页"
          className="flex h-8 w-8 items-center justify-center rounded-sm border border-[var(--border)] transition-colors hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
