/**
 * The guest-visible surface, as an exact list.
 *
 * "A visitor may read the site but may not download the installer" was true
 * before this file existed, but only by accident: nothing named it, so the next
 * person to add a route could not tell whether `/pricing` was meant to be public
 * or whether its absence from some implicit rule was deliberate. This module is
 * the contract, and `tests/integration/guest-surface.test.ts` pins it.
 *
 * Deliberately a whitelist of whole paths, not a prefix guess: a prefix rule
 * (`/admin`) is one `startsWith` mistake away from serving `/administrator` or
 * `/admin-tools` — and the same mistake in the other direction locks a real page
 * out silently.
 *
 * The installers under `/api/v1/downloads/*` are NOT here: they require a session
 * (`requireSession`), which is the requirement "guests cannot download".
 */

/** Pages a signed-out visitor may open, exactly. */
export const PUBLIC_PAGES = [
  '/',
  '/download',
  '/legal/terms',
  '/legal/privacy',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/confirm-deletion',
] as const

/**
 * API surfaces a signed-out visitor may call, by exact path or path prefix.
 *
 * `'/api/v1/auth/'` covers captcha, login, register, refresh, logout — each of
 * which either establishes a session or is harmless without one. An unmatched
 * path under `/api/v1/admin/` falls through to the guards, which answer 401.
 */
export const PUBLIC_API_PREFIXES = [
  '/api/v1/health',
  '/api/v1/ready',
  '/api/v1/meta',
  '/api/v1/releases/latest',
  '/api/v1/auth/',
  '/api/v1/locale',
] as const

/** True when `pathname` names a public page or sits under a public API prefix. */
export function isPublicPath(pathname: string): boolean {
  if ((PUBLIC_PAGES as readonly string[]).includes(pathname)) return true
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}`),
  )
}

/**
 * Paths that must never be indexed.
 *
 * `robots.txt` lists the same set; keeping the list here means the header and the
 * crawl rules cannot drift apart.
 */
export const NOINDEX_PREFIXES = ['/account', '/admin'] as const
