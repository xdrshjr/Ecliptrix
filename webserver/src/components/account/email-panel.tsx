'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BadgeCheck, MailWarning } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { ApiError } from '@/lib/api/client'
import { meApi, type MeProfileDto } from '@/lib/api/endpoints'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Email row of the account centre.
 *
 * Three states, three affordances:
 *  - verified: a badge and nothing else — the address is not editable here;
 *  - unverified with mail available: "resend" (the same endpoint the desktop uses);
 *  - a change in flight: the masked pending address plus a cancel button.
 *
 * The address itself is never editable in place. Changing it needs two
 * confirmations (new address + notice to the old one), and that flow lives behind
 * this dialog rather than behind an input the user can type into by accident.
 */
export function EmailPanel({
  locale,
  profile,
  mailEnabled,
}: {
  locale: Locale
  profile: MeProfileDto
  mailEnabled: boolean
}) {
  const tt = translator(locale)
  const router = useRouter()
  // The panel's state comes from the server, so a refresh is the honest update.
  const onChanged = () => router.refresh()
  const [changeOpen, setChangeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const resend = async () => {
    setResending(true)
    try {
      await meApi.resendVerification()
      toast.success(tt('verify.resent'))
    } catch (thrown) {
      toast.error(
        thrown instanceof ApiError ? errorMessage(thrown.code, locale) : tt('errors.network'),
      )
    } finally {
      setResending(false)
    }
  }

  const submitChange = async () => {
    setBusy(true)
    setErrors({})
    try {
      await meApi.requestEmailChange({ password, newEmail })
      toast.success(tt('account.email.pending', { email: newEmail }))
      setChangeOpen(false)
      setNewEmail('')
      setPassword('')
      onChanged()
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const fields = thrown.fieldErrors()
        setErrors(Object.keys(fields).length > 0 ? fields : { form: errorMessage(thrown.code, locale) })
      } else {
        setErrors({ form: tt('errors.network') })
      }
    } finally {
      setBusy(false)
    }
  }

  const cancelChange = async () => {
    setBusy(true)
    try {
      await meApi.cancelEmailChange()
      toast.success(tt('account.email.cancelled'))
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
    <section aria-labelledby="email-heading" className="mt-6 rounded-md border border-[var(--border)] p-5">
      <h2 id="email-heading" className="text-sm font-medium">
        {tt('account.email.label')}
      </h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{profile.email}</span>
        {profile.emailVerified ? (
          <Badge tone="accent">
            <BadgeCheck size={12} className="mr-1" /> {tt('account.email.verified')}
          </Badge>
        ) : (
          <Badge tone="warning">
            <MailWarning size={12} className="mr-1" /> {tt('account.email.unverified')}
          </Badge>
        )}
      </div>

      {profile.pendingEmail && (
        <p className="mt-3 rounded-sm border border-[var(--warn)]/35 bg-[var(--warn)]/5 px-3 py-2 text-xs">
          {tt('account.email.pending', { email: profile.pendingEmail })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!profile.emailVerified && mailEnabled && (
          <Button size="sm" variant="secondary" loading={resending} onClick={() => void resend()}>
            {tt('verify.resend')}
          </Button>
        )}
        {profile.pendingEmail ? (
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void cancelChange()}>
            {tt('account.email.cancel')}
          </Button>
        ) : (
          mailEnabled && (
            <Button size="sm" variant="secondary" onClick={() => setChangeOpen(true)}>
              {tt('account.email.changeTitle')}
            </Button>
          )
        )}
      </div>

      {!mailEnabled && (
        <p className="mt-3 text-xs text-[var(--muted)]">{tt('account.email.managedByAdmin')}</p>
      )}

      <Dialog
        open={changeOpen}
        onClose={() => setChangeOpen(false)}
        title={tt('account.email.changeTitle')}
        description={tt('account.email.changeHint')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setChangeOpen(false)}>
              {tt('common.cancel')}
            </Button>
            <Button loading={busy} onClick={() => void submitChange()}>
              {tt('account.email.submit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {errors.form && (
            <p className="text-xs text-[var(--danger)]" role="alert">
              {errors.form}
            </p>
          )}
          <Field label={tt('account.email.newEmail')} htmlFor="newEmail" required error={errors.newEmail}>
            <Input
              id="newEmail"
              type="email"
              autoComplete="email"
              value={newEmail}
              onChange={(event) => setNewEmail(event.target.value)}
              invalid={Boolean(errors.newEmail)}
            />
          </Field>
          <Field
            label={tt('account.email.password')}
            htmlFor="changeEmailPassword"
            required
            error={errors.password}
          >
            <Input
              id="changeEmailPassword"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              invalid={Boolean(errors.password)}
            />
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
