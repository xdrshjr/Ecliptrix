'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useCallback, useMemo, useState, useTransition } from 'react'
import {
  KeyRound,
  LockOpen,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { DataTable, Pagination, type Column } from '@/components/console/data-table'
import { Badge, RoleBadge, StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input, Select } from '@/components/ui/field'
import { DeleteUserDialog, UserFormDialog } from '@/components/console/user-form-dialog'
import { ApiError } from '@/lib/api/client'
import { usersApi } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { RelativeTime } from '@/components/shell/relative-time'

/**
 * Admin user table.
 *
 * Every mutation goes through the REST API and then `router.refresh()`, so the
 * table always shows server truth. There is no optimistic local row mutation: an
 * admin console that shows a change the server rejected is worse than one that
 * waits 200ms.
 */

export interface AdminUser {
  id: string
  email: string
  username: string
  displayName: string
  role: { id: string; key: string; name: string }
  status: string
  planTag: string
  note: string
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  activeSessions: number
  locked: boolean
}
export interface UsersTableProps {
  locale: Locale
  rows: AdminUser[]
  total: number
  page: number
  pageSize: number
  sort: { column: string; direction: 'ASC' | 'DESC' }
  roles: { id: string; key: string; name: string }[]
  initialQuery: string
  initialStatus: string
  canWrite: boolean
  canDelete: boolean
  canRevokeSessions: boolean
  currentUserId: string
}

export function UsersTable(props: UsersTableProps) {
  const locale = props.locale
  const tt = translator(locale)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState(props.initialQuery)
  const [status, setStatus] = useState(props.initialStatus)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<AdminUser | null>(null)
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null)
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      startTransition(() => router.push(`/admin/users?${next.toString()}`))
    },
    [router, searchParams],
  )

  const columns: Column<AdminUser>[] = useMemo(
    () => [
      {
        key: 'email',
        header: tt('common.email'),
        sortable: true,
        render: (row) => (
          <div className="min-w-0">
            <Link
              href={`/admin/users/${row.id}`}
              title={tt('admin.users.detail')}
              className="block truncate text-sm hover:underline"
            >
              {row.displayName || row.username}
            </Link>
            <p className="mono truncate text-xs text-[var(--muted)]">{row.email}</p>
          </div>
        ),
      },
      {
        key: 'role',
        header: tt('admin.users.role'),
        render: (row) => <RoleBadge roleKey={row.role.key} name={row.role.name || row.role.key} />,
      },
      {
        key: 'status',
        header: tt('common.status'),
        render: (row) => (
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge status={row.status} />
            {row.locked ? <Badge tone="warning">locked</Badge> : null}
            {row.mustChangePassword ? <Badge tone="info">temp</Badge> : null}
          </div>
        ),
      },
      {
        key: 'last_login_at',
        header: tt('admin.users.lastLogin'),
        sortable: true,
        // Relative time is client-only (spec R-17): computing it during server
        // rendering makes the SSR text and the hydrated text disagree whenever a
        // timestamp crosses a minute boundary in between.
        render: (row) => (
          <RelativeTime
            iso={row.lastLoginAt}
            locale={props.locale}
            className="mono text-xs text-[var(--muted)]"
          />
        ),
      },
      {
        key: 'sessions',
        header: tt('admin.users.sessions'),
        align: 'right',
        render: (row) => <span className="mono text-xs">{row.activeSessions}</span>,
      },
      {
        key: 'actions',
        header: tt('common.actions'),
        align: 'right',
        render: (row) => (
          <div className="flex items-center justify-end gap-1">
            {props.canWrite ? (
              <IconButton
                label={tt('admin.users.edit')}
                onClick={() => setEditUser(row)}
                icon={<Pencil size={13} />}
              />
            ) : null}
            {props.canWrite ? (
              <IconButton
                label={tt('admin.users.resetPassword')}
                busy={busyId === row.id}
                onClick={() => resetPassword(row)}
                icon={<KeyRound size={13} />}
              />
            ) : null}
            {props.canWrite && row.locked ? (
              <IconButton
                label={tt('admin.users.unlock')}
                busy={busyId === row.id}
                onClick={() => unlock(row)}
                icon={<LockOpen size={13} />}
              />
            ) : null}
            {props.canWrite && row.status === 'deleted' ? (
              <IconButton
                label={tt('admin.users.restore')}
                busy={busyId === row.id}
                onClick={() => restore(row)}
                icon={<RotateCcw size={13} />}
              />
            ) : null}
            {props.canDelete && row.status !== 'deleted' && row.id !== props.currentUserId ? (
              <IconButton
                label={tt('admin.users.delete')}
                onClick={() => setDeleteUser(row)}
                icon={<Trash2 size={13} />}
                danger
              />
            ) : null}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tt, props.canWrite, props.canDelete, props.currentUserId, busyId],
  )

  const resetPassword = async (row: AdminUser) => {
    setBusyId(row.id)
    try {
      const result = await usersApi.resetPassword(row.id)
      setTemporaryPassword(result.temporaryPassword)
      toast.success(tt('admin.users.resetSent'))
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusyId(null)
    }
  }

  const unlock = async (row: AdminUser) => {
    setBusyId(row.id)
    try {
      await usersApi.unlock(row.id)
      toast.success(tt('admin.users.unlocked'))
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusyId(null)
    }
  }

  const restore = async (row: AdminUser) => {
    setBusyId(row.id)
    try {
      await usersApi.restore(row.id)
      toast.success(tt('admin.users.restored'))
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusyId(null)
    }
  }

  const bulk = async (action: 'suspend' | 'activate' | 'delete') => {
    try {
      const result = await usersApi.bulk({ action, ids: selected })
      toast.success(tt('admin.users.bulkApplied', { count: result.affected.length }))
      setSelected([])
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{tt('admin.users.title')}</h1>
          <p className="mono mt-1 text-xs text-[var(--muted)]">{props.total}</p>
        </div>
        {props.canWrite ? (
          <Button icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            {tt('admin.users.new')}
          </Button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setParam({ query, page: null })
          }}
          className="flex flex-1 items-center gap-2"
        >
          <div className="relative flex-1">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-2.5 text-[var(--muted)]"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tt('admin.users.search')}
              className="pl-8"
              aria-label={tt('common.search')}
            />
          </div>
          <Button type="submit" variant="secondary" size="md">
            {tt('common.search')}
          </Button>
        </form>

        <Select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value)
            setParam({ status: event.target.value, page: null })
          }}
          aria-label={tt('common.status')}
          className="w-40"
        >
          <option value="">{tt('admin.users.allStatus')}</option>
          <option value="active">{tt('common.status')} · active</option>
          <option value="suspended">suspended</option>
          <option value="pending">pending</option>
          <option value="deleted">deleted</option>
        </Select>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2">
          <p className="text-xs text-[var(--muted)]">
            {tt('admin.users.bulk', { count: selected.length })}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" icon={<UserMinus size={13} />} onClick={() => bulk('suspend')}>
              {tt('admin.users.suspend')}
            </Button>
            <Button size="sm" variant="secondary" icon={<UserPlus size={13} />} onClick={() => bulk('activate')}>
              {tt('admin.users.activate')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected([])}
            >
              {tt('common.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        columns={columns}
        rows={props.rows}
        rowKey={(row) => row.id}
        loading={pending}
        sort={props.sort}
        onSortChange={(column) =>
          setParam({
            sort: `${props.sort.column === column && props.sort.direction === 'DESC' ? '' : '-'}${column}`,
            page: null,
          })
        }
        selectable={props.canWrite}
        selectedIds={selected}
        onSelectionChange={setSelected}
        emptyTitle={tt('common.none')}
        emptyDescription={tt('admin.users.search')}
        emptyAction={
          props.canWrite ? (
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setCreateOpen(true)}>
              {tt('admin.users.new')}
            </Button>
          ) : undefined
        }
      />

      <Pagination
        page={props.page}
        pageSize={props.pageSize}
        total={props.total}
        totalPages={Math.max(1, Math.ceil(props.total / props.pageSize))}
        onPageChange={(next) => setParam({ page: String(next) })}
      />

      <UserFormDialog
        open={createOpen || editUser !== null}
        locale={props.locale}
        roles={props.roles}
        user={editUser}
        onClose={() => {
          setCreateOpen(false)
          setEditUser(null)
        }}
        onSaved={() => {
          setCreateOpen(false)
          setEditUser(null)
          router.refresh()
        }}
      />

      <DeleteUserDialog
        locale={props.locale}
        user={deleteUser}
        onClose={() => setDeleteUser(null)}
        onDeleted={() => {
          setDeleteUser(null)
          router.refresh()
        }}
      />

      <Dialog
        open={temporaryPassword !== null}
        onClose={() => setTemporaryPassword(null)}
        title={tt('admin.users.resetPassword')}
        description={tt('admin.users.oncePasswordHint')}
        size="sm"
        footer={
          <Button onClick={() => setTemporaryPassword(null)}>{tt('common.close')}</Button>
        }
      >
        <div className="flex items-center gap-2">
          <code className="mono flex-1 rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
            {temporaryPassword}
          </code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (temporaryPassword) void navigator.clipboard.writeText(temporaryPassword)
              toast.success(tt('common.copied'))
            }}
          >
            {tt('common.copy')}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function IconButton({
  label,
  icon,
  onClick,
  busy,
  danger,
}: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  busy?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={busy}
      className={
        danger
          ? 'flex h-7 w-7 items-center justify-center rounded-sm text-[var(--muted)] transition-colors hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] disabled:opacity-40'
          : 'flex h-7 w-7 items-center justify-center rounded-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--foreground)] disabled:opacity-40'
      }
    >
      {icon}
    </button>
  )
}
