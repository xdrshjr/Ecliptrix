'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { ConfirmDialog } from '@/components/console/confirm-dialog'
import { ApiError } from '@/lib/api/client'
import { usersApi, type RoleOption } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Create/edit a user.
 *
 * `UserFormDialog` and `DeleteUserDialog` live together because they are the two
 * halves of one workflow — the list, the detail page and the bulk bar all open
 * them, and a second copy of either is how the delete confirmation ends up
 * missing on one of the three surfaces.
 */

/**
 * The fields this dialog edits.
 *
 * Narrower than the wire DTO on purpose: the list page and the detail page carry
 * different amounts of the same user, and the form must not require a field it
 * never shows.
 */
export interface EditableUser {
  id: string
  email: string
  username: string
  displayName: string
  role: { id: string; key: string; name: string }
  status: string
  planTag: string
  note: string
}

export interface UserFormDialogProps {
  locale: Locale
  open: boolean
  roles: RoleOption[]
  user: EditableUser | null
  onClose: () => void
  onSaved: () => void
}

export function UserFormDialog({ locale, open, roles, user, onClose, onSaved }: UserFormDialogProps) {
  const tt = translator(locale)
  const [form, setForm] = useState({
    email: '',
    username: '',
    displayName: '',
    roleId: '',
    status: 'active',
    planTag: 'free',
    note: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [password, setPassword] = useState<string | null>(null)
  const [seededFor, setSeededFor] = useState<string | null>(null)

  // Re-seed the form whenever a different user is opened for editing.
  if (open && seededFor !== (user?.id ?? 'new')) {
    setSeededFor(user?.id ?? 'new')
    setForm({
      email: user?.email ?? '',
      username: user?.username ?? '',
      displayName: user?.displayName ?? '',
      roleId: user?.role.id ?? roles.find((role) => role.key === 'member')?.id ?? '',
      status: user?.status ?? 'active',
      planTag: user?.planTag ?? 'free',
      note: user?.note ?? '',
    })
    setErrors({})
    setPassword(null)
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      if (user) {
        await usersApi.update(user.id, {
          email: form.email.trim(),
          username: form.username.trim(),
          displayName: form.displayName.trim(),
          roleId: form.roleId || undefined,
          status: form.status,
          planTag: form.planTag,
          note: form.note,
        })
        toast.success(tt('admin.users.updated'))
        onSaved()
      } else {
        const result = await usersApi.create({
          email: form.email.trim(),
          username: form.username.trim(),
          displayName: form.displayName.trim() || undefined,
          roleId: form.roleId || undefined,
          status: form.status,
          planTag: form.planTag,
          note: form.note,
        })
        toast.success(tt('admin.users.created'))
        if (result.temporaryPassword) setPassword(result.temporaryPassword)
        else onSaved()
      }
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const fields = thrown.fieldErrors()
        setErrors(
          Object.keys(fields).length > 0 ? fields : { form: errorMessage(thrown.code, locale) },
        )
      } else {
        setErrors({ form: tt('errors.network') })
      }
    } finally {
      setSaving(false)
    }
  }

  if (password) {
    return (
      <Dialog
        open
        onClose={onSaved}
        title={tt('admin.users.created')}
        description={tt('admin.users.oncePasswordHint')}
        size="sm"
        footer={<Button onClick={onSaved}>{tt('common.close')}</Button>}
      >
        <code className="mono block rounded-sm border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          {password}
        </code>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={user ? tt('admin.users.edit') : tt('admin.users.new')}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tt('common.cancel')}
          </Button>
          <Button type="submit" form="user-form" loading={saving}>
            {tt('common.save')}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={tt('common.email')} htmlFor="user-email" required error={errors.email}>
          <Input
            id="user-email"
            type="email"
            required
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
            invalid={Boolean(errors.email)}
          />
        </Field>
        <Field label={tt('common.username')} htmlFor="user-username" required error={errors.username}>
          <Input
            id="user-username"
            required
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
            invalid={Boolean(errors.username)}
            className="mono"
          />
        </Field>
        <Field label={tt('account.profile.displayName')} htmlFor="user-display" error={errors.displayName}>
          <Input
            id="user-display"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tt('admin.users.role')} htmlFor="user-role">
            <Select
              id="user-role"
              value={form.roleId}
              onChange={(event) => setForm({ ...form, roleId: event.target.value })}
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tt('common.status')} htmlFor="user-status">
            <Select
              id="user-status"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="suspended">suspended</option>
              <option value="pending">pending</option>
            </Select>
          </Field>
        </div>
        <Field label={tt('admin.users.plan')} htmlFor="user-plan">
          <Select
            id="user-plan"
            value={form.planTag}
            onChange={(event) => setForm({ ...form, planTag: event.target.value })}
          >
            <option value="free">free</option>
            <option value="pro">pro</option>
            <option value="studio">studio</option>
          </Select>
        </Field>
        <Field label={tt('admin.users.note')} htmlFor="user-note" error={errors.note}>
          <Input
            id="user-note"
            value={form.note}
            onChange={(event) => setForm({ ...form, note: event.target.value })}
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

export interface DeleteUserDialogProps {
  locale: Locale
  user: { id: string; username: string } | null
  onClose: () => void
  onDeleted: () => void
}

/** Delete confirmation — typing the username is the second factor. */
export function DeleteUserDialog({ locale, user, onClose, onDeleted }: DeleteUserDialogProps) {
  const tt = translator(locale)
  const [busy, setBusy] = useState(false)

  if (!user) return null

  const submit = async () => {
    setBusy(true)
    try {
      await usersApi.remove(user.id)
      toast.success(tt('admin.users.deleted'))
      onDeleted()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      locale={locale}
      open
      title={tt('admin.users.deleteConfirmTitle')}
      description={tt('admin.users.deleteConfirmDesc', { username: user.username })}
      requireTypedValue={user.username}
      typedValueLabel={tt('common.username')}
      busy={busy}
      onConfirm={submit}
      onClose={onClose}
    />
  )
}
