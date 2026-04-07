# Agent Summary: google-dev-03

## Meta
- **Agent:** google-dev-03
- **Role:** DEV
- **Task:** TODO 03 — Frontend HTTP Client Wrapper
- **Phase:** 1
- **Timestamp:** 2026-04-07T00:00:00Z
- **Verdict:** COMPLETED

## Key Decisions

- **Once-flag implementation:** A module-level `let sessionExpiryHandled = false` flag guards the navigation + event-dispatch side-effects so that 10 parallel 401s produce a single redirect. localStorage is still cleared on every 401 (idempotent and cheap) so AuthContext can never be left out of sync.
- **Test-only escape hatch:** Exported `__resetSessionExpiryFlagForTests()` from `http-client.ts` so the Vitest suite can reset the once-flag between cases. The double-underscore prefix signals "do not use in production"; it is not surfaced through the `http` object.
- **Error class hierarchy:** Each typed error (`MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`, `TimeoutError`) extends `Error` and exposes BOTH a `static readonly code` and an instance `code` field, per spec §3 pseudocode. `SessionExpiredError` and `ForbiddenError` carry `status = 401` / `status = 403` so callers can distinguish via the same property surface as `ApiError`.
- **Body normalization:**
  - GET / DELETE never carry a body (the wrapper drops it even if a caller passes one — consistent with HTTP semantics).
  - FormData passes through verbatim with NO Content-Type so the browser sets the multipart boundary.
  - `body: undefined` on POST/PUT becomes `JSON.stringify({})` per spec §8 edge case.
  - Other bodies are JSON-stringified and Content-Type defaults to `application/json` (caller-supplied Content-Type is preserved).
- **Header reading is case-aware:** When checking whether the caller already supplied Content-Type, both `Content-Type` and `content-type` are inspected.
- **Path validation is synchronous:** Absolute `http://` / `https://` URLs throw BEFORE any async work (the spec requires no fetch to be issued for T17). The validation happens after `assertBrowser` so SSR-on-server checks fire first.
- **Timeout vs external abort:** Internally a single AbortController fans in BOTH the timeout and the caller's external signal. Timeouts surface as `TimeoutError` (caught via a `timedOut` flag); caller-driven aborts re-throw the native `AbortError` so consumer code can use idiomatic `error.name === 'AbortError'` checks.
- **Retry semantics:** Network errors and 5xx are retried up to `opts.retries` times (default 0). 4xx is NEVER retried. Timeouts are also NOT retried — by design — because they almost always indicate persistent latency, not transient blips, and silent retries make debugging harder.
- **Error parsing:** Error bodies are parsed via `text() + JSON.parse` (not `response.json()`) so that on parse failure we still have the raw body to surface as `details.rawBodyTruncated` (first 200 chars). This satisfies T11 cleanly.
- **AuthContext useEffect:** The new `ecliptrix:session-expired` listener is registered with empty deps (`[]`) — it only needs to set state, doesn't capture any closure values, and must be subscribed for the lifetime of the provider.

## Execution Flow

1. Read all required files: master-plan, task-orchestration, spec-03, todo-03, AuthContext, userManagement (reference only), tsconfig, CLAUDE.md.
2. Confirmed no peer summaries exist yet — dev-01 (T01) and dev-02 (T02) are running in parallel; no contract drift to reconcile. The shared-file warning about `AuthContext.tsx` is honored (only T03 modifies it in Phase 1).
3. Created `src/lib/auth/storage-keys.ts` with the two `as const` string constants.
4. Created `src/lib/api/http-client.ts` (~370 LoC including doc comments) implementing the full §3 / §3.1 contract: typed errors, browser-only guard, path validation, auth injection, body normalization, timeout + external signal, 401 once-flag handler, 403 handler, 4xx/5xx handlers, 204/empty handling, JSON parse failure handling, retry loop, and the `http` object surface.
5. Modified `src/contexts/AuthContext.tsx`:
   - Added `import { SESSION_TOKEN_KEY, SESSION_USER_KEY }`.
   - Replaced all 14 inline `'ecliptrix-session-token'` / `'ecliptrix-user'` literals with the constants.
   - Added a `useEffect` listener for `ecliptrix:session-expired` that defensively re-clears localStorage and resets `authState` to the logged-out shape.
   - **Note:** the file's earlier edits were silently reverted once during this session (likely an external linter or formatter race). I detected this via `Grep` and re-applied all edits.
6. Created `src/lib/api/__tests__/http-client.test.ts` (~410 LoC) with all 18 cases T1-T18 from spec §6. Each case uses real assertions on storage state, fetch call args, error class identity, and event dispatch / navigation count.
7. Ran `npm run type-check` — only one error in the new code: `Cannot find module 'vitest'` in the test file (documented gap, T07 will fix). All other type errors in the output are pre-existing (`trimming.test.ts`, `backend.test.ts` from T02).
8. Ran `npm run build` — `Compiled successfully in 10.0s`. The lone `[LocalAudioManager] 加载缓存元数据失败 ReferenceError: localStorage is not defined` warning during prerender is a pre-existing issue from a different module and is unrelated to this work.

## Artifacts

- **Created:**
  - `src/lib/auth/storage-keys.ts`
  - `src/lib/api/http-client.ts`
  - `src/lib/api/__tests__/http-client.test.ts`
- **Modified:**
  - `src/contexts/AuthContext.tsx`
- **Tests added:** 18 cases (T1-T18) in `http-client.test.ts`

## Interfaces Touched

- **Produces:** `http.{get,post,put,del,upload}` from `@/lib/api/http-client` — consumed by T05 and T06
- **Produces:** Typed errors `MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`, `TimeoutError` (each with `code` instance + `code` static + `Error` `name`) — consumed by T05 and T06
- **Produces:** `RequestOptions` interface with `requireAuth` (default `true`), `timeoutMs`, `signal`, `headers`, `retries` — consumed by T05 and T06
- **Produces:** Test-only `__resetSessionExpiryFlagForTests()` — consumed by T07's test runner
- **Produces:** `ecliptrix:session-expired` window CustomEvent — consumed by `AuthContext.tsx` useEffect (added in this same task)
- **Produces:** `SESSION_TOKEN_KEY`, `SESSION_USER_KEY` constants in `@/lib/auth/storage-keys` — consumed by `AuthContext.tsx`, `http-client.ts`, and (after T05) `userManagement.ts` / `systemSettings.ts` / `useSettingsPanel.ts`

## Test Results

- **Vitest:** NOT INSTALLED YET — `vitest` is not in `package.json` devDependencies. T07 owns Vitest setup. Tests are valid Vitest syntax (`vi.fn()`, `describe`/`it`/`expect`, `beforeEach`/`afterEach`, `vi.restoreAllMocks()`) and assert real values, not just `toBeCalled()`. Will run as soon as T07 lands.
- **type-check:** PASS for production source files (`http-client.ts`, `storage-keys.ts`, `AuthContext.tsx`). The only TS error attributable to this task is the expected `Cannot find module 'vitest'` in the test file, which the documentation gap covers. Other repo-wide type-check failures (`trimming.test.ts`, `backend.test.ts`) pre-exist and are NOT in scope.
- **build:** PASS. `Compiled successfully in 10.0s`. The full route table renders. No new runtime warnings introduced.

## Issues & Risks

- **`/login` page may not exist yet.** A `Glob` for `src/app/**/login*/page.tsx` returned no results. The wrapper still does `window.location.href = '/login?reason=session-expired'` per spec, but if no `/login` route exists at deploy time the user lands on a 404. This is the pre-existing application reality — login currently happens through a modal — and the spec acknowledges it ("existing /login page should already exist"). Flagged for T07 / T08 to verify before production deploy.
- **AuthContext file revert mid-session.** During this task, my AuthContext edits were silently reverted once (verified via Grep). I re-applied them. If a downstream reviewer sees missing constants in AuthContext.tsx, re-run the migration; root cause is likely an external file watcher or linter race in the harness, not the code.
- **Pre-existing repo-wide type errors.** `src/components/video/utils/__tests__/trimming.test.ts` is missing test type defs (Jest/Mocha never installed), and `src/lib/config/__tests__/backend.test.ts` (from T02) has its own `vitest` and `process.env` typing issues. Neither was caused by this task; both were observed at type-check time. Flagged for T07.
- **`fetch` typing in tests.** The test file casts `globalThis.fetch as unknown as typeof fetch` to install the mock, which is the standard Vitest idiom. T07 should ensure the test environment provides `FormData` natively (jsdom does) so the T5 case can construct one without polyfills.

## Context for Downstream

- **For T05 (lib/api refactor):** Every client must `import { http } from '@/lib/api/http-client'` and call `http.get/post/put/del/upload`. The wrapper auto-injects `Authorization: Bearer <token>` from localStorage and handles 401 globally. Drop every duplicate `getAuthHeaders()` helper, every `localStorage.getItem('ecliptrix-session-token')` read, and every `Authorization` header construction. If you need a non-default option (e.g. `requireAuth: false` for a public ping, or `timeoutMs: 60000` for a long-running compose), pass `RequestOptions` as the trailing argument. Use the typed errors (`MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`, `TimeoutError`) for granular catch blocks — DO NOT catch and rethrow as `Error` (you would lose `code` / `status` / `details`).
- **For T06 (direct call migration):** Same surface. The 3 NEXT_PUBLIC files become thin wrappers that call new Next.js proxy routes via `http.post` / `http.upload`. They must NOT bypass the wrapper (no raw `fetch` to `process.env.NEXT_PUBLIC_*`).
- **For T07 (testing):**
  - Install `vitest`, `@vitest/expect`, `jsdom`, `@vitest/coverage-v8`. Configure `environment: 'jsdom'` so `window`, `localStorage`, `FormData`, and `CustomEvent` are available natively.
  - The test file at `src/lib/api/__tests__/http-client.test.ts` REPLACES `globalThis.localStorage` and `window.location` per test; you may want a setup file to seed a default in-memory localStorage for OTHER suites that exercise `requireAuth: true`.
  - The wrapper exports `__resetSessionExpiryFlagForTests()` — call it in `beforeEach` to reset the once-flag between cases.
  - The pre-existing `src/components/video/utils/__tests__/trimming.test.ts` will need either Jest types added or a Vitest port — flag and decide during T07.
- **For AuthContext consumers:** The `ecliptrix:session-expired` event is now dispatched whenever any wrapper-mediated request gets 401. AuthContext mirrors this into React state. There is no need for any other component to listen — `useAuth().isAuthenticated` will flip to `false` automatically.
- **For the `/login` page:** Make sure the eventual `/login` route handles `?reason=session-expired` query param and shows a friendly "your session expired" toast. Currently no such page exists in `src/app/`; this is a known gap.
