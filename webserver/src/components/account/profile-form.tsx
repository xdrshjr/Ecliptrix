'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/field'
import { Badge } from '@/components/ui/badge'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/** Own-profile editor. Only the four presentation fields are submitted. */
export interface ProfileFormProps {
  locale: Locale
  initial: { displayName: string; avatarUrl: string; locale: string; timezone: string }
  email: string
  username: string
  roleName: string
  planTag: string
}

export function ProfileForm({ locale, initial, email, username, roleName, planTag }: ProfileFormProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await api.patch('/api/v1/me', {
        displayName: form.displayName.trim(),
        avatarUrl: form.avatarUrl.trim() || null,
        locale: form.locale,
        timezone: form.timezone,
      })
      // `users.locale` is a record of the choice; the cookie is what the server
      // actually renders with (`resolveLocale` reads `ecs_lang` first). Without
      // this call the dropdown saved and changed nothing on screen.
      if (form.locale !== locale) {
        await api.post('/api/v1/locale', { locale: form.locale })
      }
      toast.success(tt('account.profile.saved'))
      router.refresh()
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
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5 sm:grid-cols-2">
        <Field label={tt('account.profile.email')} htmlFor="email">
          <Input id="email" value={email} readOnly disabled className="mono" />
        </Field>
        <Field label={tt('common.username')} htmlFor="username">
          <Input id="username" value={username} readOnly disabled className="mono" />
        </Field>
        <Field label={tt('common.name')} htmlFor="roleName">
          <Input id="roleName" value={roleName} readOnly disabled />
        </Field>
        <Field label={tt('admin.users.plan')} htmlFor="planTag">
          <Input id="planTag" value={planTag} readOnly disabled />
        </Field>
      </div>

      <div className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5">
        <Field
          label={tt('account.profile.displayName')}
          htmlFor="displayName"
          required
          error={errors.displayName}
        >
          <Input
            id="displayName"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            invalid={Boolean(errors.displayName)}
          />
        </Field>

        <Field
          label={tt('account.profile.avatar')}
          htmlFor="avatarUrl"
          hint="https://…（留空表示使用默认头像）"
          error={errors.avatarUrl}
        >
          <Input
            id="avatarUrl"
            value={form.avatarUrl}
            onChange={(event) => setForm({ ...form, avatarUrl: event.target.value })}
            invalid={Boolean(errors.avatarUrl)}
            className="mono"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={tt('account.profile.locale')} htmlFor="locale">
            <Select
              id="locale"
              value={form.locale}
              onChange={(event) => setForm({ ...form, locale: event.target.value })}
            >
              <option value="zh-CN">简体中文</option>
              <option value="en-US">English</option>
            </Select>
          </Field>
          <Field label={tt('account.profile.timezone')} htmlFor="timezone">
            <Input
              id="timezone"
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              className="mono"
            />
          </Field>
        </div>
      </div>

      {errors.form ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {errors.form}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <Badge tone="neutral">ID: <span className="mono">{username}</span></Badge>
        <Button type="submit" loading={saving}>
          {tt('common.save')}
        </Button>
      </div>
    </form>
  )
}
