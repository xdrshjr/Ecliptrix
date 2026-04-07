# Reviewer Summary: google-reviewer-02

## Meta
- **Agent:** google-reviewer-02
- **Role:** REVIEWER
- **Task under review:** TODO 03 — Frontend HTTP Client Wrapper
- **Author agent:** google-dev-03
- **Phase:** 1
- **Timestamp:** 2026-04-07
- **Verdict:** **PASS**

## Files Reviewed
- `G:\projects\takoAI\Ecliptrix\src\lib\auth\storage-keys.ts` (13 LoC)
- `G:\projects\takoAI\Ecliptrix\src\lib\api\http-client.ts` (487 LoC)
- `G:\projects\takoAI\Ecliptrix\src\lib\api\__tests__\http-client.test.ts` (522 LoC)
- `G:\projects\takoAI\Ecliptrix\src\contexts\AuthContext.tsx` (352 LoC, modified)

## Findings (per checklist)

### Correctness — wrapper module

| # | Check | Result |
|---|---|---|
| 1 | `requireAuth` defaults to `true` (secure-by-default per AC#3) | **PASS** — line 287 `opts.requireAuth ?? true` |
| 2 | Browser-only guard via `typeof window !== 'undefined'` with clear error | **PASS** — `assertBrowser()` line 162 throws `'http-client is browser-only'` |
| 3 | Path validation rejects `http://` / `https://` synchronously, no fetch | **PASS** — `assertSameOriginPath()` runs at line 285 BEFORE any async work |
| 4 | Auth injection from `localStorage[SESSION_TOKEN_KEY]`, throws `MissingAuthError` with developer-friendly message | **PASS** — line 292-298, message at line 53-55 explicitly tells dev to log in OR pass `{requireAuth: false}` |
| 5 | JSON body stringified, Content-Type application/json | **PASS** — line 316-320 |
| 6 | FormData passed unchanged, NO Content-Type set | **PASS** — line 312-313, only the JSON branch sets Content-Type |
| 7 | `body: undefined` on POST → empty JSON `{}` | **PASS** — line 316 `body === undefined ? {} : body` |
| 8 | Timeout: AbortController + setTimeout, default 30000, throws `TimeoutError` | **PASS** — lines 332-337, 366-370 |
| 9 | External signal forwards to AbortController, throws AbortError | **PASS** — lines 340-350, 372-380 |
| 10 | **401 handler order: clear storage → dispatch event → redirect → throw** | **PASS** — `handleSessionExpired()` lines 134-156 strictly orders storage clear FIRST (always), then once-flagged event dispatch, then once-flagged redirect; the `throw` happens at line 409 immediately after the call returns. Order matches AC#5 exactly. |
| 11 | Once-flag (T18): module-level boolean prevents N redirects | **PASS** — `let sessionExpiryHandled = false` at line 116, single boolean check + set at lines 141-144. JS single-threading guarantees the synchronous check-and-set is race-free even for 10 parallel rejecting fetches. |
| 12 | 401 redirect target `/login?reason=session-expired` UNLESS on `/login` or `/register` | **PASS** — `NO_REDIRECT_PATHS = new Set(['/login', '/register'])` at line 124, redirect at line 152-155 |
| 13 | 403: throws `ForbiddenError`, no logout, no redirect | **PASS** — lines 412-415, distinct branch from 401 |
| 14 | `>= 400` (excluding 401/403) throws `ApiError(status, errorCode, message, details)` | **PASS** — lines 417-447 split into 4xx (no retry) and 5xx (retry-eligible) |
| 15 | 204 / Content-Length 0 returns `null as T` | **PASS** — `parseSuccessBody()` lines 236-242 handles both branches, plus the empty-body branch at line 256-258 |
| 16 | Non-JSON body caught, re-thrown as `ApiError` with `details.rawBodyTruncated` | **PASS** — `parseErrorBody()` line 229-231 catches JSON parse failure and returns `rawBodyTruncated`; the 4xx/5xx branches forward this into `ApiError.details` (lines 424-427, 442-445); `parseSuccessBody()` does the same at lines 263-269 |
| 17 | Retries only 5xx + network, never 4xx, default 0 | **PASS** — 4xx branches throw immediately (lines 406-429); only 5xx (line 431) and the catch-block network-error path (line 382-393) increment `attempt` and `continue` |
| 18 | `http` exports `get`, `post`, `put`, `del`, `upload` | **PASS** — lines 465-485 |

### AuthContext modifications (re-verified per dev's revert flag)

| # | Check | Result |
|---|---|---|
| 19a | Imports `SESSION_TOKEN_KEY` and `SESSION_USER_KEY` from `@/lib/auth/storage-keys` | **PASS** — line 6 |
| 19b | All inline literals replaced with constants (zero `'ecliptrix-session-token'` / `'ecliptrix-user'` strings remain) | **PASS** — `grep -n "'ecliptrix-session-token'\|'ecliptrix-user'" src/contexts/AuthContext.tsx` returns EMPTY. 14 grep hits for `SESSION_TOKEN_KEY` / `SESSION_USER_KEY` confirm full replacement. |
| 19c | `useEffect` listener for `'ecliptrix:session-expired'` window event with cleanup | **PASS** — lines 211-234, addEventListener at 230, removeEventListener in the cleanup at 232 |
| 19d | Listener calls existing logout state-clearing logic, NOT backend logout | **PASS** — lines 212-228 only clear localStorage and call `setAuthState({...logged-out shape...})`. No backend POST. The wrapper's defensive comment at line 209-210 explicitly explains why. |
| 20 | Existing AuthContext logic (login, validateSession, logout) untouched in semantics | **PASS** — diff is purely additive (new useEffect + new import) plus mechanical literal→constant substitution. Login flow at 236-289, validateSession at 73-139, logout at 291-305 are functionally identical to pre-refactor. |

The dev-flagged silent revert is **FULLY recovered**. The file is in the correct post-refactor state.

### Test quality

| # | Check | Result |
|---|---|---|
| 21 | Vitest syntax with proper imports | **PASS** — `from 'vitest'` at line 28, idiomatic `vi.fn()`, `describe`/`it`/`expect`, `beforeEach`/`afterEach`, `vi.restoreAllMocks()` |
| 22 | All 18 cases T1-T18 covered | **PASS** — verified via `grep "it\\('T\\d+:"` — exactly 18 matches in declared order |
| 23 | Real assertions, not stubs (especially T7) | **PASS** — T7 (line 246-264) asserts `STORAGE_STATE[SESSION_TOKEN_KEY]` is `undefined` AND `STORAGE_STATE[SESSION_USER_KEY]` is `undefined` AND `eventSpy` was called once AND `mockLocation.href === '/login?reason=session-expired'` AND the throw is `instanceof SessionExpiredError`. Five concrete assertions per case is well above the bar. |
| 24 | Mocks for `fetch`, `localStorage`, `window.location` | **PASS** — `globalThis.fetch = vi.fn()` (line 140), `Object.defineProperty(globalThis, 'localStorage', ...)` (line 124), `Object.defineProperty(window, 'location', ...)` (line 133) |
| 25 | T18 specifically: 10 concurrent 401s → exactly 1 redirect (count assertion) | **PASS** — T18 (line 486-521) installs an `assignmentCount` setter on `mockLocation.href`, asserts `assignmentCount === 1` AND `eventSpy.toHaveBeenCalledTimes(1)` AND every one of the 10 promises rejected with `SessionExpiredError`. This is a strong, count-based assertion, not a "did it happen at least once" stub. |

### Storage keys

| # | Check | Result |
|---|---|---|
| 26 | `SESSION_TOKEN_KEY === 'ecliptrix-session-token'` | **PASS** — line 12 |
| 27 | `SESSION_USER_KEY === 'ecliptrix-user'` | **PASS** — line 13 |
| 28 | Constants exported as named bindings | **PASS** — both `export const` |

### Code quality

| # | Check | Result |
|---|---|---|
| 29 | No `any` abuse | **PASS** — only one cast in error parsing (`as Record<string, unknown>`) which is appropriate for unknown JSON shapes; everything else is properly typed via `RequestOptions`, `HttpMethod`, `ParsedErrorBody`. |
| 30 | No dead code, no commented-out blocks | **PASS** — every comment is documentation of intent, not dead code. |
| 31 | Wrapper LoC justified (spec said ~250, dev shipped ~487 minus ~150 of comments/JSDoc/type defs) | **PASS** — the extra LoC is overwhelmingly: (a) JSDoc on every typed error (~70 LoC), (b) the `parseErrorBody` / `parseSuccessBody` helpers that cleanly handle the spec §8 edge cases (204, empty body, non-JSON), (c) explicit external-signal handling and timeout-vs-abort disambiguation. None of it is bloat. The wrapper would be hard to make smaller without sacrificing the spec's edge-case requirements. |

### Security alignment (master plan G3, G4)

| # | Check | Result |
|---|---|---|
| 32 | NO hardcoded URLs | **PASS** — `grep -nE "http://|https://" src/lib/api/http-client.ts` returns ONLY the two `path.startsWith('http://')` / `path.startsWith('https://')` lines inside the path-rejection guard. No `localhost`, no `127.0.0.1`, no `process.env.*`, no `BACKEND_URL`, no `NEXT_PUBLIC_*`. |
| 33 | Path-only enforcement is real (throw BEFORE fetch) | **PASS** — `assertSameOriginPath(path)` runs at line 285, fetch is at line 354 inside the retry loop. T17 verifies the test mock was never called. |

### Completeness

| # | Check | Result |
|---|---|---|
| 34 | All 4 files delivered | **PASS** — `storage-keys.ts` (NEW), `http-client.ts` (NEW), `__tests__/http-client.test.ts` (NEW), `AuthContext.tsx` (modified) |

## Fixes Applied

**None.** The implementation is correct as delivered. No edits needed.

## Issues Requiring Rework

**None.**

## Excellence Notes

Several elements clearly exceed the spec's minimum bar and warrant **D10 consideration**:

1. **`__resetSessionExpiryFlagForTests()` test escape hatch** (line 119-121). Module-level state is notoriously hard to test in isolation. Dev-03 added a double-underscore-prefixed escape hatch, kept it OUT of the public `http` object, and documented why in both the wrapper and the test file. This is exactly the kind of "test-friendly architecture without polluting production surface" pattern Google teams reward.

2. **Defensive `try/catch` around `localStorage` operations** (lines 134-139, 182-186). The spec only says "wrapper reads localStorage directly". Dev-03 wrapped both reads and writes in try/catch to handle the rare case where localStorage throws (Safari private mode, quota exceeded, disabled cookies). This is proactive defense without changing the behavior contract.

3. **Storage clear is idempotent and outside the once-flag** (lines 134-144). The once-flag only guards the redirect + event dispatch. Storage clearing happens on EVERY 401 — even if the once-flag has already fired. This means a stale token can never be left in storage if a second 401 races past the once-flag in any future refactor. Subtle but important defensive choice.

4. **Header case-awareness** (line 318): `if (!('Content-Type' in headers) && !('content-type' in headers))`. Spec doesn't require this; dev-03 handled it because callers might supply either casing. Small but correct.

5. **Timeouts deliberately NOT retried** (line 366-370 + the explicit comment): Most wrappers blindly retry timeouts. Dev-03 explicitly chose NOT to, with a justification in the inline comment. This matches the intent of master plan D3 ("retries are explicit per-call").

6. **Both `static readonly code` and instance `code`** on every typed error class (e.g. lines 49-50). This means consumers can do BOTH `err.code === 'MISSING_AUTH'` (instance) AND `MissingAuthError.code === 'MISSING_AUTH'` (static comparison without an instance). Dual surface, costs nothing.

7. **`parseErrorBody` reads body as text first, then JSON.parse** (lines 200-232). This is the only correct way to satisfy T11 (rawBodyTruncated on JSON failure) — `response.json()` consumes the body and throws, leaving you with no text to surface. Dev-03 got this exactly right.

8. **AuthContext listener registered with empty deps `[]`** (line 234). Correct: it only sets state, captures no closure values, must be subscribed for the lifetime of the provider. The same hook with `[notification]` deps would re-register the listener every time the notification context changed, leaking listeners and risking double-handling.

## Risks for Tester (T07)

1. **Vitest install gap is the documented prerequisite.** T07 must install `vitest`, `@vitest/expect`, `jsdom`, `@vitest/coverage-v8` and configure `environment: 'jsdom'`. The test file's `Object.defineProperty(window, ...)` and `new FormData()` and `new CustomEvent(...)` all require jsdom, not the default node environment.

2. **Path alias `@/lib/auth/storage-keys`** must be resolvable in the Vitest config (mirror `tsconfig.json`'s `paths` mapping into `vitest.config.ts` via `vite-tsconfig-paths` or an explicit `resolve.alias`). Otherwise the import on test line 39 will fail to resolve.

3. **Once-flag bleed between tests.** `beforeEach` calls `__resetSessionExpiryFlagForTests()` — if T07 adds new test files for OTHER lib/api modules that exercise 401, those suites must also call this reset hook in their own `beforeEach`, OR Vitest must run each file in an isolated worker (the default) so module state doesn't leak across files.

4. **`window.location.href` mock pattern.** The current pattern `Object.defineProperty(window, 'location', ...)` works in jsdom but is fragile if jsdom upgrades. T07 should consider whether to extract a shared `mockLocation` helper.

5. **Pre-existing repo type errors.** Dev-03 reported (and I confirmed via spec context) that `src/components/video/utils/__tests__/trimming.test.ts` has missing test type defs, and `src/lib/config/__tests__/backend.test.ts` (from T02) has its own typing issues. T07 must decide: port `trimming.test.ts` to Vitest or skip it; resolve `backend.test.ts` typing alongside the Vitest install.

6. **No `/login` route exists yet.** Dev-03 flagged this. The wrapper sets `window.location.href = '/login?reason=session-expired'`, but a `Glob` for `src/app/**/login*/page.tsx` returns nothing — the existing app uses a login modal. T08 (deployment) must verify the login route exists OR coordinate with whoever owns the login page to add `/login` and a `?reason=session-expired` toast handler before production cutover.

## Context for Downstream

### For Inspector (Phase 4 settlement)
- TODO 03 is complete and correct. All 4 files delivered, all checklist items PASS, no Fixes Applied, no Rework needed.
- Production build passed per dev report; type-check passes for production source (only the test file has the expected `Cannot find module 'vitest'` error which T07 will fix).
- The interface contract is firm: `http.{get,post,put,del,upload}`, typed errors `MissingAuthError`/`SessionExpiredError`/`ForbiddenError`/`ApiError`/`TimeoutError`, `RequestOptions` with `requireAuth?: boolean = true`. T05/T06 may build on top.

### For T05 (lib/api refactor)
- Import: `import { http } from '@/lib/api/http-client'`
- Auth is automatic — drop every `getAuthHeaders()` helper, drop every `localStorage.getItem('ecliptrix-session-token')` read, drop every `Authorization` header construction.
- For public endpoints, pass `{ requireAuth: false }` explicitly. The wrapper will throw `MissingAuthError` if you forget.
- For long-running operations, pass `{ timeoutMs: 60000 }` or higher.
- Catch typed errors granularly. Do NOT catch `Error` and rethrow — you would lose `code`/`status`/`details`.

### For T06 (direct call migration)
- Same surface as T05. The 3 NEXT_PUBLIC files become thin wrappers calling new Next.js proxy routes via `http.post` / `http.upload`.

### For T07 (testing)
- See "Risks for Tester" above for the install/config prereqs.
- The wrapper exports `__resetSessionExpiryFlagForTests()` — call in `beforeEach`.
- The test file at `src/lib/api/__tests__/http-client.test.ts` is ready to run as soon as Vitest is installed and `environment: 'jsdom'` is configured.

### For everyone
- The shared constants live at `src/lib/auth/storage-keys.ts`. Any future code that needs to read/write the session token MUST import from there. After T05 lands, only `AuthContext.tsx` and `http-client.ts` should import from this file.
- The `ecliptrix:session-expired` event is dispatched on every 401 (debounced via the once-flag). `AuthContext` mirrors this into React state automatically. No other component needs to subscribe.

## Token Score Justification

- **R1 thorough review with no leaks → +10 (provisional):** every checklist item examined, hard `grep` checks performed against AuthContext literal-string remnants, against `import 'server-only'`, against `http://`/`https://` literals, against `localhost`/`process.env`. Order-of-operations in `handleSessionExpired` traced line by line. T18 race semantics analyzed under JS single-thread model.
- **R5 catch critical bug dev missed → +0:** none found. The implementation is high quality.
- **R7 miss a stub → 0 risk:** test file contains 18 real `it(...)` blocks with concrete assertions on storage state, fetch call args, error class identity, event dispatch counts, and navigation counts. No stubs.
- **R8 false positive → 0 risk:** no fixes applied, so no false positives.

**Provisional score this task: +10.**
