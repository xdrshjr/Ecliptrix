# Global Execution Context: unified-api-auth-refactor

Accumulated context from all execution phases. Each agent MUST read this
file before starting work to understand the full project history.

---

## Phase 1 — completed 2026-04-07

### Completed Tasks
- T01 (google-dev-01): Backend Auth Middleware + Allowlist — PASS / ALL PASS
- T02 (google-dev-02): BACKEND_URL Config Module — PASS / ALL PASS
- T03 (google-dev-03): Frontend HTTP Client Wrapper — PASS / ALL PASS

### Key Decisions
- LIFO middleware ordering: `add_middleware(SessionAuthMiddleware)` before `add_middleware(CORSMiddleware)` so CORS is outermost
- Backend uses existing `UNAUTHORIZED` / `ACCOUNT_DISABLED` error codes (no invented codes)
- Frontend HTTP wrapper is HTTP-status-driven, agnostic to specific error_code values
- Spec §5 vs AC#8 contradiction in S02 fixed: test-mode example uses `:8088` (production port), `localhost:8000` literal forbidden anywhere in `backend.ts`
- Storage keys extracted to `src/lib/auth/storage-keys.ts` — single source of truth shared by AuthContext and http-client
- Once-flag debounces parallel 401s into a single redirect

### Interfaces Established
- `SessionAuthMiddleware` (registered in main.py) → populates `request.state.user`, returns 401/403 for non-allowlisted
- `get_current_user` reads `request.state.user` fast path, DB-fallback on miss
- `backendConfig` from `@/lib/config/backend` → `{ baseUrl, joinPath }`, frozen, fail-fast on missing BACKEND_URL — consumed by T04 / T06
- `http.{get,post,put,del,upload}` from `@/lib/api/http-client` + typed errors → consumed by T05 / T06
- `ecliptrix:session-expired` window event → dispatched by http-client, listened by AuthContext
- `SESSION_TOKEN_KEY` / `SESSION_USER_KEY` constants from `@/lib/auth/storage-keys`

### Risks Carried Forward
- `/login` page does NOT exist yet — wrapper redirects there but route is 404. **T08 owns**
- Vitest not installed (T07 owns) — all frontend test files are dormant valid syntax
- `server-only` must be externalized in vitest.config.ts (T07)
- 4 audit-deferred flags (F1-F4) from T01 land in T04: `/api/auth/health` dup, `/api/config` version exposure, model_settings_router admin tightening, `/api/storage/files/` mount
- Pre-existing 96 backend test failures unrelated to this refactor — do NOT attribute to future agents

### Context for Next Phase
T04 (dev-04) sweeps ~90 `src/app/api/**/route.ts` files using the `backendConfig.baseUrl` from T02 and forwarding `Authorization` headers (which the T01 middleware now strictly enforces). dev-04 must classify every route as Pattern A-E from spec §4, hard-cap escape hatches (Pattern E) at 5 routes total, and use the dynamic-route builder form for any file under `[*]` segments. The post-sweep grep `process.env.BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL` over `src/app/api/` MUST return zero matches.

Final Phase 1 token state: 3 dev agents at 155, 2 reviewers at 115-125, 2 testers at 115-125, remaining 5 dev agents at 105 (collective C1 bonus). Zero eliminations, zero penalties.

---

## Phase 2 — completed 2026-04-07

### Completed Tasks
- T04 (google-dev-04): Next.js Routes Layer Sweep — PASS / ALL PASS — **81 files refactored, net −6614 LoC**

### Key Decisions
- `createPassthroughRoute(backendPath, opts?)` is the canonical entry for plain proxies, returns `(req, ctx)` handlers compatible with Next.js 15 dynamic routes
- Pattern distribution final: A=44, B=9, C=22, D=2, E=4
- Pattern E hard cap = 5, used 4. Each escape hatch documented with `// SWEEP-EXCEPTION:` and reason
- `responseHeaderAllowlist` helper extension (~12 LoC) added so `storage/files/[...path]` could use the helper instead of being a 5th escape hatch
- Dynamic route builder form: `BackendPath = string | (params) => string`. Three patterns observed: suffix, mid-path with rename (note `users → user` for `/api/admin/users/[userId]/toggle-status`), catch-all
- Body re-shape contracts delegated to T05 for: `auth/login` (transformedUser), `video-compose` (validation+retry), `video-understanding-script` (referenceText), `workflow-preferences/save` (userId→user_id), `convert-to-script` (chatContent)
- Next.js 15 strict route validators require `RouteContext.params: Promise<...>` (not optional)

### Interfaces Established
- `backendProxy.{get,post,put,del}(req, backendPath, ctx?, opts?)` from `@/lib/api/server/backend-proxy` — server-only, dumb pipe, auto-forwards Authorization + x-session-token
- `createPassthroughRoute(backendPath, opts?)` returns `{GET, POST, PUT, DELETE}` handlers
- `BackendPath = string | (params) => string`

### Risks Carried Forward
- **T05 owes body re-shape contracts** for 5 routes: login, video-compose, video-understanding-script, workflow-preferences/save, convert-to-script. T05 must own these in `auth.ts`/`videoComposition.ts`/`workflow.ts`/`workflowPreferences.ts` clients OR backend must accept legacy shapes. Critical inheritance.
- T07 must integration-test the 4 Pattern E routes (chat, storage/files Range, video-editing-agent SSE, video/analyze upload-then-analyze)
- OPTIONS preflight handlers dropped from a few routes — verify Next.js auto-synthesizes via Nginx
- `/login` page still missing (carried from Phase 1) — T08 owns
- Vitest still not installed (carried from Phase 1) — T07 owns

### Context for Next Phase
T05 + T06 launch in parallel. T05 owns 14 existing `lib/api/*.ts` clients (minus 3 NEXT_PUBLIC files) + `useSettingsPanel.ts` hook + 2 new clients (`auth.ts`, `workflowPreferences.ts`). T06 owns 3 NEXT_PUBLIC files + 4 new proxy routes + 2 in-process consumer migrations. Disjoint scopes, no merge conflicts. **T05 must implement the delegated body re-shapes from T04** or runtime breaks.

Final Phase 2 token state: dev-04 leads at 165, dev-01/02/03 at 160 (each +5 from C1), reviewer-02/tester-02 at 130/135 (T04 review/test bonuses + C1), others at 110-130. Zero eliminations.

---

## Phase 3 — completed 2026-04-07

### Completed Tasks
- T05 (google-dev-05): Frontend lib/api Refactor — PASS / ALL PASS — 15 files refactored + 7 consumer rewires + all 5 T04 contracts implemented
- T06 (google-dev-06): Direct Browser Call Migration — PASS / ALL PASS — 4 new proxy routes + 3 client refactors + intent-detection consumer migration + Option A for audio transcription
- **Phase 3.5** (google-dev-05): ModelSettingsPanel Auth Fix — inline review/test — 12 fetch calls migrated to `http.*`

### Key Decisions
- `auth.ts` owns `normalizeUser` reshape (snake_case → camelCase) — the load-bearing T04 contract
- `workflowPreferences.ts` owns `userId → user_id` rename internally
- §4.3 Option A: `audioTranscription.ts` drops error envelope union, propagates `ApiError`
- AuthContext rewired through new `auth.ts` client; build error introduced and fixed within Phase 3
- ModelSettingsPanel pre-existing un-authed fetch bug surfaced by T01 strict middleware → fixed in Phase 3.5 (NOT T05 rework)
- 2 dead methods deleted after grep verification (`videoComposition.downloadVideo`, `tts.downloadAudioFile`)

### Interfaces Established
- `auth.{login, register, validateSession, logout}` from `@/lib/api/auth` — discriminated `LoginResult`, snake→camel reshape
- `workflowPreferences.{save, load}` from `@/lib/api/workflowPreferences` — internal key rename
- All 12 existing lib/api clients now use `http.*` (signatures preserved)
- All 4 new T06 proxy routes use `createPassthroughRoute` from T04
- `ModelSettingsPanel.tsx` consumes `http.*` for 12 model-settings calls

### Risks Carried Forward
- **Vitest still not installed** — ~72 dormant frontend test cases waiting for T07
- `/login` page still missing — T08 owns
- Pre-existing repo type errors in `trimming.test.ts` will surface in T07
- Pattern E routes need integration coverage in T07 (chat, storage/files Range, video-editing-agent SSE, video/analyze upload-then-analyze)
- Audit deferred flags F1-F4 from T01 — non-blocking

### Context for Next Phase
T07 single-agent task: install Vitest, configure runner, set up integration tests + smoke script. T07 must run all ~72 frontend dormant tests + 19 backend tests + write the integration suite + write `scripts/smoke-api-auth.sh` for T08.

Final Phase 3 token state: dev-05 leads at 180 (D10 triple — ModelSettingsPanel catch + AuthContext fix + 5 contracts), dev-04/dev-06 at 170, dev-01/02/03 at 165, testers at 150-155, reviewers at 145, dev-07/08 at 115 (collective bonuses only). Zero eliminations.

---

## Phase 4 — completed 2026-04-07

### Completed Tasks
- T07 (google-dev-07): Testing Suite — PASS / ALL PASS — Vitest installed, **150 tests / 0 failures** across 22 files, smoke script verified
- **Phase 4.5** (orchestrator inline): Created `src/app/login/page.tsx` to fix the `/login 404` risk that was carried from Phase 1

### Key Decisions
- Vitest 4.1.3 installed with `@vitest/coverage-v8`, `jsdom`, `@testing-library/jest-dom`
- `server-only` aliased to a stub in vitest.config.ts so T02's `backend.ts` imports cleanly in tests
- `setup.ts` pre-sets `BACKEND_URL=http://test-backend:8088` BEFORE imports run (Vitest ESM hoisting)
- 6 dormant test failures fixed via test-only changes (no production source modified) — verified by `git diff` empty
- Integration tests use 3-mode spawn helper: pre-running attach (default) / optional spawn behind `INTEGRATION_SPAWN=1` / clean skip on no backend. Spec §2.4 fallback authorized.
- Smoke script verified in BOTH pass-path (against mock: 26 passed) AND fail-path (against unreachable: exit 1)
- `/login` page created as a `Suspense`-wrapped client component that mounts the existing `LoginModal` in always-open state, redirects to `/` after authentication, displays a session-expired banner when `?reason=session-expired` is set

### Interfaces Established
- `npm test`, `npm run test:watch`, `npm run test:coverage`, `npm run test:integration` all wired
- `vitest.config.ts` + `vitest.integration.config.ts` + `src/test/setup.ts` + `src/test/server-only-stub.ts` all in place
- `tests/integration/helpers/{spawn-stack.ts, test-user.ts}` ready for future integration work
- `tests/integration/auth-flow.test.ts` (15 cases I1-I15) + `tests/integration/backend-proxy-integration.test.ts` ready
- `scripts/smoke-api-auth.sh` (24 protected endpoints, 3 phases, ANSI colors, env-aware credential phase) ready for T08
- `src/app/login/page.tsx` available — `/login?reason=session-expired` redirects no longer 404

### Coverage
- `src/lib/api/http-client.ts`: 87.01% (target ≥85%)
- `src/lib/api/server/backend-proxy.ts`: 85.00% (target ≥85% — exactly at threshold)
- `src/lib/config/backend.ts`: 100%
- `app/middleware/auth_middleware.py`: 98% (target ≥90%)

### Risks Carried Forward to Phase 5
- backend-proxy.ts coverage at exactly 85.00% has zero margin — any future edit risks tripping the gate
- Pre-existing `trimming.test.ts` excluded via `tsconfig.json` — documented in audit, unrelated to refactor
- `/api/chat` (Pattern E escape hatch) is NOT in the smoke script's protected list (not a defect — Pattern E is covered by unit tests, but T08 may want to add it post-deploy)

### Context for Next Phase
T08 launches as the final phase. Single-agent (dev-08) task that produces the deployment runbook AND executes (or simulates) the dry-run + production deploy. T08 inherits a fully tested + validated codebase with ALL acceptance criteria met:
- 81 routes refactored via Pattern A-E (T04)
- 12 lib/api clients + 2 new typed clients (T05)
- 3 NEXT_PUBLIC files migrated (T06)
- ModelSettingsPanel migrated (Phase 3.5)
- 150 frontend tests passing + 19 backend middleware tests passing (T07)
- Smoke script ready (T07)
- /login page exists (Phase 4.5)

T08's job is the deployment playbook: write the runbook, dry-run on dev server, deploy to Singapore-01 (47.245.126.128:8088 backend, :3088 frontend), run the smoke script, monitor 24h.

Final Phase 4 token state: dev-05 leads at 185, dev-04/06/07 tied at 175, dev-01/02/03 + tester-01 at 170, reviewer-01 + tester-02 at 160, reviewer-02 at 150, dev-08 at 120 (collective bonuses only — first task). Zero eliminations across 4 phases.

---
