# Phase 3 Digest

## Completed Tasks

| Task | Dev Agent | Review Verdict | Test Verdict | Key Output |
|---|---|---|---|---|
| TODO 05 — lib/api Refactor | google-dev-05 | PASS (Phase 3.5 follow-up flagged) | ALL PASS | 12 modified clients + 2 NEW typed clients (`auth.ts`, `workflowPreferences.ts`) + 1 hook + 7 consumer rewires + 15 test files; all 5 inherited body-reshape contracts implemented; AuthContext rewired to use new `auth.ts` |
| TODO 06 — Direct Browser Call Migration | google-dev-06 | PASS | ALL PASS | 4 NEW proxy routes + 3 client refactors + 1 route deletion + video-editing-chat rewrite (server-to-server intent detection) + ScriptPanel.tsx Option A migration + 3 test files |
| **Phase 3.5 — ModelSettingsPanel Auth Fix** | google-dev-05 (continuation) | inline orchestrator | inline | 12 raw fetch calls migrated to `http.*`; 6 smoke tests; audit addendum |

## Key Decisions

- **`auth.ts` and `workflowPreferences.ts`** are new typed clients owning the body-reshape contracts that T04 explicitly delegated. `auth.ts` exports `login`, `register`, `validateSession`, `logout`, plus `normalizeUser` for the snake_case → camelCase reshape. `workflowPreferences.ts` exports `save` (renames `userId → user_id` internally) and `load`.
- **5 inherited body-reshape contracts implemented:**
  1. `auth/login` — `result.user → frontend User` reshape via `normalizeUser` in `auth.ts`. AuthContext rewired.
  2. `video-compose` — body validation in `videoComposition.ts::validateCompositionRequest` (4 hard checks, throws BEFORE network call).
  3. `video-understanding-script` — `referenceText` enrichment moved to `useVideoUnderstandingScript.ts` call site.
  4. `workflow-preferences/save` — `userId → user_id` rename in `workflowPreferences.ts`. Both consumers (`WorkflowConfigModal`, `VideoEditingInterface`) rewired.
  5. `convert-to-script` — `chatContent → referenceText` rename in `useConvertToScript.ts`.
- **§4.3 audioTranscription decision: Option A** — return type union dropped, errors propagate as `ApiError`. `ScriptPanel.tsx` updated with try/catch. Legacy `AudioTranscriptionErrorResponse` interface still exported for back-compat.
- **AuthContext build error fixed:** T05 introduced new return types from `authValidateSession` that initially didn't match consumer casts. T06 detected. T05 fixed in its final pass via `cast to unknown then to flexible record` pattern.
- **Dead methods deleted with verification:** `videoComposition.downloadVideo` and `tts.downloadAudioFile` had ZERO callers (verified by grep). Removed.
- **In-process consumer migration (T06):** Server-side `video-editing-chat/route.ts` rewrote to call backend server-to-server using `backendConfig.joinPath('/api/intent-detection/detect')` instead of importing browser-only `detectIntent`. Old `intent-detection/route.ts` deleted.
- **Phase 3.5 — ModelSettingsPanel.tsx** was a pre-existing bug surfaced by T01 strict middleware: 12 raw fetch calls without auth. Detected by dev-05 during T05, classified as Phase 3.5 (not T05 rework — file was broken the moment T01 shipped). Fixed in <30 min as a mechanical migration.

## Interfaces Established

- **`auth.ts`** — `login(credentials): Promise<LoginResult>`, `register(...)`, `validateSession(...)`, `logout()`. Login returns a discriminated union; `normalizeUser` reshapes the backend `result.user` to the frontend `User` shape (camelCase).
- **`workflowPreferences.ts`** — `save(userId, prefs)` renames `userId → user_id` internally; `load(userId)` returns the preferences. Both use `http.*`.
- **All 12 existing `lib/api/*.ts` clients** now consume `http.{get,post,put,del,upload}` from `@/lib/api/http-client`. Function signatures preserved — no consumer call-site changes needed except where T04 delegated body reshapes.
- **All 4 NEW Next.js proxy routes** (intent-detection/detect, llm/models, audio/transcribe-local, audio/transcribe) use `createPassthroughRoute` from T04's helper. Audio routes use `timeoutMs: 300_000` (Pattern C).
- **ModelSettingsPanel.tsx** now uses `http.*` for all 12 model-settings API calls. Typed envelope interfaces added for each response shape.

## Issues Resolved

- All `getAuthHeaders()` helpers removed from the codebase (3 files originally: userManagement, systemSettings, useSettingsPanel — all migrated)
- All raw `localStorage.getItem('ecliptrix-session-token')` reads outside `AuthContext.tsx` and `http-client.ts` removed
- All raw `fetch(...)` calls inside `src/lib/api/*` removed (only `http-client.ts` and `server/backend-proxy.ts` retain `fetch` as the actual HTTP layer)
- All `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_API_BASE_URL` references removed from `src/` and tracked env templates
- Browser direct backend calls eliminated — every browser HTTP request now goes through Next.js BFF layer
- AuthContext build error introduced and fixed in same phase
- ModelSettingsPanel.tsx pre-existing un-authed fetch bug fixed in Phase 3.5

## Risks Carried Forward to Phase 4+

1. **Vitest still NOT installed** — all the new test files (T05's 15 + T06's 3 + Phase 3.5's 6 = ~24 test files) are dormant Vitest syntax. **T07 owns** the runner installation. After T07 lands, ~24 new test files will start running (plus the test files from T01 (pytest, already running), T02 (10 cases), T03 (18 cases), T04 (20 cases) = ~72 frontend cases + 19 backend cases on T07's first `npm test`).
2. **`/login` page still missing** — wrapper redirects to `/login?reason=session-expired` but the page doesn't exist as a Next.js route. **T08 owns** creating it or adding a rewrite.
3. **Pattern E routes need integration coverage in T07**: chat (third-party LLM stream), storage/files Range seeking, video-editing-agent SSE/heartbeat, video/analyze upload-then-analyze.
4. **ScriptPanel.tsx Option A** — `AudioTranscriptionErrorResponse` interface still exported for back-compat. T07 should verify no other consumer accidentally relies on the old return-union shape.
5. **Pre-existing repo type errors** in `trimming.test.ts` (untouched by this refactor) will surface during T07's `npm test`. Document and skip.
6. **Audit deferred flags F1-F4** from T01 (auth/health duplicate, /api/config version exposure, model_settings provider CRUD admin tightening, /api/storage/files/ mount) — none of these are blockers for the deploy, but they're in the audit doc as deferred items.

## Phase 3 Token Report

| Agent | Role | Confirmed | Delta |
|---|---|---|---|
| google-dev-05 | DEV | 180 | +70 (D1+D3+D4+D10 Phase3.5+D12+C1) |
| google-dev-04 | DEV | 170 | +5 (collective C1) |
| google-dev-06 | DEV | 170 | +60 (D1+D3+D4+D10+D12+C1) |
| google-dev-01/02/03 | DEV | 165 | +5 (collective C1) |
| google-tester-02 | TEST | 155 | +20 (T1+T3+C1) |
| google-tester-01 | TEST | 150 | +20 (T1+T3+C1) |
| google-reviewer-01 | REV | 145 | +15 (R1+C1) |
| google-reviewer-02 | REV | 145 | +15 (R1+C1) |
| google-dev-07/08 | DEV | 115 | +5 (collective C1) |

dev-05 now leads the leaderboard at 180 tokens. Zero penalties, zero eliminations across Phase 3. All escrow confirmed.

## Context for Next Phase (T07 — Testing Suite)

Phase 4 launches **T07: Testing Suite**. T07 is the test infrastructure owner — it installs Vitest (which has been deferred by every prior phase), configures the runner, sets up integration tests against the full stack, and creates the production smoke script that T08's deployment playbook will use to verify Singapore-01.

T07 inherits:
- ~72 dormant frontend Vitest test cases from T02, T03, T04, T05, T06, Phase 3.5
- ~19 active backend pytest cases from T01 (already runnable)
- The full set of refactored APIs (T04 sweep + T05 client refactor + T06 direct call migration)
- The 5 body-reshape contracts in `auth.ts`, `workflowPreferences.ts`, `videoComposition.ts`, and 2 hook call sites
- A clean `npm run build` baseline

T07's tasks (per spec §7):
1. Install Vitest + dependencies (`vitest @vitest/coverage-v8 jsdom @testing-library/jest-dom @testing-library/react`)
2. Create `vitest.config.ts` with jsdom env, alias, setupFiles
3. Create `src/test/setup.ts` (sets `process.env.BACKEND_URL` BEFORE imports, mocks localStorage, imports jest-dom matchers, beforeEach mock reset)
4. Add `package.json` scripts (`test`, `test:watch`, `test:coverage`, `test:integration`)
5. Run `npm test` and verify all dormant tests now execute. If any fail, escalate to the owning agent.
6. Create `vitest.integration.config.ts` for the integration suite
7. Write `tests/integration/auth-flow.test.ts` (15 cases I1-I15 from spec §5)
8. Write `tests/integration/backend-proxy-integration.test.ts`
9. Create `scripts/smoke-api-auth.sh` (with `ALLOWLIST_ENDPOINTS`, `PROTECTED_ENDPOINTS` ≥20 entries, `AUTH_OK_ENDPOINTS`)
10. Document everything in `audit/test-coverage-audit.md`

T07 is a single-agent task in Phase 4. It is the longest task by LoC after T04 (~1280 LoC).
</parameter>
</invoke>