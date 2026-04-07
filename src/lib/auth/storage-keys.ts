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
