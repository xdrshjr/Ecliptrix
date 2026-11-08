/**
 * Client-side input rules.
 *
 * These are *mirrors*, never the authority: the server validates every request
 * once at the boundary (`src/server/validation/schemas.ts` and
 * `src/server/auth/password.ts`), and the browser copy exists only to answer
 * before a round trip. The thresholds below must equal the server's —
 * `tests/unit/catalog.test.ts` imports both sides and fails on drift, because a
 * client that accepts what the server rejects reads as a broken form.
 *
 * This module must stay importable by client components: no `node:crypto`, no
 * `server-only`, no database import, directly or indirectly.
 */

/** Same as `emailSchema` in `src/server/validation/schemas.ts`. */
export const EMAIL_MAX_LENGTH = 254

/** Same as `usernameSchema`. */
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 32
export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/

/** Same as `displayNameSchema`. */
export const DISPLAY_NAME_MAX_LENGTH = 40

/** Same as `PASSWORD_MIN_LENGTH` / `PASSWORD_MAX_BYTES` in `server/auth/password.ts`. */
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_BYTES = 128

export type PasswordLengthIssue = 'too_short' | 'too_long'

/**
 * Structural email check.
 *
 * Deliberately loose (one `@`, a dot in the domain, no whitespace): RFC 5322 is
 * not worth reimplementing, and the server's zod `.email()` has the final say.
 */
export function isEmailShaped(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 3 || trimmed.length > EMAIL_MAX_LENGTH) return false
  if (/\s/.test(trimmed)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed)
}

export function isUsernameShaped(value: string): boolean {
  const trimmed = value.trim()
  return (
    trimmed.length >= USERNAME_MIN_LENGTH &&
    trimmed.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(trimmed)
  )
}

/** Byte length, because the server's limit is on bytes (UTF-8 multi-byte). */
export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function passwordLengthIssue(value: string): PasswordLengthIssue | null {
  if (value.length < PASSWORD_MIN_LENGTH) return 'too_short'
  if (passwordByteLength(value) > PASSWORD_MAX_BYTES) return 'too_long'
  return null
}
