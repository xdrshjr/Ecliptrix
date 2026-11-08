'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { ApiError } from '@/lib/api/client'
import { meApi, type MeProfileDto } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Danger zone.
 *
 * Since migration 0005 this is a real state machine, not an intent note, so the
 * copy has to be honest about the three phases:
 *  - nothing pending: ask, then require the password;
 *  - `awaiting_confirmation`: mail is out, the account is untouched, remind them;
 *  - `scheduled`: a date is shown, and cancel is the primary button — a user who
 *    changed their mind must not have to hunt for it.
 *
 * The password field is not decoration: without it, a stolen session would be
 * enough to destroy an account, and the grace period would be the only defence.
 */
export function DangerZone({
  locale,
  profile,
  graceHours,
  mailEnabled,
}: {
  locale: Locale
  profile: MeProfileDto
  graceHours: number
  mailEnabled: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  const onChanged = () => router.refresh()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState('')

  const deletion = profile.deletion

  const submit = async () => {
    setBusy(true)
    setFormError('')
    try {
      const result = await meApi.requestDeletion({ password, reason: reason || undefined })
      toast.success(
        result.requiresConfirmation
          ? tt('account.danger.awaitingConfirmation')
          : tt('account.danger.requestedKept'),
      )
      setOpen(false)
      setPassword('')
      setReason('')
      onChanged()
    } catch (thrown) {
      setFormError(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      await meApi.cancelDeletion()
      toast.success(tt('account.danger.cancelDone'))
      onChanged()
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="danger-heading"
      className="mt-6 rounded-md border border-[var(--danger)]/35 bg-[var(--danger)]/5 p-5"
    >
      <h2 id="danger-heading" className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={14} className="text-[var(--danger)]" />
        {tt('account.danger.title')}
      </h2>

      {deletion ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-[var(--danger)]">
            {deletion.status === 'scheduled'
              ? tt('account.danger.scheduledFor', {
                  date: deletion.scheduledFor
                    ? new Date(deletion.scheduledFor).toLocaleString(locale)
                    : '—',
                })
              : tt('account.danger.awaitingConfirmation')}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {tt('account.danger.graceNotice', { hours: graceHours })}
          </p>
          <div>
            <Button variant="secondary" size="sm" loading={busy} onClick={() => void cancel()}>
              {tt('account.danger.cancelRequest')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-2 text-xs text-[var(--muted)]">{tt('account.danger.requestRealDesc')}</p>
          <div className="mt-3">
            <Button variant="danger" size="sm" onClick={() => setOpen(true)}>
              {tt('account.danger.delete')}
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={tt('account.danger.requestRealTitle')}
        description={tt('account.danger.requestRealDesc')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {tt('common.cancel')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void submit()}>
              {tt('account.danger.confirm')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {formError && (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {formError}
            </p>
          )}
          <p className="text-xs text-[var(--muted)]">
            {tt('account.danger.graceNotice', { hours: graceHours })}
          </p>
          {!mailEnabled && (
            <p className="text-2xs text-[var(--muted)]">{tt('account.email.mailDisabled')}</p>
          )}
          <Field
            label={tt('account.danger.confirmPassword')}
            htmlFor="deletionPassword"
            required
          >
            <Input
              id="deletionPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Field label={tt('account.danger.reason')} htmlFor="deletionReason">
            <Input
              id="deletionReason"
              value={reason}
              maxLength={200}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
