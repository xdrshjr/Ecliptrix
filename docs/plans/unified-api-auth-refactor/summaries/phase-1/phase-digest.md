# Phase 1 Digest

## Completed Tasks

| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|---|---|---|---|---|
| TODO 01 — Backend Auth Middleware | google-dev-01 | PASS | ALL PASS | `app/middleware/auth_middleware.py` (247 LoC) + `get_current_user` fast path + 19 tests / 98% coverage / 43 assertions + 115-endpoint audit |
| TODO 02 — BACKEND_URL Config Module | google-dev-02 | PASS | ALL PASS | `src/lib/config/backend.ts` (130 LoC, server-only, throws fast) + 17 Vitest cases + `next.config.js` legacy check inlined |
| TODO 03 — Frontend HTTP Wrapper | google-dev-03 | PASS | ALL PASS | `src/lib/api/http-client.ts` (487 LoC) + `storage-keys.ts` + 18 Vitest cases + AuthContext migrated to constants + `ecliptrix:session-expired` listener wired |

## Key Decisions

- **Backend middleware LIFO order**: `add_middleware(SessionAuthMiddleware)` BEFORE `add_middleware(CORSMiddleware)` so that CORS ends up outermost (Starlette LIFO semantics). Verified at `main.py` lines 145 and 148.
- **Error code reuse**: Middleware uses the existing `UNAUTHORIZED` and `ACCOUNT_DISABLED` codes from `dependencies/auth.py`, NOT new ones. Frontend wrapper is agnostic to the specific code values — it branches on HTTP status only. Cross-spec contract holds.
- **Spec bug catch (D10)**: Spec §5 contradicted AC#8 by requiring the test-mode error message to literally contain `'http://localhost:8000'` while AC#8 forbade that string anywhere in the module. Dev-02 surfaced the conflict, substituted `:8088`, orchestrator ratified and updated the spec.
- **Once-flag for parallel 401s**: `http-client.ts` uses a module-level boolean `sessionExpiryHandled` so 10 concurrent 401-returning requests cause exactly ONE redirect, not 10. Storage-clear is idempotent and OUTSIDE the once-flag for defensive correctness.
- **`server-only` package added** to `package.json` dependencies for `backend.ts` enforcement (prevents accidental client imports).
- **Storage keys constants**: `SESSION_TOKEN_KEY` and `SESSION_USER_KEY` extracted to `src/lib/auth/storage-keys.ts`. AuthContext (14 hits) and http-client (4 hits) both consume the same constants — the canonical source of truth.

## Interfaces Established

- **`SessionAuthMiddleware`** registered in `app/main.py` → intercepts every HTTP request, populates `request.state.user` for authenticated paths, returns 401/403 for non-allowlisted requests without valid token. Allowlist contains 8 exact + 2 prefix entries matching spec §4 byte-for-byte.
- **`get_current_user`** in `app/dependencies/auth.py` now reads `request.state.user` first (fast path), falls back to DB lookup if state is unset (e.g., direct unit tests). `require_admin` and `require_root` unchanged — they delegate to `get_current_user`. **Contract status: verified by tester** (43 assertions across 19 tests).
- **`backendConfig`** from `@/lib/config/backend` exposes `{ baseUrl: string, joinPath(path: string): string }`. Frozen object. Throws fast on missing or malformed `BACKEND_URL`. Consumed by T04 (routes sweep) and T06 (proxy migration). **Contract status: verified by tester** (20-assertion sandbox).
- **`http`** from `@/lib/api/http-client` exposes `{ get, post, put, del, upload }` plus typed errors (`MissingAuthError`, `SessionExpiredError`, `ForbiddenError`, `ApiError`, `TimeoutError`). Auto-injects Authorization, handles 401 → logout redirect, secure-by-default (`requireAuth: true`). Consumed by T05 and T06. **Contract status: verified by tester** (15 grep + 18/18 test traceability).
- **`ecliptrix:session-expired`** window event dispatched by `http-client.ts` on 401, listened by `AuthContext.tsx` `useEffect` → mirrors logout state into React. Idempotent storage clear + once-flag debounce.
- **`SESSION_TOKEN_KEY` / `SESSION_USER_KEY`** constants from `@/lib/auth/storage-keys` consumed by AuthContext and http-client. No literal storage key strings remain in either consumer.

## Issues Resolved

- Spec §5 vs AC#8 contradiction (BACKEND_URL config) — fixed in spec
- AuthContext silently reverted mid-session due to git stash race — dev-03 detected and re-applied; reviewer re-verified
- Pre-existing 96 backend test failures verified UNRELATED to T01 (dev-01 stashed and re-ran to confirm baseline)
- `git stash@{0}` left in working tree from dev-02's recovery operation — confirmed no data loss for T01/T03 by reviewer

## Risks Carried Forward to Phase 2+

1. **`/login` page does not exist** in `src/app/login/` — wrapper redirects to `/login?reason=session-expired` per spec but users would hit 404 today. **T08 deployment playbook owns** creating the page or adding a rewrite before production deploy.
2. **Vitest is NOT installed yet** — all frontend test files (T02, T03 tests) are dormant Vitest syntax. **T07 owns** the runner installation. Pre-existing repo type errors in `trimming.test.ts` will surface during T07.
3. **`server-only` must be externalized or stubbed** in `vitest.config.ts` (T07). Currently the module body works in Node sandbox only with the `import 'server-only'` line stripped.
4. **Audit deferred flags F1-F4** from T01 are routes/admin items deferred to T04 (routes sweep): `/api/auth/health` duplicate, `/api/config` version exposure, `model_settings_router` provider CRUD, `/api/storage/files/` mount.
5. **3 NEXT_PUBLIC files + 14+ lib/api files still need raw fetch removal** — T05 and T06 own this. AC#3 / AC#4 / AC#5 grep checks WILL still show matches today; that's expected pre-T05/T06.

## Phase 1 Token Report

| Agent | Role | Final | Delta |
|---|---|---|---|
| google-dev-01 | DEV | 155 | +55 |
| google-dev-02 | DEV | 155 | +55 |
| google-dev-03 | DEV | 155 | +55 |
| google-reviewer-01 | REV | 125 | +25 |
| google-tester-01 | TEST | 125 | +25 |
| google-reviewer-02 | REV | 115 | +15 |
| google-tester-02 | TEST | 115 | +15 |
| google-dev-04..08 | DEV | 105 | +5 (collective C1) |

All escrows confirmed. Zero penalties. Three D10 excellence awards. Zero eliminations.

## Context for Next Phase (T04 — Routes Sweep)

Phase 2 launches **T04: Next.js Routes Sweep** as a single-agent (dev-04) effort. The dev agent inherits a clean Phase 1 foundation: backend middleware will reject any non-allowlisted request without `Authorization` header, the centralized `backendConfig` is ready to import, and the frontend wrapper exists for downstream consumption. T04's job is to refactor ~90 `src/app/api/**/route.ts` files to use `backendConfig.baseUrl` (not `process.env.BACKEND_URL`) and to forward `Authorization` headers via the new `createPassthroughRoute` helper. T04 must also classify each route into Pattern A-E and produce an audit at `audit/route-sweep-audit.md`. The bottleneck of the entire project lives here — single-agent ownership of ~90 file edits — so dev-04 should expect to be the longest-running agent in the project.
