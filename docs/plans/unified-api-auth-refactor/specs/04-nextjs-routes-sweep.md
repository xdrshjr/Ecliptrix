# Spec 04: Next.js Routes Layer Sweep

> **Owner role:** Frontend developer (Next.js BFF layer)
> **Layer:** Next.js server-side (`src/app/api/**/route.ts`)
> **Depends on:** S01 (backend now strict), S02 (centralized config module)
> **Blocks:** S05 (client refactor consumes the new contract), S06 (migrated routes follow the same pattern), S07 (testing exercises this)

---

## 1. Purpose

Sweep all 90+ files under `src/app/api/**/route.ts` to:

1. **Replace** every `process.env.BACKEND_URL || 'http://localhost:8000'` (and the `BACKEND_SERVICE_URL` / `PYTHON_BACKEND_URL` variants) with `backendConfig.baseUrl` from S02
2. **Forward** the `Authorization` header from the incoming request to the backend on EVERY proxied call
3. **Standardize** the proxy implementation via a shared helper (`createBackendProxy` or similar) so future routes don't reinvent the wheel
4. **Normalize** error responses so callers see the same envelope shape regardless of which route they hit

The end state: every Next.js route is a thin, self-similar proxy. Adding a new route is "import the helper, call it, done" — not "copy 30 lines of fetch boilerplate from a neighbor".

---

## 2. Acceptance Criteria

1. New shared helper at `src/lib/api/server/backend-proxy.ts` (server-side) implementing the proxy primitive — see Section 3
2. Every existing `src/app/api/**/route.ts` file is refactored to either (a) import and use the helper, or (b) import `backendConfig` directly when the route has unusual logic that doesn't fit the helper. NO route reads `process.env` for backend URL after this spec
3. `grep -rn "process.env.BACKEND_URL\|process.env.BACKEND_SERVICE_URL\|process.env.PYTHON_BACKEND_URL" src/app/api/` returns ZERO matches. (Verified at spec time: 67 files reference `process.env.BACKEND_URL`, 13 reference `BACKEND_SERVICE_URL`, 4 reference `PYTHON_BACKEND_URL`. `chat/route.ts` is the one file that mixes a backend read with a third-party LLM call — it MUST also be migrated for the grep to be clean; see Section 5.)
4. `grep -rn "'http://localhost:8000'" src/app/api/` returns ZERO matches
5. Every route that proxies a backend call MUST forward `Authorization` header from `req.headers.get('authorization')` if present. Routes that explicitly serve unauthenticated traffic (login, register, validate-session) do NOT need to forward but MAY pass through harmlessly
6. The ~15 files that currently use `BACKEND_SERVICE_URL` (13 occurrences) or `PYTHON_BACKEND_URL` (4 occurrences) are converted to read from `backendConfig.baseUrl`. Note that some files (e.g., `audio-search/route.ts`) mix both `BACKEND_URL` and `BACKEND_SERVICE_URL` reads inside the same handler — the sweep MUST collapse all of them to `backendConfig.baseUrl`
7. Error responses from the backend (4xx/5xx with JSON body) are forwarded to the client with their status code preserved and the body passed through unchanged. Non-JSON backend errors are wrapped in a uniform envelope `{success: false, message: '...', error_code: 'BACKEND_ERROR', error_details: {...}}`
8. The helper's GET/POST/PUT/DELETE primitives all support: forwarding query params, forwarding JSON body, forwarding multipart body, forwarding `Authorization` header, optional `forwardHeaders: string[]` for additional headers (e.g., `x-request-id`)
9. Streaming responses (e.g., AI generation, video tasks) are supported via a `streaming: true` option that pipes the backend response through without buffering
10. Long-running routes (e.g., `video-compose` with 600s timeout) keep their existing per-route timeout values, configured via the helper's `timeoutMs` option (default 60000)
11. The helper exports TypeScript types for the proxy result and error envelope
12. NO route file contains a hand-rolled `fetch(${BACKEND_URL}/api/...)` after this sweep — every backend call goes through the helper OR uses a clearly-marked "raw escape hatch" with a `// SWEEP-EXCEPTION:` comment explaining why
13. Unit tests in `src/lib/api/server/__tests__/backend-proxy.test.ts` cover the helper's branches with mocked `fetch`
14. A "before/after" sample diff for at least 3 representative routes is included in the audit deliverable (see Section 8)

---

## 3. Helper Surface (pseudocode)

```ts
// src/lib/api/server/backend-proxy.ts
// SERVER-SIDE ONLY — imported by Next.js route handlers

import 'server-only'
import type { NextRequest } from 'next/server'
import { backendConfig } from '@/lib/config/backend'

interface ProxyOptions {
  forwardHeaders?: string[]   // additional headers from the incoming request to forward
  timeoutMs?: number          // default 60000
  streaming?: boolean         // default false; if true, pipe response without buffering
  errorEnvelope?: 'forward' | 'wrap'  // default 'forward'
}

// `backendPath` may be either a literal string ('/api/video/search') OR a builder
// that receives the resolved Next.js dynamic-route params and returns the final
// backend path. The builder form is required for any route under
// `src/app/api/**/[param]/route.ts` because the backend path is rarely a 1:1
// mapping of the Next.js URL — see Section 3.0 below.
type BackendPath =
  | string
  | ((params: Record<string, string | string[]>) => string)

// Next.js 15 App Router context shape: `{ params: Promise<Record<string, ...>> }`.
// The helper awaits the promise once internally and feeds the resolved object to
// the BackendPath builder. Static routes never receive `ctx` in practice — the
// helper falls back to an empty params object.
interface RouteContext {
  params?: Promise<Record<string, string | string[]>>
}

export const backendProxy = {
  get(req: NextRequest, backendPath: BackendPath, ctx?: RouteContext, opts?: ProxyOptions): Promise<Response>,
  post(req: NextRequest, backendPath: BackendPath, ctx?: RouteContext, opts?: ProxyOptions): Promise<Response>,
  put(req: NextRequest, backendPath: BackendPath, ctx?: RouteContext, opts?: ProxyOptions): Promise<Response>,
  del(req: NextRequest, backendPath: BackendPath, ctx?: RouteContext, opts?: ProxyOptions): Promise<Response>,
}

// Convenience builder for the common case: a route that just forwards everything.
// The returned handlers match Next.js 15's `(req, ctx)` signature so dynamic
// routes (`[id]`, `[...slug]`) work without per-route boilerplate.
export function createPassthroughRoute(backendPath: BackendPath, opts?: ProxyOptions) {
  return {
    GET: (req: NextRequest, ctx: RouteContext) => backendProxy.get(req, backendPath, ctx, opts),
    POST: (req: NextRequest, ctx: RouteContext) => backendProxy.post(req, backendPath, ctx, opts),
    PUT: (req: NextRequest, ctx: RouteContext) => backendProxy.put(req, backendPath, ctx, opts),
    DELETE: (req: NextRequest, ctx: RouteContext) => backendProxy.del(req, backendPath, ctx, opts),
  }
}
```

### 3.0 Dynamic route parameters (Next.js 15)

A material chunk of the existing `src/app/api/**/route.ts` tree lives under dynamic-segment folders (`[userId]`, `[compositionId]`, `[...path]`, `[functionType]`, `[providerId]`, `[category]`, `[key]`, `[taskId]`, `[packId]`, `[filename]`, `[workflowId]`). The helper MUST cleanly handle three patterns observed in the current codebase:

1. **Param is appended verbatim to the end of the backend path**, e.g. Next.js `/api/silence/status/[taskId]` → backend `/api/silence/status/${taskId}`. Builder form: `(p) => `/api/silence/status/${p.taskId}``.
2. **Param is interpolated into the MIDDLE of a different backend path shape**, e.g. Next.js `/api/admin/users/[userId]/toggle-status` → backend `/api/user/toggle-status/${userId}` (note the `users`/`user` rename and different ordering). Builder form: `(p) => `/api/user/toggle-status/${p.userId}``. The Next.js URL and the backend URL are NOT structural mirrors — the helper MUST NOT assume `req.nextUrl.pathname` is the backend path.
3. **Catch-all `[...path]` segments**, e.g. Next.js `/api/storage/files/[...path]` → backend `/api/storage/files/${path.join('/')}`. Builder form: `(p) => `/api/storage/files/${(p.path as string[]).join('/')}``. Note: `/api/storage/files/*` is one of the routes that already streams binary content with `Range` header forwarding (see Section 5 special-cases) and is therefore Pattern E (escape hatch) anyway, but the builder shape is still documented here for completeness.

The implementer MUST always use the builder form for any route file that lives under a `[*]` segment, even if the mapping looks 1:1 today. This makes the rename-or-restructure case (#2 above) explicit at the call site.

### 3.0.1 Route file shape with the builder form

```ts
// src/app/api/admin/users/[userId]/toggle-status/route.ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { POST } = createPassthroughRoute(
  (p) => `/api/user/toggle-status/${p.userId}`,
)
```

```ts
// src/app/api/storage/files/[...path]/route.ts (illustrative — actual file is Pattern E)
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { GET } = createPassthroughRoute(
  (p) => `/api/storage/files/${(p.path as string[]).join('/')}`,
  { forwardHeaders: ['range'], streaming: true },
)
```

### 3.1 Proxy execution flow (pseudocode)

```
function backendProxy.<method>(req, backendPath, ctx, opts):
    // Resolve dynamic-route params, if any
    params = ctx?.params ? await ctx.params : {}
    resolved_path = (typeof backendPath === 'function')
                      ? backendPath(params)
                      : backendPath
    target_url = backendConfig.joinPath(resolved_path)
    if method is GET:
        qs = req.nextUrl.searchParams.toString()
        if qs: target_url += '?' + qs

    headers = new Headers()
    // Always forward Authorization
    auth = req.headers.get('authorization')
    if auth: headers.set('Authorization', auth)
    // Always forward x-session-token (legacy)
    legacy = req.headers.get('x-session-token')
    if legacy: headers.set('x-session-token', legacy)
    // Forward optional extras
    for h in opts.forwardHeaders ?? []:
        v = req.headers.get(h)
        if v: headers.set(h, v)

    // Forward body
    body = null
    if method in [POST, PUT, DELETE]:
        content_type = req.headers.get('content-type') ?? ''
        if content_type starts with 'multipart/form-data':
            body = await req.formData()
            // do NOT set content-type — fetch will set it with boundary
        else:
            // JSON or other text
            body = await req.text()
            if content_type: headers.set('Content-Type', content_type)

    // Issue request
    abort_ctrl = new AbortController()
    timeout = setTimeout(() => abort_ctrl.abort(), opts.timeoutMs ?? 60000)
    try:
        backend_response = await fetch(target_url, {
            method,
            headers,
            body,
            signal: abort_ctrl.signal,
        })
    catch e:
        if AbortError: return Response.json(timeout_envelope, status=504)
        return Response.json(network_envelope, status=502)
    finally:
        clearTimeout(timeout)

    // Streaming pass-through
    if opts.streaming:
        return new Response(backend_response.body, {
            status: backend_response.status,
            headers: backend_response.headers,
        })

    // Buffered pass-through (default)
    return new Response(await backend_response.text(), {
        status: backend_response.status,
        headers: { 'Content-Type': backend_response.headers.get('content-type') ?? 'application/json' },
    })
```

### 3.2 Why the helper does NOT read or validate the body

The helper is a **dumb pipe**. It does not parse JSON, does not validate schemas, does not re-shape data. Doing any of those would tightly couple the BFF to backend payload changes — exactly the kind of fragility we want to remove. If a route needs to mutate the body (rare — most should not), it bypasses the helper and uses `backendConfig.baseUrl` directly with a `// SWEEP-EXCEPTION:` comment.

---

## 4. Migration Patterns

For the sweep to be tractable, the implementer classifies each existing route into one of FOUR patterns and applies the matching transformation:

### 4.1 Pattern A — Plain passthrough (most common, ~60+ routes)

**Before** (representative — actual file is `src/app/api/video-search/route.ts`):
```ts
export async function POST(req: NextRequest) {
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'
  const body = await req.json()
  const res = await fetch(`${BACKEND_URL}/api/video/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return NextResponse.json(await res.json(), { status: res.status })
}
```

**After:**
```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { POST } = createPassthroughRoute('/api/video/search')
```

**Note on the real `auth/login/route.ts`:** the existing file is NOT a plain passthrough — it currently re-shapes the backend's `result.user` into a frontend-friendly `transformedUser` object before returning. That body mutation MUST move to the client (`src/lib/api/auth.ts`) so the route itself becomes Pattern A. The reshape is trivial (~10 lines) and moving it client-side is the correct layering per master plan §5.1 ("Next.js `route.ts`: Forward request to backend, never mutate body"). If for any reason the implementer cannot move the reshape in this PR, the login route falls back to Pattern E with a `// SWEEP-EXCEPTION:` comment — but this counts against the 5-route escape-hatch budget.

### 4.2 Pattern B — Passthrough with auth header forwarding (~30 routes)

**Before:**
```ts
export async function GET(req: NextRequest) {
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'
  const authHeader = req.headers.get('authorization')
  const res = await fetch(`${BACKEND_URL}/api/admin/users/list?...`, {
    headers: { 'Authorization': authHeader ?? '' },
  })
  return NextResponse.json(await res.json(), { status: res.status })
}
```

**After:**
```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { GET } = createPassthroughRoute('/api/admin/users/list')
// Authorization is forwarded automatically by the helper
```

### 4.3 Pattern C — Long-running with custom timeout (~5 routes: video-compose, ai-mixed-editing, etc.)

**After:**
```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { POST } = createPassthroughRoute('/api/video/compose', { timeoutMs: 600_000 })
```

### 4.4 Pattern D — Streaming (~2-3 routes: ai-video-script-generation, video-editing-agent/chat, large file downloads)

**After:**
```ts
import { createPassthroughRoute } from '@/lib/api/server/backend-proxy'
export const { POST } = createPassthroughRoute('/api/ai-video-script-generation', { streaming: true, timeoutMs: 300_000 })
```

Note: `/api/chat/route.ts` is NOT a candidate for Pattern D — it streams from a third-party LLM (not the FastAPI backend) and is handled per the special-case row in Section 5.

### 4.5 Pattern E — Routes with non-trivial transformation (escape hatch)

A small minority of routes do something the helper can't express (e.g., merging two backend calls, or rewriting paths based on query params). These keep their hand-rolled implementation BUT:
1. Import `backendConfig` instead of reading `process.env`
2. Forward the `Authorization` header explicitly
3. Add a `// SWEEP-EXCEPTION: <reason>` comment at the top of the function
4. Are tracked in the audit (Section 8)

The implementer MUST NOT exceed 5 escape-hatch routes total. If more than 5 routes don't fit, that's a signal that the helper needs an additional option, and it should be added rather than escaping.

---

## 5. Special-Case Routes

These routes need explicit attention during the sweep:

| Route file | Special handling |
|---|---|
| `src/app/api/auth/login/route.ts` | Anonymous (allowlisted on backend). Currently re-shapes `result.user` → `transformedUser` before returning to the client. Move that re-shape to `src/lib/api/auth.ts` (S05) so the route becomes Pattern A. Otherwise fall back to Pattern E. |
| `src/app/api/auth/register/route.ts` | Same as login — verify whether it transforms the body before classifying. Default Pattern A. |
| `src/app/api/auth/validate-session/route.ts` | Pattern A. Backend allowlist exempts this from middleware auth, so the request body still carries `user_id` + `session_token` for validation. |
| `src/app/api/auth/logout/route.ts` | Requires auth. Pattern B. After successful logout, the BACKEND clears `active_session_token`. The frontend separately clears localStorage. |
| `src/app/api/health/route.ts` | Verified at spec time: this file does NOT currently exist on the Next.js side. No action — the smoke script in S07 hits the backend `/api/health` directly via the deployed origin. |
| `src/app/api/video-compose/route.ts` | Pattern C — 600s timeout, retain. The existing file ALSO has request body validation (task_id / video_items / total_duration shape checks) and a 1-retry loop. The validation logic must move client-side (S05 typed `videoComposition.ts`) and the retry can be dropped (the helper does no retries — long-running calls should fail loud). If neither move is feasible in this PR, this route becomes Pattern E. |
| `src/app/api/video-compose/[compositionId]/status/route.ts` | Dynamic route. Pattern A with builder: `(p) => `/api/video/compose/${p.compositionId}/status``. |
| `src/app/api/video-compose/[compositionId]/download/route.ts` | Dynamic route, returns binary. Pattern D streaming with builder. |
| `src/app/api/storage/files/[...path]/route.ts` | Pattern E (escape hatch). Catch-all segment, forwards `Range` header and select response headers (`content-type`, `content-length`, `accept-ranges`, `content-range`, `cache-control`) for video seeking. The helper's `forwardHeaders` covers Range, but the response-header allowlist is custom — keep the hand-rolled body BUT switch to `backendConfig.joinPath(...)` and add the `// SWEEP-EXCEPTION: response header allowlist` comment. |
| `src/app/api/admin/users/[userId]/*` (toggle-status, reset-password, login-history, force-logout, delete, edit) | Dynamic routes. Pattern B with builder. **Important:** the backend path is NOT a 1:1 mirror — Next.js `/api/admin/users/[userId]/toggle-status` maps to backend `/api/user/toggle-status/${userId}`. Each handler must use its own builder; the implementer MUST verify the backend path against the existing hand-rolled file before substituting. |
| `src/app/api/chat/route.ts` | **NOT fully out of scope.** Verified at spec time: this route reads `BACKEND_URL` to call `/api/model-settings/resolve/chat` BEFORE falling back to the third-party LLM at `process.env.LLM_API_URL`. The third-party LLM call (and its SSE streaming logic) IS out of scope per master plan §3, but the file still currently violates AC #3 because it reads `process.env.BACKEND_URL` directly. Treatment: replace ONLY the `BACKEND_URL` read with `backendConfig.baseUrl` (one-line edit), leave the LLM streaming logic untouched, and add `// SWEEP-EXCEPTION: third-party LLM streaming, not a backend proxy` above the SSE block. This counts against the escape-hatch budget. |
| `src/app/api/workflow/ai-video-generate/route.ts` | Currently uses `BACKEND_SERVICE_URL`. Convert to `backendConfig` + Pattern C (long-running). |
| `src/app/api/ai-mixed-editing/route.ts` | Currently uses `BACKEND_SERVICE_URL`. Convert. Pattern C if long-running. |
| `src/app/api/audio-search/route.ts` | Currently MIXED: top-level `BACKEND_URL` and inner `BACKEND_SERVICE_URL` reads in the same handler. Collapse both to `backendConfig.baseUrl`. Pattern A after collapse. |
| `src/app/api/workflow-preferences/save/route.ts` | Currently uses `PYTHON_BACKEND_URL`. Also re-shapes `{userId, preferences}` → `{user_id, preferences}` before forwarding. Move the key rename to `src/lib/api/workflowPreferences.ts` (S05) so the route becomes Pattern A. Otherwise Pattern E. |
| `src/app/api/timeline-export/route.ts` | Currently uses `BACKEND_SERVICE_URL`. Convert. May involve large file streaming → Pattern D? Verify during implementation. |
| `src/app/api/config/route.ts` | Currently uses `BACKEND_SERVICE_URL`. Convert. Pattern A. |

---

## 6. Test Matrix (`src/lib/api/server/__tests__/backend-proxy.test.ts`)

| # | Scenario | Expected |
|---|---|---|
| T1 | GET request, mocked backend returns 200 JSON | Helper returns 200 with same body |
| T2 | POST with JSON body | Helper forwards stringified JSON, content-type preserved |
| T3 | POST with FormData | Helper forwards multipart, content-type unset (browser sets) |
| T4 | Incoming `Authorization: Bearer xyz` | Helper forwards header to backend |
| T5 | Incoming `x-session-token: xyz` | Helper forwards header to backend |
| T6 | No incoming auth headers | Helper does NOT add fake headers; backend gets none |
| T7 | `forwardHeaders: ['x-request-id']` | Custom header forwarded |
| T8 | Backend returns 401 | Helper returns 401 with same body |
| T9 | Backend returns 500 with JSON body | Helper returns 500 with body intact |
| T10 | Backend returns non-JSON 500 (e.g., HTML) | Helper returns 500 with `error_code: BACKEND_ERROR` envelope |
| T11 | Backend timeout | Helper returns 504 with timeout envelope |
| T12 | Network error (fetch throws) | Helper returns 502 with network envelope |
| T13 | `streaming: true` and backend streams chunks | Helper streams without buffering (verify with `ReadableStream` mock) |
| T14 | `timeoutMs: 600_000` is respected | Long-running call does not abort prematurely |
| T15 | Query string forwarding for GET | Helper preserves `?foo=bar&baz=qux` |
| T16 | DELETE with body | Helper forwards body |
| T17 | Two parallel calls to the same route | Each gets its own AbortController, no cross-talk |
| T18 | Builder `BackendPath` form: `(p) => `/api/user/toggle-status/${p.userId}`` with `ctx.params = Promise.resolve({userId: 'abc'})` | Helper awaits params, resolves backend path to `.../api/user/toggle-status/abc` |
| T19 | Catch-all `[...path]` builder with `ctx.params = Promise.resolve({path: ['a','b','c.jpg']})` | Helper resolves backend path with segments joined by `/` |
| T20 | Static string `BackendPath` AND `ctx` undefined (non-dynamic route) | Helper uses the literal path, no params await |

---

## 7. Files to Create / Modify

| File | Action | LoC est |
|---|---|---|
| `src/lib/api/server/backend-proxy.ts` | Create | ~250 |
| `src/lib/api/server/__tests__/backend-proxy.test.ts` | Create (Vitest) | ~400 |
| `src/app/api/**/route.ts` | Modify (~90 files) | net **-2000** to **-3000** (mass simplification — most routes shrink from 20-30 lines to 2-3 lines) |
| `docs/plans/unified-api-auth-refactor/audit/route-sweep-audit.md` | Create — table of every route, classified by Pattern A-E + escape-hatch reasons | ~250 |

**Estimated total: helper +650, route changes net -2000 to -3000, audit +250 — net REDUCTION of frontend LoC by ~1500-2000 lines.**

This is the spec that produces the largest measurable improvement: a massive reduction in duplicated boilerplate.

---

## 8. Audit Deliverable (`route-sweep-audit.md`)

The implementer MUST produce a markdown file with one row per `src/app/api/**/route.ts` file:

| Route file | HTTP methods | Backend path | Pattern (A-E) | Auth required | Notes |
|---|---|---|---|---|---|
| `auth/login/route.ts` | POST | `/api/auth/login` | A | No | login entry point |
| `admin/users/list/route.ts` | GET | `/api/admin/users/list` | B | Yes (admin) | Authorization forwarded |
| `video-compose/route.ts` | POST | `/api/video/compose` | C | Yes | 600s timeout |
| ... | ... | ... | ... | ... | ... |

Plus a **summary** at the bottom:
- Total routes: N
- Pattern A: N
- Pattern B: N
- Pattern C: N
- Pattern D: N
- Pattern E (escape hatches): N (each with explicit reason)
- Lines removed: N
- Lines added: N

This audit is required for review by Reviewer + Tester agents in Phase 5.

---

## 9. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| Backend response has `Set-Cookie` header | Pass through unchanged. Cookies are not how this app does auth, but other middleware may set them |
| Backend response has `Content-Encoding: gzip` | Helper does NOT decompress; pass through `Content-Encoding` header so the browser handles it |
| Incoming request body is huge (file upload, hundreds of MB) | The helper streams via `req.formData()` for multipart. For very large uploads, Pattern D (streaming) is used |
| Backend response is empty (204) | Helper returns 204 with no body |
| Route handler is called for an HTTP method the backend doesn't support | Backend returns 405; helper forwards as-is |
| Path traversal: `backendPath = '../auth/login'` | Helper does NOT sanitize. The backendPath is hardcoded by the route file, not user-controlled. If a route accepts a backendPath fragment from query params (rare), it MUST sanitize it — flagged as Pattern E |
| Two backend env vars accidentally set with different values | S02 detection helper logs a warning. The proxy reads `backendConfig.baseUrl` (which is `BACKEND_URL`) — only that wins |

---

## 10. Coordination Notes for Other Agents

- **For S05 (lib/api refactor):** The Next.js routes' contract is unchanged (same paths, same body shapes, same status codes). S05 can proceed in parallel with the route sweep IF S04's helper is delivered first, OR S05 can wait until after S04 ships. Since S04 → S05 is a hard dependency in the orchestration graph, expect sequential execution.
- **For S06 (direct call migration):** New proxy routes for `intent-detection-service.ts`, `llm.ts`, `audioTranscription.ts` are created using the SAME helper. They follow Pattern A.
- **For S07 (testing):** Integration tests should hit a few representative routes through the helper to verify end-to-end auth forwarding. The helper itself is unit-tested with mocked fetch (T1-T17).
- **For S01 (backend middleware):** The middleware MUST be deployed before the route sweep is merged, otherwise routes that previously didn't forward Authorization will start sending it but the backend won't enforce it consistently. Since this is an atomic PR (D5), both ship together.

---

## 11. Out of Scope

- Renaming any route file or path (no `/api/v2/...` migrations)
- Adding new routes (S06 covers the 3 NEXT_PUBLIC migrations; otherwise no new routes here)
- OpenAPI schema generation
- Rate limiting or per-route quotas — handled by Nginx in front
- Audit logging of API calls — separate ticket
- Removing the legacy `x-session-token` header support — kept for backwards compat per master plan D8
