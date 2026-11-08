'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { api, ApiError } from '@/lib/api/client'
import { toast } from '@/components/shell/toaster'
import { errorMessage, translator, type Locale } from '@/lib/i18n'

/**
 * Sign-in form.
 *
 * The failure path is deliberately flat: every credential error shows the same
 * message the server returns, because the server already collapsed the cases. The
 * only extra signal is the lockout hint, which carries a retry-after value the
 * copy would be useless without.
 */
export interface LoginFormProps {
  locale: Locale
  next?: string
}

interface LoginResponse {
  user: { id: string; permissions: string[]; mustChangePassword: boolean; role: { key: string } }
}

export function LoginForm({ locale, next }: LoginFormProps) {
  const tt = translator(locale)
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryAfter, setRetryAfter] = useState<number | null>(null)

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setRetryAfter(null)
    setLoading(true)
    try {
      const result = await api.post<LoginResponse>('/api/v1/auth/login', {
        identifier: identifier.trim(),
        password,
        client: 'web',
      })

      const target =
        next && next.startsWith('/')
          ? next
          : result.user.mustChangePassword
            ? '/account/security'
            : result.user.permissions.includes('*') || result.user.permissions.includes('users.read')
              ? '/admin'
              : '/account'

      toast.success(tt('auth.login.submit'))
      router.replace(target)
      router.refresh()
    } catch (thrown) {
      if (thrown instanceof ApiError) {
        const seconds = (thrown.details?.retryAfterSeconds as number | undefined) ?? null
        setRetryAfter(seconds)
        setError(errorMessage(thrown.code, locale))
      } else {
        setError(tt('errors.network'))
      }
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <Field label={tt('auth.login.identifier')} htmlFor="identifier" required>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          autoFocus
          required
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="you@example.com"
        />
      </Field>

      <Field label={tt('auth.login.password')} htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyUp={(event) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)}
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? tt('auth.login.hidePassword') : tt('auth.login.showPassword')}
            className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-sm text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {capsLock ? (
          <p className="mt-1 text-xs text-[var(--warning)]">{tt('auth.login.capsLock')}</p>
        ) : null}
      </Field>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-sm border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-3 py-2 text-xs text-[var(--danger)]"
        >
          <Lock size={13} className="mt-0.5 shrink-0" />
          <span>
            {error}
            {retryAfter ? `（${retryAfter}s）` : ''}
          </span>
        </p>
      ) : null}

      <Button type="submit" loading={loading} className="mt-1 w-full">
        {tt('auth.login.submit')}
      </Button>

      <Link href="/forgot-password" className="self-start text-xs text-[var(--muted)] hover:text-[var(--foreground)]">
        {tt('auth.login.forgot')}
      </Link>
    </form>
  )
}
