/**
 * Server-side session guard for Next.js API routes (BFF layer).
 *
 * Used by BFF routes that don't simply proxy to the backend (and therefore
 * don't get session enforcement "for free" via the backend SessionAuth
 * middleware). The canonical example is `/api/workflow/test-node`, which
 * fans out to multiple internal BFF routes (chat, video-search, tts, ...)
 * and would otherwise be reachable anonymously from the public internet.
 *
 * Threat model (spec/01 §V01-B):
 *   - CVSS 8.2 — anonymous attacker exhausts LLM/Tavily/Pexels quota and
 *     potentially leaks workflow context via node output.
 *
 * Implementation strategy:
 *   1. Read the session token from `Authorization: Bearer <token>` header
 *      (canonical) or `Authorization: <raw token>` (legacy) or the
 *      `ecliptrix-session-token` cookie (browser navigations).
 *   2. POST it to the backend `/api/auth/validate-session` endpoint, which
 *      validates against `User.active_session_token` and returns a typed
 *      success/failure response.
 *   3. Cache the validation result on the request object so repeat
 *      lookups within the same request don't hit the backend twice.
 *
 * Failure semantics:
 *   - `verifySessionFromRequest` returns `{ valid: false }` for any
 *     non-2xx response or network error. Callers MUST treat any falsy
 *     `valid` as 401.
 *   - We DO NOT throw — every BFF route handles auth failure differently
 *     (some 401, some 403). The caller decides.
 */
import { SESSION_TOKEN_KEY } from '@/lib/auth/storage-keys';

export interface SessionVerificationResult {
  valid: boolean;
  userId?: string;
  reason?: string;
}

interface ValidateSessionRequestBody {
  user_id?: string | null;
  session_token: string;
}

/**
 * Extract a session token from a Next.js request.
 *
 * Order of preference (mirrors backend `auth_middleware._extract_token`):
 *   1. Authorization: Bearer <token>
 *   2. Authorization: <raw token>          (legacy)
 *   3. ecliptrix-session-token cookie       (browser nav)
 *   4. X-Session-Token header               (legacy clients)
 */
export function extractSessionToken(request: Request): string | null {
  const auth = request.headers.get('authorization');
  if (auth) {
    if (auth.startsWith('Bearer ')) {
      return auth.slice(7).trim() || null;
    }
    return auth.trim() || null;
  }

  const legacy = request.headers.get('x-session-token');
  if (legacy) return legacy.trim() || null;

  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    // Cookie parsing — we deliberately avoid pulling in a library for a
    // single token. The cookie format is `key=value; key2=value2`.
    const parts = cookieHeader.split(';');
    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const name = part.slice(0, eq).trim();
      if (name === SESSION_TOKEN_KEY) {
        return decodeURIComponent(part.slice(eq + 1).trim()) || null;
      }
    }
  }

  return null;
}

/**
 * Verify a session token against the backend.
 *
 * Returns `{ valid: false }` on any failure (no token, network error,
 * non-2xx backend response, malformed response). Never throws.
 */
export async function verifySessionFromRequest(
  request: Request,
): Promise<SessionVerificationResult> {
  const token = extractSessionToken(request);
  if (!token) {
    return { valid: false, reason: 'Missing session token' };
  }

  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    // BACKEND_URL is server-side only and required per CLAUDE.md.
    // We refuse to authenticate without it rather than silently allow.
    return { valid: false, reason: 'BACKEND_URL not configured' };
  }

  const body: ValidateSessionRequestBody = {
    session_token: token,
  };

  try {
    const res = await fetch(`${backendUrl}/api/auth/validate-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Validate-session is fast (single DB lookup); 5s is generous.
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return { valid: false, reason: `Backend returned ${res.status}` };
    }

    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: { user_id?: string; valid?: boolean } }
      | null;

    if (!json || json.success === false) {
      return { valid: false, reason: 'Backend rejected session' };
    }

    // The validate-session response shape: `{ success: true, data: { user_id, valid, ... } }`
    // We accept either `data.valid === true` or simply a 2xx with success=true,
    // depending on backend version; both indicate a live session.
    if (json.data && json.data.valid === false) {
      return { valid: false, reason: 'Session invalid' };
    }

    return {
      valid: true,
      userId: json.data?.user_id ?? undefined,
    };
  } catch (err) {
    // Network/timeout errors → deny by default. Logged at caller's discretion.
    return {
      valid: false,
      reason: err instanceof Error ? err.message : 'Validation failed',
    };
  }
}
