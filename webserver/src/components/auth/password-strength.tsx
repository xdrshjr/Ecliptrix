'use client'

import { cn } from '@/lib/cn'

/**
 * Local password strength hint.
 *
 * Advisory only — the server's policy decides. Showing a meter anyway is what
 * stops a user from submitting a password that is then rejected with a list of
 * reasons they cannot act on quickly.
 */
export function PasswordStrength({ password }: { password: string }) {
  if (!password) return null

  const checks = [
    { pass: password.length >= 10, label: '至少 10 个字符' },
    { pass: /[a-zA-Z]/.test(password) && /[0-9]/.test(password), label: '包含字母与数字' },
    { pass: password.length >= 14, label: '14 个字符以上更安全' },
    { pass: /[^a-zA-Z0-9]/.test(password), label: '包含符号' },
  ]
  const score = checks.filter((check) => check.pass).length
  const percent = (score / checks.length) * 100
  const tone =
    score <= 1 ? 'var(--danger)' : score === 2 ? 'var(--warning)' : 'var(--accent)'

  return (
    <div className="mt-1.5">
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{ width: `${percent}%`, background: tone }}
        />
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-[var(--muted)]">
        {checks.map((check) => (
          <li key={check.label} className={cn(check.pass && 'text-[var(--accent)]')}>
            {check.pass ? '✓' : '·'} {check.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
