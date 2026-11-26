'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  KeyRound,
  LockOpen,
  Pencil,
  RotateCcw,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import { Badge, RoleBadge, StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ActivityTimeline } from '@/components/account/activity-timeline'
import { UserFormDialog, DeleteUserDialog } from '@/components/console/user-form-dialog'
import { UserSessionsPanel } from '@/components/console/user-sessions-panel'
import { ApiError } from '@/lib/api/client'
import { usersApi, type AdminUserDto, type RoleOption, type SessionDto } from '@/lib/api/endpoints'
import { permissionLabel } from '@/lib/permissionsCatalog'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { absoluteTime } from '@/lib/format'

/**
 * User detail — profile, access, devices and activity for one account.
 *
 * The list page is for finding a user; this page is for answering "what can
 * this person do, and what have they done". Both live under the same permission
 * (`users.read`); every mutation re-checks a narrower one on the server, because
 * a hidden button is not an authorisation check.
 */

type Tab = 'profile' | 'access' | 'sessions' | 'activity'

export interface UserDetailProps {
  locale: Locale
  user: AdminUserDto
  sessions: SessionDto[]
  activity: { id: string; action: string; ip: string; createdAt: string }[]
  roles: RoleOption[]
  /** Permissions granted by the user's current role; `['*']` for owner. */
  permissions: string[]
  canWrite: boolean
  canDelete: boolean
  canRevokeSessions: boolean
  isSelf: boolean
  isOwnerTarget: boolean
}

export function UserDetail(props: UserDetailProps) {
  const { locale, user, canWrite, isSelf, isOwnerTarget } = props
  const tt = translator(locale)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('profile')
  const [busy, setBusy] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null)

  const protectedTarget = isOwnerTarget || (isSelf && !canWrite)
  const deleted = user.status === 'deleted'

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key)
    try {
      await action()
      toast.success(success)
      router.refresh()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusy(null)
    }
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'profile', label: tt('admin.users.tabProfile') },
    { key: 'access', label: tt('admin.users.tabAccess') },
    { key: 'sessions', label: tt('admin.users.tabSessions') },
    { key: 'activity', label: tt('admin.users.tabActivity') },
  ]

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        <ArrowLeft size={13} /> {tt('admin.users.backToList')}
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-[-0.01em]">
            {user.displayName || user.username || user.email}
          </h1>
          <p className="mono mt-1 truncate text-sm text-[var(--muted)]">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <RoleBadge roleKey={user.role.key} name={user.role.name || user.role.key} />
            <StatusBadge status={user.status} />
            {user.locked ? <Badge tone="warning">{tt('admin.users.unlock')}</Badge> : null}
            {user.mustChangePassword ? <Badge tone="info">temp</Badge> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {canWrite && !isOwnerTarget ? (
            <Button size="sm" variant="secondary" icon={<Pencil size={13} />} onClick={() => setEditOpen(true)}>
              {tt('admin.users.edit')}
            </Button>
          ) : null}
          {canWrite && !protectedTarget ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'status'}
              icon={user.status === 'active' ? <UserMinus size={13} /> : <UserPlus size={13} />}
              onClick={() =>
                run(
                  'status',
                  () =>
                    usersApi.update(user.id, {
                      status: user.status === 'active' ? 'suspended' : 'active',
                    }),
                  tt('admin.users.updated'),
                )
              }
            >
              {user.status === 'active' ? tt('admin.users.suspend') : tt('admin.users.activate')}
            </Button>
          ) : null}
          {canWrite && user.locked ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'unlock'}
              icon={<LockOpen size={13} />}
              onClick={() => run('unlock', () => usersApi.unlock(user.id), tt('admin.users.unlocked'))}
            >
              {tt('admin.users.unlock')}
            </Button>
          ) : null}
          {canWrite && !user.emailVerified && !deleted ? (
            // The escape hatch for "the user cannot receive mail": marks the
            // address verified and records `user.email_verified_by_admin`, so the
            // user can see an administrator let them in.
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'emailVerify'}
              icon={<BadgeCheck size={13} />}
              onClick={() =>
                run(
                  'emailVerify',
                  () => usersApi.markEmailVerified(user.id),
                  tt('admin.users.markVerified'),
                )
              }
            >
              {tt('admin.users.markVerified')}
            </Button>
          ) : null}
          {canWrite && !isOwnerTarget ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'reset'}
              icon={<KeyRound size={13} />}
              onClick={async () => {
                setBusy('reset')
                try {
                  const result = await usersApi.resetPassword(user.id)
                  setTemporaryPassword(result.temporaryPassword)
                  toast.success(tt('admin.users.resetSent'))
                } catch (thrown) {
                  toast.error(
                    thrown instanceof ApiError
                      ? errorMessage(thrown.code, locale)
                      : tt('errors.network'),
                  )
                } finally {
                  setBusy(null)
                }
              }}
            >
              {tt('admin.users.resetPassword')}
            </Button>
          ) : null}
          {canWrite && deleted ? (
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'restore'}
              icon={<RotateCcw size={13} />}
              onClick={() => run('restore', () => usersApi.restore(user.id), tt('admin.users.restored'))}
            >
              {tt('admin.users.restore')}
            </Button>
          ) : null}
          {props.canDelete && !protectedTarget ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={13} />}
              onClick={() => setDeleteOpen(true)}
            >
              {tt('admin.users.delete')}
            </Button>
          ) : null}
        </div>
      </header>

      <div role="tablist" aria-label={tt('admin.users.detail')} className="mt-6 flex gap-1 border-b border-[var(--border)]">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={`tab-${item.key}`}
            aria-selected={tab === item.key}
            aria-controls={`panel-${item.key}`}
            onClick={() => setTab(item.key)}
            className={
              tab === item.key
                ? 'border-b-2 border-[var(--accent)] px-3 py-2 text-sm text-[var(--foreground)]'
                : 'border-b-2 border-transparent px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--foreground)]'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-4">
        {tab === 'profile' ? <ProfileTab locale={locale} user={user} /> : null}
        {tab === 'access' ? <AccessTab locale={locale} user={user} permissions={props.permissions} /> : null}
        {tab === 'sessions' ? (
          <UserSessionsPanel
            locale={locale}
            sessions={props.sessions}
            canRevoke={props.canRevokeSessions}
          />
        ) : null}
        {tab === 'activity' ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5">
            <ActivityTimeline locale={locale} events={props.activity} />
          </div>
        ) : null}
      </div>

      <UserFormDialog
        locale={locale}
        open={editOpen}
        roles={props.roles}
        user={user}
        onClose={() => setEditOpen(false)}
        onSaved={() => {
          setEditOpen(false)
          router.refresh()
        }}
      />

      <DeleteUserDialog
        locale={locale}
        user={deleteOpen ? user : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false)
          router.push('/admin/users')
        }}
      />

      <Dialog
        open={Boolean(temporaryPassword)}
        onClose={() => setTemporaryPassword(null)}
        title={tt('admin.users.resetSent')}
        description={tt('admin.users.oncePasswordHint')}
        size="sm"
        footer={
          <Button onClick={() => setTemporaryPassword(null)}>{tt('common.close')}</Button>
        }
      >
        <code className="mono block rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          {temporaryPassword}
        </code>
      </Dialog>
    </div>
  )
}

function ProfileTab({ locale, user }: { locale: Locale; user: AdminUserDto }) {
  const tt = translator(locale)
  const rows: { label: string; value: string }[] = [
    { label: tt('common.email'), value: user.email },
    { label: tt('common.username'), value: user.username },
    { label: tt('account.profile.displayName'), value: user.displayName || '—' },
    { label: tt('admin.users.plan'), value: user.planTag },
    { label: tt('admin.users.createdAt'), value: absoluteTime(user.createdAt, locale) },
    {
      label: tt('admin.users.lastLogin'),
      value: (
        // Cells are values, not elements, in this descriptor; resolving the
        // relative form here would run during SSR (spec R-17). The operator
        // gets the absolute stamp, which is deterministic on both sides.
        absoluteTime(user.lastLoginAt, locale)
      ),
    },
    { label: tt('admin.users.note'), value: user.note || '—' },
    // Verification state belongs on the profile tab: without it a verified address
    // and one that was never verified look identical unless the "mark verified"
    // button happens to be absent, which is not a signal anybody reads.
    {
      label: tt('admin.users.emailVerified'),
      value: user.emailVerified ? '✓' : tt('admin.users.notVerified'),
    },
    {
      label: tt('admin.users.verifiedAt'),
      value: user.emailVerifiedAt ? absoluteTime(user.emailVerifiedAt, locale) : '—',
    },
  ]

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5">
      <dl className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-xs text-[var(--muted)]">{row.label}</dt>
            <dd className="mt-0.5 break-words text-sm">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function AccessTab({
  locale,
  user,
  permissions,
}: {
  locale: Locale
  user: AdminUserDto
  permissions: string[]
}) {
  const tt = translator(locale)
  const wildcard = permissions.includes('*')

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--muted)]">{tt('admin.users.role')}</span>
        <RoleBadge roleKey={user.role.key} name={user.role.name || user.role.key} />
      </div>

      {/*
        Grant ledger (migration 0007, AC-23). Rendered from `users.role_granted_*`,
        not from the audit log: audit rows are pruned after `audit.retentionDays`,
        so "why is this person an administrator" would become unanswerable. A null
        author reads as "created by the system" — an empty cell would look like
        missing data rather than a deliberate answer.
      */}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--muted)]">{tt('admin.users.grantedBy')}</dt>
          <dd className="mono truncate">
            {user.roleGrantedBy
              ? user.roleGrantedBy.label
              : tt('admin.users.grantedBySystem')}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--muted)]">{tt('admin.users.grantedAt')}</dt>
          <dd className="mono">
            {user.roleGrantedAt ? absoluteTime(user.roleGrantedAt, locale) : '—'}
          </dd>
        </div>
      </dl>

      <ul className="mt-4 flex flex-wrap gap-1.5">
        {wildcard ? (
          <li>
            <Badge tone="purple">{tt('admin.roles.matrix')}: *</Badge>
          </li>
        ) : permissions.length === 0 ? (
          <li className="text-sm text-[var(--muted)]">{tt('common.none')}</li>
        ) : (
          permissions.map((permission) => (
            <li key={permission}>
              <Badge tone="accent">{permissionLabel(permission, locale)}</Badge>
            </li>
          ))
        )}
      </ul>

      <p className="mt-4 text-xs text-[var(--muted)]">{tt('admin.users.accessHint')}</p>
    </section>
  )
}
