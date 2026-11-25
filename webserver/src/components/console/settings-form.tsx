'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { compareVersions } from '@/lib/releases'

/**
 * Settings form.
 *
 * Only the whitelisted keys are submitted, and numeric inputs are coerced before
 * sending: the server validates ranges and answers a 422 with per-field details,
 * which this form renders inline under the offending control.
 */

/** `x.y.z` (1–4 numeric segments). Mirrors the server's semver comparison. */
const VERSION_PATTERN = /^\d+(\.\d+){0,3}$/

/**
 * Newest published client version, or `null` when nothing is published.
 *
 * `undefined` means "could not ask". A failed read is NOT treated as a conflict:
 * the server re-checks the rule on save, and refusing to save because a GET failed
 * would be worse than letting the authoritative answer arrive as a 422.
 */
async function fetchLatestClientVersion(): Promise<string | null | undefined> {
  try {
    const result = await api.get<{ release: { version: string } | null }>('/api/v1/releases/latest')
    return result.release?.version ?? null
  } catch {
    return undefined
  }
}

/** Message to show under the field, or `null` when the value is acceptable. */
async function gateConflict(minVersion: string, locale: Locale): Promise<string | null> {
  const tt = translator(locale)
  const latest = await fetchLatestClientVersion()
  if (latest === undefined) return null
  if (latest === null) return tt('admin.settings.minVersion.unpublished')
  const comparison = compareVersions(minVersion, latest)
  return comparison !== null && comparison > 0
    ? tt('admin.releases.latestHint', { version: latest })
    : null
}

export interface MailCapabilitiesView {
  mode: 'smtp' | 'outbox'
  fromAddress: string
  configured: boolean
  sent24h: number
  failed24h: number
}

export function SettingsForm({
  locale,
  settings,
  canWrite,
  mail,
}: {
  locale: Locale
  settings: Record<string, boolean | number | string>
  canWrite: boolean
  mail: MailCapabilitiesView
}) {
  const mailConfigured = mail.configured
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
    setErrors({})

    // The minimum-version field is the one setting that can lock every desktop
    // user out, so it is checked here as well as on the server: the server only
    // validates the shape, and a shape error costs a round trip.
    const minVersion = String(form['client.minVersion'] ?? '').trim()
    if (minVersion !== '' && !VERSION_PATTERN.test(minVersion)) {
      setErrors({ 'client.minVersion': tt('admin.settings.minVersion.invalid') })
      return
    }
    // R11: the gate may not exceed the newest build that is actually published, and
    // may not be armed at all when nothing is published — either combination locks
    // every desktop out with nothing to download. The server enforces the same
    // rule; checking here turns it into a sentence instead of a round trip.
    const gateIssue = minVersion === '' ? null : await gateConflict(minVersion, locale)
    if (gateIssue) {
      setErrors({ 'client.minVersion': gateIssue })
      return
    }

    setSaving(true)
    try {
      await api.patch('/api/v1/admin/settings', {
        'registration.enabled': Boolean(form['registration.enabled']),
        'invite.required': Boolean(form['invite.required']),
        'security.loginMaxAttempts': Number(form['security.loginMaxAttempts']),
        'security.loginLockMinutes': Number(form['security.loginLockMinutes']),
        'security.maxActiveSessions': Number(form['security.maxActiveSessions']),
        'session.webTtlHours': Number(form['session.webTtlHours']),
        'session.desktopRefreshDays': Number(form['session.desktopRefreshDays']),
        'client.minVersion': minVersion,
        'app.maintenanceMessage': String(form['app.maintenanceMessage'] ?? ''),
        'branding.appName': String(form['branding.appName'] ?? ''),
        'branding.supportEmail': String(form['branding.supportEmail'] ?? ''),
        // The mail/account policy group (migration 0005). `mail.verificationRequired`
        // is only sent while SMTP is configured — the server refuses it otherwise.
        ...(mailConfigured ? { 'mail.verificationRequired': Boolean(form['mail.verificationRequired']) } : {}),
        'mail.verificationTtlHours': Number(form['mail.verificationTtlHours']),
        'mail.emailChangeTtlHours': Number(form['mail.emailChangeTtlHours']),
        'mail.notifyNewDevice': Boolean(form['mail.notifyNewDevice']),
        'mail.notifyPasswordChange': Boolean(form['mail.notifyPasswordChange']),
        'account.deletionGraceHours': Number(form['account.deletionGraceHours']),
        'account.exportCooldownMinutes': Number(form['account.exportCooldownMinutes']),
        'audit.retentionDays': Number(form['audit.retentionDays']),
      })
      toast.success(tt('admin.settings.saved'))
      // R8: setting the floor above the shipped version blocks every older
      // client. Say so next to the confirmation, not in a wiki page.
      if (minVersion !== '') toast.warning(tt('admin.settings.minVersion.risk'))
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
          <Field
            label={tt('admin.settings.maxActiveSessions')}
            htmlFor="security.maxActiveSessions"
            error={errors['security.maxActiveSessions']}
            hint={tt('admin.settings.maxActiveSessions.hint')}
          >
            <Input
              id="security.maxActiveSessions"
              type="number"
              min={1}
              max={50}
              value={Number(form['security.maxActiveSessions'])}
              onChange={(event) => set('security.maxActiveSessions', Number(event.target.value))}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset
        disabled={!canWrite}
        className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <legend className="px-1 text-xs uppercase tracking-wider text-[var(--muted)]">
          {tt('admin.settings.desktopGate')}
        </legend>
        <Field
          label={tt('admin.settings.minVersion')}
          htmlFor="client.minVersion"
          error={errors['client.minVersion']}
          hint={tt('admin.settings.minVersion.hint')}
        >
          <Input
            id="client.minVersion"
            inputMode="numeric"
            placeholder="1.0.0"
            value={String(form['client.minVersion'] ?? '')}
            onChange={(event) => set('client.minVersion', event.target.value)}
            className="mono"
          />
        </Field>
        <Field
          label={tt('admin.settings.maintenance')}
          htmlFor="app.maintenanceMessage"
          error={errors['app.maintenanceMessage']}
          hint={tt('admin.settings.maintenance.hint')}
        >
          <Textarea
            id="app.maintenanceMessage"
            maxLength={200}
            rows={3}
            value={String(form['app.maintenanceMessage'] ?? '')}
            onChange={(event) => set('app.maintenanceMessage', event.target.value)}
          />
        </Field>
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

      <fieldset
        disabled={!canWrite}
        className="flex flex-col gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] p-5"
      >
        <legend className="px-1 text-xs uppercase tracking-wider text-[var(--muted)]">
          {tt('admin.settings.mail.group')}
        </legend>
        {!mailConfigured && (
          <p className="rounded-sm border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-3 py-2 text-xs text-[var(--warning)]">
            {tt('admin.settings.mail.readOnlyNoSmtp')}
          </p>
        )}
        <div className="rounded-sm border border-[var(--border)] px-3 py-2 text-2xs text-[var(--muted)]">
          <span className="text-[var(--foreground)]">{tt('admin.settings.mail.capabilities')}: </span>
          {mail.mode === 'smtp' ? tt('admin.mail.modeSmtp') : tt('admin.mail.modeOutbox')} ·{' '}
          <span className="mono">{mail.fromAddress}</span> · {tt('admin.mail.sent24h')}{' '}
          {mail.sent24h} / {tt('admin.mail.failed24h')} {mail.failed24h}
        </div>
        <Checkbox
          id="mail.verificationRequired"
          label={tt('admin.settings.mail.verificationRequired')}
          // Without SMTP the server clamps this to false on read AND refuses to
          // store true, so the control is disabled rather than lying.
          disabled={!mailConfigured}
          checked={Boolean(form['mail.verificationRequired']) && mailConfigured}
          onChange={(event) => set('mail.verificationRequired', event.target.checked)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={tt('admin.settings.mail.verificationTtl')}
            htmlFor="mail.verificationTtlHours"
            error={errors['mail.verificationTtlHours']}
            hint="1 – 168"
          >
            <Input
              id="mail.verificationTtlHours"
              type="number"
              min={1}
              max={168}
              value={Number(form['mail.verificationTtlHours'])}
              onChange={(event) => set('mail.verificationTtlHours', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.mail.emailChangeTtl')}
            htmlFor="mail.emailChangeTtlHours"
            error={errors['mail.emailChangeTtlHours']}
            hint="1 – 72"
          >
            <Input
              id="mail.emailChangeTtlHours"
              type="number"
              min={1}
              max={72}
              value={Number(form['mail.emailChangeTtlHours'])}
              onChange={(event) => set('mail.emailChangeTtlHours', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.mail.deletionGrace')}
            htmlFor="account.deletionGraceHours"
            error={errors['account.deletionGraceHours']}
            hint="1 – 720"
          >
            <Input
              id="account.deletionGraceHours"
              type="number"
              min={1}
              max={720}
              value={Number(form['account.deletionGraceHours'])}
              onChange={(event) => set('account.deletionGraceHours', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.mail.exportCooldown')}
            htmlFor="account.exportCooldownMinutes"
            error={errors['account.exportCooldownMinutes']}
            hint="1 – 1440"
          >
            <Input
              id="account.exportCooldownMinutes"
              type="number"
              min={1}
              max={1440}
              value={Number(form['account.exportCooldownMinutes'])}
              onChange={(event) => set('account.exportCooldownMinutes', Number(event.target.value))}
            />
          </Field>
          <Field
            label={tt('admin.settings.mail.retentionDays')}
            htmlFor="audit.retentionDays"
            error={errors['audit.retentionDays']}
            hint="30 – 3650"
          >
            <Input
              id="audit.retentionDays"
              type="number"
              min={30}
              max={3650}
              value={Number(form['audit.retentionDays'])}
              onChange={(event) => set('audit.retentionDays', Number(event.target.value))}
            />
          </Field>
        </div>
        <Checkbox
          id="mail.notifyNewDevice"
          label={tt('admin.settings.mail.notifyNewDevice')}
          checked={Boolean(form['mail.notifyNewDevice'])}
          onChange={(event) => set('mail.notifyNewDevice', event.target.checked)}
        />
        <Checkbox
          id="mail.notifyPasswordChange"
          label={tt('admin.settings.mail.notifyPasswordChange')}
          checked={Boolean(form['mail.notifyPasswordChange'])}
          onChange={(event) => set('mail.notifyPasswordChange', event.target.checked)}
        />
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
