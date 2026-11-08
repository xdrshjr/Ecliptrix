'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Settings form.
 *
 * Only the whitelisted keys are submitted, and numeric inputs are coerced before
 * sending: the server validates ranges and answers a 422 with per-field details,
 * which this form renders inline under the offending control.
 */
export function SettingsForm({
  locale,
  settings,
  canWrite,
}: {
  locale: Locale
  settings: Record<string, boolean | number | string>
  canWrite: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  const [form, setForm] = useState(settings)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const set = (key: string, value: boolean | number | string) => {
    setForm((previous) => ({ ...previous, [key]: value }))
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await api.patch('/api/v1/admin/settings', {
        'registration.enabled': Boolean(form['registration.enabled']),
        'invite.required': Boolean(form['invite.required']),
        'security.loginMaxAttempts': Number(form['security.loginMaxAttempts']),
        'security.loginLockMinutes': Number(form['security.loginLockMinutes']),
        'session.webTtlHours': Number(form['session.webTtlHours']),
        'session.desktopRefreshDays': Number(form['session.desktopRefreshDays']),
        'branding.appName': String(form['branding.appName'] ?? ''),
        'branding.supportEmail': String(form['branding.supportEmail'] ?? ''),
      })
      toast.success(tt('admin.settings.saved'))
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
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <fieldset
        disabled={!canWrite}
        className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <legend className="px-1 text-xs uppercase tracking-wider text-[var(--muted)]">
          {tt('auth.register.title')}
        </legend>
        <Checkbox
          id="registration.enabled"
          label={tt('admin.settings.registration')}
          checked={Boolean(form['registration.enabled'])}
          onChange={(event) => set('registration.enabled', event.target.checked)}
        />
        <Checkbox
          id="invite.required"
          label={tt('admin.settings.invite')}
          checked={Boolean(form['invite.required'])}
          onChange={(event) => set('invite.required', event.target.checked)}
        />
      </fieldset>

      <fieldset
        disabled={!canWrite}
        className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <legend className="px-1 text-xs uppercase tracking-wider text-[var(--muted)]">
          {tt('account.security')}
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tt('admin.settings.maxAttempts')}
            htmlFor="security.loginMaxAttempts"
            error={errors['security.loginMaxAttempts']}
            hint="3 – 20"
          >
            <Input
              id="security.loginMaxAttempts"
              type="number"
              min={3}
              max={20}
              value={Number(form['security.loginMaxAttempts'])}
              onChange={(event) => set('security.loginMaxAttempts', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.lockMinutes')}
            htmlFor="security.loginLockMinutes"
            error={errors['security.loginLockMinutes']}
            hint="1 – 1440"
          >
            <Input
              id="security.loginLockMinutes"
              type="number"
              min={1}
              max={1440}
              value={Number(form['security.loginLockMinutes'])}
              onChange={(event) => set('security.loginLockMinutes', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.webTtl')}
            htmlFor="session.webTtlHours"
            error={errors['session.webTtlHours']}
            hint="1 – 168"
          >
            <Input
              id="session.webTtlHours"
              type="number"
              min={1}
              max={168}
              value={Number(form['session.webTtlHours'])}
              onChange={(event) => set('session.webTtlHours', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.desktopRefresh')}
            htmlFor="session.desktopRefreshDays"
            error={errors['session.desktopRefreshDays']}
            hint="7 – 365"
          >
            <Input
              id="session.desktopRefreshDays"
              type="number"
              min={7}
              max={365}
              value={Number(form['session.desktopRefreshDays'])}
              onChange={(event) => set('session.desktopRefreshDays', Number(event.target.value))}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset
        disabled={!canWrite}
        className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <legend className="px-1 text-xs uppercase tracking-wider text-[var(--muted)]">
          {tt('brand.name')}
        </legend>
        <Field label={tt('admin.settings.appName')} htmlFor="branding.appName" error={errors['branding.appName']}>
          <Input
            id="branding.appName"
            value={String(form['branding.appName'] ?? '')}
            onChange={(event) => set('branding.appName', event.target.value)}
          />
        </Field>
        <Field
          label={tt('admin.settings.supportEmail')}
          htmlFor="branding.supportEmail"
          error={errors['branding.supportEmail']}
        >
          <Input
            id="branding.supportEmail"
            type="email"
            value={String(form['branding.supportEmail'] ?? '')}
            onChange={(event) => set('branding.supportEmail', event.target.value)}
            className="mono"
          />
        </Field>
      </fieldset>

      {errors.form ? (
        <p role="alert" className="text-xs text-[var(--danger)]">
          {errors.form}
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex justify-end">
          <Button type="submit" loading={saving}>
            {tt('common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
