'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox, Field, Input } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'
import { PasswordStrength } from '@/components/auth/password-strength'
import { isEmailShaped, isUsernameShaped, passwordLengthIssue } from '@/lib/validators'

/**
 * Registration form.
 *
 * Client validation is a convenience only: the server is the authority on the
 * password policy, the invite gate and uniqueness. The client never blocks submit
 * for a policy reason — it would drift from the server the first time the policy
 * is tuned.
 */
export interface RegisterFormProps {
  locale: Locale
  inviteRequired: boolean
}

export function RegisterForm({ locale, inviteRequired }: RegisterFormProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [form, setForm] = useState({
    email: '',
    username: '',
    displayName: '',
    password: '',
    passwordConfirm: '',
    inviteCode: '',
    accepted: false,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    setForm((previous) => ({ ...previous, [key]: value }))
    setErrors((previous) => ({ ...previous, [key]: '' }))
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors: Record<string, string> = {}
    if (!isEmailShaped(form.email)) {
      nextErrors.email = tt('auth.register.emailInvalid')
    }
    const username = form.username.trim()
    if (username && !isUsernameShaped(username)) {
      nextErrors.username = tt('auth.register.usernameInvalid')
    }
    if (passwordLengthIssue(form.password) === 'too_short') {
      nextErrors.password = tt('auth.register.passwordTooShort')
    }
    if (form.password !== form.passwordConfirm) {
      nextErrors.passwordConfirm = '两次输入的口令不一致'
    }
    if (!form.accepted) {
      nextErrors.accepted = tt('auth.register.terms')
    }
    if (inviteRequired && !form.inviteCode.trim()) {
      nextErrors.inviteCode = tt('auth.register.inviteHint')
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setLoading(true)
    try {
      await api.post('/api/v1/auth/register', {
        email: form.email.trim(),
        username: form.username.trim() || undefined,
        displayName: form.displayName.trim() || undefined,
        password: form.password,
        inviteCode: form.inviteCode.trim() || undefined,
        client: 'web',
      })
      toast.success(tt('auth.register.submit'))
      router.replace('/account')
      router.refresh()
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const fieldErrors = thrown.fieldErrors()
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors)
        else setErrors({ form: errorMessage(thrown.code, locale) })
      } else {
        setErrors({ form: tt('errors.network') })
      }
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label={tt('common.email')} htmlFor="email" required error={errors.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={form.email}
          onChange={update('email')}
          invalid={Boolean(errors.email)}
          placeholder="you@example.com"
        />
      </Field>

      <Field
        label={tt('auth.register.username')}
        htmlFor="username"
        hint={tt('auth.register.usernameInvalid')}
        error={errors.username}
      >
        <Input
          id="username"
          autoComplete="username"
          value={form.username}
          onChange={update('username')}
          invalid={Boolean(errors.username)}
          placeholder="ada"
        />
      </Field>

      <Field label={tt('auth.register.displayName')} htmlFor="displayName" error={errors.displayName}>
        <Input
          id="displayName"
          autoComplete="name"
          value={form.displayName}
          onChange={update('displayName')}
          invalid={Boolean(errors.displayName)}
          placeholder="Ada Lovelace"
        />
      </Field>

      <Field
        label={tt('common.password')}
        htmlFor="password"
        required
        error={errors.password}
        hint={errors.weak_password}
      >
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          value={form.password}
          onChange={update('password')}
          invalid={Boolean(errors.password)}
        />
        <PasswordStrength password={form.password} />
      </Field>

      <Field label={tt('auth.register.submit')} htmlFor="passwordConfirm" required error={errors.passwordConfirm}>
        <Input
          id="passwordConfirm"
          type="password"
          autoComplete="new-password"
          required
          value={form.passwordConfirm}
          onChange={update('passwordConfirm')}
          invalid={Boolean(errors.passwordConfirm)}
        />
      </Field>

      {inviteRequired ? (
        <Field
          label={tt('auth.register.invite')}
          htmlFor="inviteCode"
          required
          hint={tt('auth.register.inviteHint')}
          error={errors.inviteCode}
        >
          <Input
            id="inviteCode"
            value={form.inviteCode}
            onChange={update('inviteCode')}
            invalid={Boolean(errors.inviteCode)}
            placeholder="ECL-XXXX-XXXX-XXXX"
            className="mono"
          />
        </Field>
      ) : null}

      <div>
        <Checkbox
          id="accepted"
          label={tt('auth.register.terms')}
          checked={form.accepted}
          onChange={update('accepted')}
        />
        {errors.accepted ? (
          <p role="alert" className="mt-1 text-xs text-[var(--danger)]">
            {errors.accepted}
          </p>
        ) : null}
      </div>

      {errors.form ? (
        <p
          role="alert"
          className="rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]"
        >
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="mt-1 w-full">
        {tt('auth.register.submit')}
      </Button>
    </form>
  )
}
