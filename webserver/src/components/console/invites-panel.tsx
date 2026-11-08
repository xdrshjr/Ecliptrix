'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { RelativeTime } from '@/components/shell/relative-time'

/**
 * Invite panel.
 *
 * The plaintext code appears exactly once — in the creation dialog. After that the
 * list only shows the last four characters, because the server stores only a hash
 * and genuinely cannot show it again.
 */
export interface InviteDto {
  id: string
  codeHint: string
  roleKey: string
  roleName: string
  createdByLabel: string
  maxUses: number
  usedCount: number
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  state: string
}

const STATE_TONES: Record<string, 'accent' | 'warning' | 'danger' | 'neutral'> = {
  active: 'accent',
  exhausted: 'warning',
  expired: 'neutral',
  revoked: 'danger',
}

export function InvitesPanel({
  locale,
  invites,
  roles,
  canWrite,
}: {
  locale: Locale
  invites: InviteDto[]
  roles: { key: string; name: string }[]
  canWrite: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [createdCode, setCreatedCode] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)

  const revoke = async (id: string) => {
    setRevoking(id)
    try {
      await api.delete(`/api/v1/admin/invites/${id}`)
      toast.success(tt('common.confirm'))
      router.refresh()
    } catch (thrown) {
      toast.error(thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'))
    } finally {
      setRevoking(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex justify-end">
          <Button icon={<Plus size={14} />} onClick={() => setCreateOpen(true)}>
            {tt('admin.invites.new')}
          </Button>
        </div>
      ) : null}

      {createdCode ? (
        <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4">
          <p className="text-xs text-[var(--accent)]">{tt('admin.invites.once')}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono flex-1 rounded-sm border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm">
              {createdCode}
            </code>
            <Button
              variant="secondary"
              size="sm"
              icon={<Copy size={13} />}
              onClick={() => {
                void navigator.clipboard.writeText(createdCode)
                toast.success(tt('common.copied'))
              }}
            >
              {tt('common.copy')}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {[
                tt('admin.invites.code'),
                tt('admin.users.role'),
                tt('admin.invites.uses'),
                tt('admin.invites.expires'),
                tt('admin.invites.state'),
                tt('common.actions'),
              ].map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={`px-3 py-2.5 text-xs font-medium text-[var(--muted)] ${
                    index === 5 ? 'text-right' : 'text-left'
                  }`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invites.map((invite) => (
              <tr key={invite.id} className="border-b border-[var(--border)] last:border-0">
                <td className="mono px-3 py-2.5 text-xs">••••-{invite.codeHint}</td>
                <td className="px-3 py-2.5">{invite.roleName || invite.roleKey}</td>
                <td className="mono px-3 py-2.5 text-xs">
                  {invite.usedCount} / {invite.maxUses}
                </td>
                <td className="px-3 py-2.5 text-xs text-[var(--muted)]">
                  <RelativeTime iso={invite.expiresAt} locale={locale} />
                </td>
                <td className="px-3 py-2.5">
                  <Badge tone={STATE_TONES[invite.state] ?? 'neutral'}>{tt(`admin.invites.state.${invite.state}`)}</Badge>
                </td>
                <td className="px-3 py-2.5 text-right">
                  {canWrite && invite.state === 'active' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={revoking === invite.id}
                      onClick={() => revoke(invite.id)}
                      icon={<Trash2 size={13} />}
                    >
                      {tt('admin.invites.revoke')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {invites.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-sm text-[var(--muted)]">
                  {tt('common.none')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <CreateInviteDialog
        locale={locale}
        roles={roles}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(code) => {
          setCreateOpen(false)
          setCreatedCode(code)
          router.refresh()
        }}
      />
    </div>
  )
}

function CreateInviteDialog({
  locale,
  roles,
  open,
  onClose,
  onCreated,
}: {
  locale: Locale
  roles: { key: string; name: string }[]
  open: boolean
  onClose: () => void
  onCreated: (code: string) => void
}) {
  const tt = translator(locale)
  const [form, setForm] = useState({
    maxUses: 1,
    expiresInDays: 14,
    roleKey: 'member',
    email: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      // `email` is what makes the invitation mail reachable at all: without it the
      // create dialog could only ever hand the operator a code to paste into a chat
      // window, and the mail template + its budget were API-only.
      const result = await api.post<{ invite: { code: string } }>('/api/v1/admin/invites', {
        maxUses: Number(form.maxUses),
        expiresInDays: Number(form.expiresInDays),
        roleKey: form.roleKey,
        email: form.email.trim() || undefined,
      })
      onCreated(result.invite.code)
    } catch (thrown) {
      setError(thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tt('admin.invites.new')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tt('common.cancel')}
          </Button>
          <Button type="submit" form="invite-form" loading={saving}>
            {tt('common.save')}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label={tt('admin.users.role')} htmlFor="invite-role">
          <Select
            id="invite-role"
            value={form.roleKey}
            onChange={(event) => setForm({ ...form, roleKey: event.target.value })}
          >
            {roles.map((role) => (
              <option key={role.key} value={role.key}>
                {role.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={tt('admin.invites.uses')} htmlFor="invite-uses">
          <Input
            id="invite-uses"
            type="number"
            min={1}
            max={1000}
            value={form.maxUses}
            onChange={(event) => setForm({ ...form, maxUses: Number(event.target.value) })}
          />
        </Field>
        <Field label={tt('admin.invites.email')} htmlFor="invite-email">
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
        </Field>
        <Field
          label={tt('admin.invites.expires')}
          htmlFor="invite-days"
          hint={tt('admin.invites.neverExpires')}
        >
          <Input
            id="invite-days"
            type="number"
            min={0}
            max={365}
            value={form.expiresInDays}
            onChange={(event) => setForm({ ...form, expiresInDays: Number(event.target.value) })}
          />
        </Field>
        {error ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  )
}
