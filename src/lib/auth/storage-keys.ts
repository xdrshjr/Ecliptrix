/**
 * Shared localStorage key constants for the Ecliptrix browser session.
 *
 * These keys are the single source of truth used by:
 *   - `src/contexts/AuthContext.tsx` (owns the storage)
 *   - `src/lib/api/http-client.ts` (reads the token to inject Authorization)
 *
 * If you change these keys, you MUST change them here once — every consumer
 * imports from this file.  Do NOT hardcode the literal strings anywhere else.
 */

export const SESSION_TOKEN_KEY = 'ecliptrix-session-token';
export const SESSION_USER_KEY = 'ecliptrix-user';

/**
 * Lifetime of the session cookie. Kept long-lived so it matches the
 * persistence of the localStorage token (the backend invalidates a session by
 * rotating `User.active_session_token` in the DB, not by a cookie TTL).
 */
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

/**
 * Persist the session token to BOTH localStorage and a same-origin cookie.
 *
 * The cookie is required because browser media tags (`<img>/<video>/<audio>`)
 * that load `/api/storage/files/...` cannot send an `Authorization` header;
 * the backend authenticates them via its `ecliptrix-session-token` cookie
 * fallback (see `dependencies/auth.py` `_extract_token`). It is intentionally
 * NOT `HttpOnly` (JS must write it) and uses `SameSite=Lax` so same-origin
 * subresource requests carry it; `Secure` is added under HTTPS.
 *
 * MUST stay paired with `clearSessionToken()`: every site that clears the
 * token has to go through that helper, otherwise the cookie could outlive the
 * localStorage token and let a logged-out browser keep reading files.
 */
export function setSessionToken(token: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SESSION_TOKEN_KEY, token);
  }
  if (typeof document === 'undefined') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const value = encodeURIComponent(token);
  const maxAge = SESSION_COOKIE_MAX_AGE_SECONDS;
  document.cookie =
    `${SESSION_TOKEN_KEY}=${value}; path=/; Max-Age=${maxAge}` +
    `; SameSite=Lax${secure}`;
}

/**
 * Clear the session token from BOTH localStorage and the same-origin cookie.
 * Mirror of `setSessionToken()`; call at every logout / session-expiry /
 * invalid-session site so the cookie can never outlive the localStorage token.
 */
export function clearSessionToken(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  }
  if (typeof document === 'undefined') return;
  document.cookie = `${SESSION_TOKEN_KEY}=; path=/; Max-Age=0; SameSite=Lax`;
}
