# Spec 03: Frontend HTTP Client Wrapper

> **Owner role:** Frontend developer (browser-side)
> **Layer:** Browser (`src/lib/api/`)
> **Depends on:** None (Phase 1 — independent)
> **Blocks:** S05 (lib/api modules use this), S06 (migrated direct-call modules use this), S07 (testing exercises this)

---

## 1. Purpose

Replace the 14 hand-rolled `fetch(...)` patterns in `src/lib/api/*.ts` with a single, thin function-based HTTP client that:

1. Automatically injects `Authorization: Bearer <token>` from `localStorage('ecliptrix-session-token')`
2. Reacts to a `401` response by clearing the local session and redirecting to the login page
3. Returns a uniform error envelope so callers can handle errors consistently
4. Adds reasonable defaults: timeout, JSON content-type, abort support
5. Has zero runtime dependencies — pure `fetch` + TypeScript

This makes the auth requirement (master plan G3) **automatic** for every browser→Next.js call: callers cannot accidentally forget to send the token, and they cannot accidentally swallow a 401.

---

## 2. Acceptance Criteria

1. New file `src/lib/api/http-client.ts` exists and exports a `http` object (or named functions) covering: `get`, `post`, `put`, `del`, `upload`
2. Each method automatically adds `Authorization: Bearer <token>` from `localStorage.getItem('ecliptrix-session-token')` UNLESS the caller passes `requireAuth: false`
3. The default for `requireAuth` is `true` (secure-by-default)
4. If `requireAuth: true` and no token is present in localStorage, the call MUST throw a typed `MissingAuthError` BEFORE issuing the network request — and the error message tells the developer to either log in first or pass `requireAuth: false`
5. If the response status is `401` (with any body), the client MUST: (a) clear `ecliptrix-session-token` and `ecliptrix-user` from localStorage, (b) dispatch a window event `ecliptrix:session-expired`, (c) navigate the browser to `/login` UNLESS the current path is already `/login` or `/register`, (d) throw a typed `SessionExpiredError`. The order matters: storage clear MUST happen before navigation
6. If the response status is `403`, the client throws a typed `ForbiddenError` (no logout, no redirect — the user is logged in but lacks permission)
7. If the response status is `>= 400` and not 401/403, the client throws a typed `ApiError` carrying `status`, `errorCode`, `message`, and the parsed `error_details` if present
8. On success (2xx), the client parses the JSON body and returns it typed as `TResponse`
9. The client supports `signal?: AbortSignal` for cancellation; aborted requests throw `AbortError`
10. The client supports `timeoutMs?: number` (default `30000`); timed-out requests throw `TimeoutError`
11. The `upload` method supports `FormData` bodies and automatically OMITS the `Content-Type` header (the browser sets it with the boundary parameter)
12. The wrapper has NO retry logic for 5xx by default — retries are explicit per-call via `retries?: number` option (default `0`)
13. Unit tests in `src/lib/api/__tests__/http-client.test.ts` cover every branch above
14. NO `src/lib/api/*.ts` other than the wrapper itself contains a raw `fetch(` call AFTER S05 completes (this spec just delivers the wrapper; the migration happens in S05)
15. NO file under `src/lib/api/` outside the wrapper reads `localStorage` for the session token after S05 completes

---

## 3. Module Surface (pseudocode)

```ts
// src/lib/api/http-client.ts
// Browser-side HTTP wrapper. Safe to import from client components.

export interface RequestOptions {
  requireAuth?: boolean      // default true
  timeoutMs?: number         // default 30000
  signal?: AbortSignal
  headers?: Record<string, string>
  retries?: number           // default 0; only retries network errors / 5xx, never 4xx
}

export const http = {
  get<T>(path: string, opts?: RequestOptions): Promise<T>,
  post<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T>,
  put<T>(path: string, body: unknown, opts?: RequestOptions): Promise<T>,
  del<T>(path: string, opts?: RequestOptions): Promise<T>,
  upload<T>(path: string, formData: FormData, opts?: RequestOptions): Promise<T>,
}

// Typed errors
export class MissingAuthError extends Error { code = 'MISSING_AUTH' }
export class SessionExpiredError extends Error { code = 'SESSION_EXPIRED' }
export class ForbiddenError extends Error { code = 'FORBIDDEN'; status = 403 }
export class ApiError extends Error {
  code: string
  status: number
  details?: Record<string, unknown>
}
export class TimeoutError extends Error { code = 'TIMEOUT' }
```

### 3.1 Request flow (pseudocode)

```
function request<T>(method, path, body?, opts?):
    auth_required = opts.requireAuth ?? true

    if auth_required:
        token = localStorage.getItem('ecliptrix-session-token')
        if !token:
            throw MissingAuthError("No session token. Login required, or pass {requireAuth:false}.")

    headers = { ...opts.headers }
    if body is not FormData and body is not undefined:
        headers['Content-Type'] = 'application/json'
    if auth_required and token:
        headers['Authorization'] = 'Bearer ' + token

    abort_ctrl = new AbortController()
    timeout_handle = setTimeout(() => abort_ctrl.abort(), opts.timeoutMs ?? 30000)

    if opts.signal:
        opts.signal.addEventListener('abort', () => abort_ctrl.abort())

    try:
        response = await fetch(path, {
            method,
            headers,
            body: body is FormData ? body : JSON.stringify(body),
            signal: abort_ctrl.signal,
        })
    catch e:
        if e is AbortError and timeout fired: throw TimeoutError
        if retries > 0: retry with retries-1
        throw ApiError(network failure)
    finally:
        clearTimeout(timeout_handle)

    if response.status == 401:
        handle_session_expired()
        throw SessionExpiredError

    if response.status == 403:
        throw ForbiddenError(parse_body_for_message())

    if response.status >= 400:
        body = await response.json().catch(() => null)
        throw ApiError(status, body.error_code, body.message, body.error_details)

    return await response.json() as T


function handle_session_expired():
    localStorage.removeItem('ecliptrix-session-token')
    localStorage.removeItem('ecliptrix-user')
    window.dispatchEvent(new CustomEvent('ecliptrix:session-expired'))
    if window.location.pathname not in ['/login', '/register']:
        window.location.href = '/login?reason=session-expired'
```

### 3.2 Why no global event listener inside this module

The module dispatches `ecliptrix:session-expired` but does NOT subscribe to it. Subscription belongs to `AuthContext.tsx` (which holds React state and can update the UI immediately). This keeps the wrapper free of React imports — it remains a pure browser utility.

`AuthContext.tsx` MUST add a `useEffect` listener for `ecliptrix:session-expired` that calls its internal logout state-clearing logic. This is the **only** required change to existing files (besides the lib/api refactor in S05).

---

## 4. Path handling

The wrapper is **path-only**, not URL. Callers pass `'/api/video/search'`, NEVER `'http://...'`.

- **Why:** Browser code calls Next.js routes (same origin) — no need for a base URL
- **Enforcement:** If `path` starts with `http://` or `https://`, throw `Error: HTTP client only accepts same-origin paths starting with /`
- This makes "leaking the backend URL into the browser" structurally impossible — even if someone tries

---

## 5. Storage abstraction (light)

The wrapper reads `localStorage` directly with the constant key `'ecliptrix-session-token'`. There is intentionally NO injection / DI for this; the constant is hard-coded to match `AuthContext.tsx`. If the storage key ever changes, all consumers MUST change together — the shared constants file below makes that change a one-line edit.

**Verified at spec time**, the following files currently read `'ecliptrix-session-token'` or `'ecliptrix-user'` from `localStorage`:

| File | Status after this refactor |
|---|---|
| `src/contexts/AuthContext.tsx` | KEPT — owns the storage. Switches to importing constants from `storage-keys.ts` (this spec). |
| `src/lib/api/http-client.ts` | NEW — this spec. Imports constants. |
| `src/lib/api/userManagement.ts` | MIGRATED in S05 — replaced by `http-client` calls; local `getAuthHeaders()` removed. |
| `src/lib/api/systemSettings.ts` | MIGRATED in S05 — replaced by `http-client` calls; local `getAuthHeaders()` removed. |
| `src/components/AdminSettings/components/useSettingsPanel.ts` | MIGRATED in S05 — replaced by `http-client` calls; local `getAuthHeaders()` removed. This is the only `'use client'` component file outside `src/lib/api/` that currently reads the session token directly, and S05 explicitly includes it in scope so the post-refactor invariant in Section 9 ("only `AuthContext.tsx` and `http-client.ts` may read the session token") is enforceable. |

A shared constants file (`src/lib/auth/storage-keys.ts`) IS created in this spec to enforce the single source of truth:
```ts
export const SESSION_TOKEN_KEY = 'ecliptrix-session-token'
export const SESSION_USER_KEY = 'ecliptrix-user'
```
After S05 lands, only `AuthContext.tsx` and `http-client.ts` import from this file. The hardcoded strings disappear from every other consumer.

---

## 6. Test Matrix (`src/lib/api/__tests__/http-client.test.ts`)

| # | Scenario | Expected |
|---|---|---|
| T1 | `http.get('/api/x')` with no token in storage | throws `MissingAuthError` (no fetch issued) |
| T2 | `http.get('/api/x', {requireAuth: false})` with no token | issues fetch without `Authorization` header |
| T3 | `http.get('/api/x')` with token in storage | issues fetch with `Authorization: Bearer <token>` |
| T4 | `http.post('/api/x', {a:1})` with token | request body is `'{"a":1}'`, content-type is `application/json` |
| T5 | `http.upload('/api/x', formData)` | content-type header is NOT set (browser handles boundary) |
| T6 | Backend returns `200 {ok: true}` | resolves with `{ok: true}` |
| T7 | Backend returns `401` | localStorage cleared, `ecliptrix:session-expired` event fired, location set to `/login`, throws `SessionExpiredError` |
| T8 | Backend returns `401` while on `/login` | localStorage cleared, event fired, NO redirect, throws `SessionExpiredError` |
| T9 | Backend returns `403 {error_code:'PERMISSION_DENIED'}` | throws `ForbiddenError` carrying body |
| T10 | Backend returns `500 {error_code:'X', message:'Y', error_details:{...}}` | throws `ApiError` with all fields populated |
| T11 | Backend returns `500` with non-JSON body | throws `ApiError` with `details: undefined` |
| T12 | Network error | throws `ApiError` (or retries if `retries > 0`) |
| T13 | `timeoutMs: 50` and slow backend (>50ms) | throws `TimeoutError` |
| T14 | Caller passes external `signal` and aborts mid-flight | throws `AbortError` |
| T15 | `retries: 2` with 500/500/200 sequence | resolves with success on third try |
| T16 | `retries: 2` with 401/200 sequence | does NOT retry (4xx never retried), throws on first 401 |
| T17 | `path` starts with `http://` | throws synchronously, no fetch issued |
| T18 | Two parallel calls, both 401 | only one navigation occurs (debounce / once-flag) |

T18 is important: bursting 10 protected requests in parallel must result in ONE redirect, not 10.

---

## 7. Files to Create / Modify

| File | Action | LoC est |
|---|---|---|
| `src/lib/api/http-client.ts` | Create | ~250 |
| `src/lib/auth/storage-keys.ts` | Create (constants) | ~5 |
| `src/lib/api/__tests__/http-client.test.ts` | Create (Vitest) | ~400 |
| `src/contexts/AuthContext.tsx` | Modify (import constants from `storage-keys`, add `ecliptrix:session-expired` listener) | +20 |

**Estimated total LoC: ~675**. The test file is the largest contributor; the wrapper itself is ~250.

---

## 8. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| `localStorage` is unavailable (SSR or strict mode) | Wrapper checks `typeof window !== 'undefined'`; if running on the server, throw `Error: http-client is browser-only` |
| Token contains invalid characters | Wrapper does NOT validate; it sends what is in storage. Backend rejects with 401 → handled normally |
| Multiple tabs: another tab logs out | Tab using stale token sends request → 401 → handled normally → user redirected. (Note: `AuthContext.tsx` does NOT currently subscribe to the cross-tab `storage` event — verified at spec time. Cross-tab logout therefore relies on the next outgoing request hitting 401 and the wrapper's redirect path. Adding a `storage` listener is OUT OF SCOPE for this spec.) |
| Server returns `204 No Content` for a typed call | `response.json()` would fail; wrapper checks `Content-Length: 0` or status 204 → returns `null as T` |
| Server returns unexpected content-type (e.g., HTML error page) | `response.json()` throws → caught and re-thrown as `ApiError` with `details: { rawBodyTruncated: '...' }` |
| Caller passes `body: undefined` to `post` | Treated as empty JSON body `{}` |

---

## 9. Coordination Notes for Other Agents

- **For S05 (lib/api refactor):** Every file under `src/lib/api/*.ts` (except `http-client.ts` itself and `__tests__/`) must replace its raw `fetch(` calls with `http.get/post/put/del/upload(...)`. Remove every duplicate `getAuthHeaders()` helper. Drop any `localStorage.getItem('ecliptrix-session-token')` references — the wrapper handles it. **S05 ALSO covers `src/components/AdminSettings/components/useSettingsPanel.ts`**, which is the single `'use client'` hook outside `src/lib/api/` that currently reads the session token directly and defines its own `getAuthHeaders()`. Migrating it is required to make the Phase 2 invariant (next bullet) holdable.
- **For S06 (direct-call migration):** The 3 NEXT_PUBLIC files become thin wrappers calling new Next.js proxy routes via `http.get/post/upload`. They MUST NOT bypass the wrapper
- **For S07 (testing):** Reuse the same Vitest setup that S02 introduces. The integration tests need a way to seed `localStorage` before importing the module (a `setup-storage.ts` helper)
- **For Phase 2 review/test agents:** Verify that no `'use client'` component reads `localStorage` for the session token directly — only `AuthContext.tsx` and `http-client.ts` may

---

## 10. Out of Scope

- React hook abstraction (e.g., `useApi(path)`) — adds React imports the wrapper deliberately avoids
- Caching / stale-while-revalidate — explicit non-goal per master plan D3
- Request deduplication — adds complexity; not needed at current scale
- WebSocket / SSE support — no current usage in lib/api
- CSRF token handling — not needed for token-based auth via Authorization header
- Refresh token rotation — deferred to a separate ticket
- Per-call telemetry / tracing — could be added later via the `headers` option without modifying the wrapper
