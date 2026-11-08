'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useMemo, useState } from 'react'
import { Check, Lock, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { groupedPermissions } from '@/lib/permissionsCatalog'

/**
 * Permission matrix.
 *
 * One column per role, one row per permission. The owner column is shown but not
 * editable: its set is generated as `*` on the server, and pretending otherwise in
 * the UI would invite a support ticket ("I unchecked it and nothing happened").
 */
export interface MatrixRole {
  id: string
  key: string
  name: string
  description: string
  isSystem: boolean
  permissions: string[]
  userCount: number
}

export function PermissionMatrix({
  locale,
  roles,
  permissions,
  canWrite,
}: {
  locale: Locale
  roles: MatrixRole[]
  permissions: string[]
  canWrite: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  const [draft, setDraft] = useState<Record<string, string[]>>({})
  const [savingRole, setSavingRole] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const groups = useMemo(() => {
    // Groups, order and labels come from the shared catalogue; the server list is
    // only used to append a permission this build does not know yet.
    return groupedPermissions(locale, permissions).map((group) => ({
      key: group.key,
      label: group.label,
      permissions: group.permissions,
    }))
  }, [locale, permissions])

  const current = (role: MatrixRole): string[] => draft[role.id] ?? role.permissions

  const toggle = (role: MatrixRole, permission: string) => {
    if (role.key === 'owner' || !canWrite) return
    const set = new Set(current(role))
    if (set.has(permission)) set.delete(permission)
    else set.add(permission)
    setDraft((previous) => ({ ...previous, [role.id]: [...set] }))
  }

  const save = async (role: MatrixRole) => {
    setSavingRole(role.id)
    try {
      await api.put(`/api/v1/admin/roles/${role.id}/permissions`, { permissions: current(role) })
      toast.success(tt('admin.roles.saved'))
      setDraft((previous) => {
        const next = { ...previous }
        delete next[role.id]
        return next
      })
      router.refresh()
    } catch (thrown) {
      toast.error(thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'))
    } finally {
      setSavingRole(null)
    }
  }

  const isDirty = (role: MatrixRole): boolean => {
    const next = draft[role.id]
    if (!next) return false
    const before = [...role.permissions].sort().join(',')
    return [...next].sort().join(',') !== before
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            {tt('admin.roles.new')}
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th scope="col" className="sticky left-0 bg-[var(--surface)] px-4 py-3 text-left text-xs font-medium text-[var(--muted)]">
                {tt('admin.roles.matrix')}
              </th>
              {roles.map((role) => (
                <th key={role.id} scope="col" className="min-w-[140px] px-3 py-3 text-left align-top">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {role.name}
                    {role.key === 'owner' ? <Lock size={11} className="text-[var(--muted)]" /> : null}
                  </p>
                  <p className="mono mt-0.5 text-2xs text-[var(--muted)]">{role.key}</p>
                  <p className="mt-1 text-2xs text-[var(--muted)]">
                    {tt('admin.roles.users')}: {role.userCount}
                  </p>
                  {isDirty(role) ? (
                    <Button
                      size="sm"
                      className="mt-2"
                      loading={savingRole === role.id}
                      onClick={() => save(role)}
                    >
                      {tt('common.save')}
                    </Button>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                <tr className="bg-[var(--surface-2)]">
                  <th
                    scope="colgroup"
                    colSpan={roles.length + 1}
                    className="sticky left-0 px-4 py-1.5 text-left text-2xs font-medium uppercase tracking-wider text-[var(--muted)]"
                  >
                    {group.label}
                  </th>
                </tr>
                {group.permissions.map((permission) => (
                  <tr key={permission.key} className="border-b border-[var(--border)] last:border-0">
                    <th scope="row" className="sticky left-0 bg-[var(--surface)] px-4 py-2 text-left font-normal">
                      <span className="text-sm">{permission.label}</span>
                      <span className="mono ml-2 text-2xs text-[var(--muted)]">{permission.key}</span>
                    </th>
                    {roles.map((role) => {
                      const held = role.key === 'owner' || current(role).includes(permission.key)
                      const locked = role.key === 'owner' || !canWrite
                      return (
                        <td key={role.id} className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => toggle(role, permission.key)}
                            disabled={locked}
                            aria-pressed={held}
                            aria-label={`${role.name} · ${permission.key}`}
                            className={cn(
                              'flex h-5 w-5 items-center justify-center rounded-sm border transition-colors',
                              held
                                ? 'border-[var(--accent)]/50 bg-[var(--accent)]/15 text-[var(--accent)]'
                                : 'border-[var(--border)] text-transparent',
                              locked ? 'cursor-not-allowed opacity-70' : 'hover:border-[var(--border-strong)]',
                            )}
                          >
                            <Check size={12} />
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--muted)]">
        <Badge tone="accent">即时生效</Badge>{' '}
        权限变更对目标用户的下一次请求生效，无需重新登录。
      </p>

      <CreateRoleDialog
        locale={locale}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false)
          router.refresh()
        }}
      />
    </div>
  )
}

function CreateRoleDialog({
  locale,
  open,
  onClose,
  onCreated,
}: {
  locale: Locale
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const tt = translator(locale)
  const [form, setForm] = useState({ key: '', name: '', description: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await api.post('/api/v1/admin/roles', {
        key: form.key.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
      })
      toast.success(tt('admin.roles.new'))
      setForm({ key: '', name: '', description: '' })
      onCreated()
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const fields = thrown.fieldErrors()
        setErrors(Object.keys(fields).length > 0 ? fields : { form: errorMessage(thrown.code, locale) })
      } else {
        setErrors({ form: tt('errors.network') })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tt('admin.roles.new')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tt('common.cancel')}
          </Button>
          <Button type="submit" form="role-form" loading={saving}>
            {tt('common.save')}
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="key" htmlFor="role-key" required error={errors.key} hint="小写字母、数字、下划线">
          <Input
            id="role-key"
            required
            value={form.key}
            onChange={(event) => setForm({ ...form, key: event.target.value })}
            invalid={Boolean(errors.key)}
            className="mono"
          />
        </Field>
        <Field label={tt('common.name')} htmlFor="role-name" required error={errors.name}>
          <Input
            id="role-name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            invalid={Boolean(errors.name)}
          />
        </Field>
        <Field label="description" htmlFor="role-desc" error={errors.description}>
          <Input
            id="role-desc"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </Field>
        {errors.form ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {errors.form}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
