import type { NextResponse } from 'next/server'
import {
  CSRF_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  SESSION_COOKIE,
  SESSION_COOKIE_PATH,
} from '@/server/auth/constants'
import { getConfig } from '@/server/config'

/**
 * Cookie plumbing for the web console.
 *
 * The session cookie is HttpOnly (JS must never read the bearer token); the
 * refresh cookie is scoped to the auth API so it is not attached to ordinary
 * page requests; the CSRF cookie is intentionally readable so the client can
 * echo it in `X-CSRF-Token` (double submit).
 */

export interface CookiePolicy {
  sessionMaxAgeMs: number
  refreshMaxAgeMs: number
  secure: boolean
}

export function cookiePolicy(): CookiePolicy {
  const config = getConfig()
  return {
    sessionMaxAgeMs: config.accessTokenTtlHours * 60 * 60 * 1000,
    refreshMaxAgeMs: config.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    // Derived from the public origin, not from NODE_ENV: a production build served
    // over plain http during local verification would otherwise set `Secure`
    // cookies, which the browser silently drops — and "login does not stick" is a
    // miserable bug to diagnose. Behind TLS this is true, which is what matters.
    secure: config.publicBaseUrl.startsWith('https://'),
  }
}

interface SetCookiesInput {
  sessionToken: string
  refreshToken: string
  csrfToken: string
}

/** Attach all three cookies to an outgoing response. */
export function setSessionCookies(response: NextResponse, input: SetCookiesInput): void {
  const policy = cookiePolicy()
  response.cookies.set({
    name: SESSION_COOKIE,
    value: input.sessionToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: policy.secure,
    path: SESSION_COOKIE_PATH,
    maxAge: Math.floor(policy.sessionMaxAgeMs / 1000),
  })
  response.cookies.set({
    name: REFRESH_COOKIE,
    value: input.refreshToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: policy.secure,
    path: REFRESH_COOKIE_PATH,
    maxAge: Math.floor(policy.refreshMaxAgeMs / 1000),
  })
  response.cookies.set({
    name: CSRF_COOKIE,
    value: input.csrfToken,
    httpOnly: false,
    sameSite: 'lax',
    secure: policy.secure,
    path: SESSION_COOKIE_PATH,
    maxAge: Math.floor(policy.sessionMaxAgeMs / 1000),
  })
}

/** Expire all three cookies (logout, revocation, suspension). */
export function clearSessionCookies(response: NextResponse): void {
  for (const [name, path] of [
    [SESSION_COOKIE, SESSION_COOKIE_PATH],
    [REFRESH_COOKIE, REFRESH_COOKIE_PATH],
    [CSRF_COOKIE, SESSION_COOKIE_PATH],
  ] as const) {
    response.cookies.set({ name, value: '', path, maxAge: 0 })
  }
}
