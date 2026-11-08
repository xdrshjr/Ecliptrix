import { getConfig } from '@/server/config'

/**
 * Absolute links that go into mail.
 *
 * Every one is built from `PUBLIC_BASE_URL` in configuration, never from a
 * request header: a `Host` header is caller-controlled, and a mailed link that
 * points at the caller's own domain is a phishing primitive.
 *
 * The token is `encodeURIComponent`-ed. Tokens are base64url, so this is belt to
 * braces — but the one place it matters is the moment somebody adds a character
 * that is not URL-safe to `newToken()`.
 */

function base(): string {
  return getConfig().publicBaseUrl
}

function withToken(path: string, token: string): string {
  return `${base()}${path}?token=${encodeURIComponent(token)}`
}

/** Password reset (moved here from `mailer.ts`, one place for every link). */
export function buildResetUrl(token: string): string {
  return withToken('/reset-password', token)
}

/** Verify an address — either the first verification or a change confirm. */
export function buildVerifyUrl(token: string): string {
  return withToken('/verify-email', token)
}

/** Confirm a self-service account deletion. */
export function buildDeletionUrl(token: string): string {
  return withToken('/confirm-deletion', token)
}

/** Registration link carrying an invite code (the code is not secret-but-public). */
export function buildInviteUrl(code: string): string {
  return `${base()}/register?invite=${encodeURIComponent(code)}`
}

/**
 * Account centre, for mails that point at "cancel it from here".
 *
 * Not a token link: the recipient signs in normally, which is the whole point of
 * keeping the deletion cancellation behind a session.
 */
export function buildAccountUrl(): string {
  return `${base()}/account`
}
