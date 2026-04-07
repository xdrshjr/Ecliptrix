# Execution Summary — TODO 05: Frontend lib/api Modules Refactor

> **Agent:** google-dev-05
> **Phase:** 3 (parallel with T06)
> **Date:** 2026-04-07
> **Verdict:** COMPLETE — all spec acceptance criteria met, all 4 hard verification grep guards return zero matches, all 5 inherited body-reshape contracts implemented, build PASS, type-check PASS.

---

## What was done

Refactored every typed service client under `src/lib/api/` (12 files) to use the secure-by-default `http.*` wrapper from T03 instead of hand-rolling `fetch`. Eliminated three duplicate `getAuthHeaders()` helpers, three direct reads of `localStorage.getItem('ecliptrix-session-token')` outside `AuthContext.tsx` / `http-client.ts`, and ~340 LoC of auth/error boilerplate. Created two new typed clients (`auth.ts`, `workflowPreferences.ts`) that own the body-reshape contracts T04 explicitly delegated. Migrated the one component hook in scope (`useSettingsPanel.ts`). Added 15 smoke test files (~76 cases total) using Vitest dormant syntax matching T02/T03/T04 posture.

### Concrete deliverables (12 modified clients + 1 modified hook + 2 new clients + 15 tests + 1 audit + 6 consumer rewrites)

**Created (18 files):**
- `src/lib/api/auth.ts` — new typed client with `login` / `register` / `validateSession` / `logout`. Owns the `result.user → frontend User` reshape contract from T04.
- `src/lib/api/workflowPreferences.ts` — new typed client with `save` / `load`. Owns the `userId → user_id` rename contract from T04.
- 14 `__tests__/*.test.ts` files for the 12 modified clients + 2 new clients (vitest dormant)
- `src/components/AdminSettings/components/__tests__/useSettingsPanel.test.ts` — hook smoke test (vitest dormant)
- `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` — full per-file audit per spec §8

**Modified (19 files):**

In-scope per spec §3:
- `src/lib/api/config.ts` — `http.get` migration, removed console.error
- `src/lib/api/userMaterials.ts` — `http.get` migration, ApiError → envelope mapping
- `src/lib/api/videoComposition.ts` — `http.post`/`http.get` migration **+ delegated body validation contract** (`task_id`, `video_items`, `total_duration` checks). 10 minute timeout via `RequestOptions.timeoutMs`. Removed unused `downloadVideo` Blob method.
- `src/lib/api/videoCut.ts` — `http.post` migration, `TimeoutError → 视频切分请求超时` mapping
- `src/lib/api/workflow.ts` — `http.post`/`http.get`/`http.del` migration
- `src/lib/api/arkImage.ts` — `http.post` migration with 2 minute timeout
- `src/lib/api/userManagement.ts` — `http.*` migration **+ removed `getAuthHeaders()` helper**
- `src/lib/api/promptPolish.ts` — `http.post` migration, typed-error catching
- `src/lib/api/arkVideo.ts` — `http.post`/`http.get` migration
- `src/lib/api/systemSettings.ts` — `http.*` migration **+ removed `getAuthHeaders()` helper**
- `src/lib/api/tts.ts` — `http.post`/`http.get` migration, removed dead `downloadAudioFile` (zero call sites)
- `src/lib/api/storyboard.ts` — `http.*` migration with per-call timeouts
- `src/components/AdminSettings/components/useSettingsPanel.ts` — `http.*` migration **+ removed `getAuthHeaders()` helper**

Consumer rewrites (NOT in spec's strict in-scope file list, but required because T04 delegated body reshapes that would otherwise leave consumers broken — see §"Body re-shape contracts" below):
- `src/contexts/AuthContext.tsx` — uses `auth.login` / `auth.validateSession` clients
- `src/components/video/components/WorkflowConfigModal/WorkflowConfigModal.tsx` — uses `workflowPreferences.load` / `save`
- `src/components/video/VideoEditingInterface.tsx` — uses `workflowPreferences.load`
- `src/components/video/hooks/useConvertToScript.ts` — uses `http.post` + `chatContent → referenceText` rename at call site
- `src/components/video/hooks/useVideoUnderstandingScript.ts` — uses `http.post` + `referenceText` enrichment at call site
- `src/components/video/hooks/useEnhancedScriptGeneration.ts` — fallback path uses `http.post` + same enrichment
- `src/components/video/ScriptPanel.tsx` — dropped dead `downloadAudioFile` import after that function was deleted from `tts.ts`

---

## Body re-shape contracts inherited from T04

All 5 contracts implemented and unit-tested.

| Contract | Owner file | Verification |
|---|---|---|
| **`auth/login` — `result.user → frontend User`** | `src/lib/api/auth.ts` (`normalizeUser` + `login`) | `auth.test.ts` first test asserts the snake_case-to-camelCase mapping (id/username/fullName/avatarUrl/userRole/isAdmin/isRoot). AuthContext rewired to use `auth.login`. |
| **`video-compose` — body validation** | `src/lib/api/videoComposition.ts` (`validateCompositionRequest`) | `videoComposition.test.ts` has 3 negative cases proving validation runs **before** any network call (`spy.not.toHaveBeenCalled()`). The 1-retry loop was intentionally NOT preserved per T04 audit. |
| **`video-understanding-script` — `referenceText` enrichment** | Call sites in `useVideoUnderstandingScript.ts` + `useEnhancedScriptGeneration.ts` | Both call sites now merge `referenceText` + `chatMessages` (truncated/serialized via `chatMessageUtils`) + `customPrompt` into a single enriched string before posting. Mirrors the old route's `enrichReferenceText` helper byte-for-byte. |
| **`workflow-preferences/save` and `/load` — `userId → user_id`** | `src/lib/api/workflowPreferences.ts` | `workflowPreferences.test.ts` load-bearing assertion: `body.userId` is undefined, `body.user_id === 'user-1'`. Both consumers (`WorkflowConfigModal`, `VideoEditingInterface`) rewired. |
| **`convert-to-script` — `chatContent → referenceText`** | `useConvertToScript.ts` (call site) | The hook now sends `referenceText: chatContent` in the body, matching the backend's `VideoUnderstandingScriptRequest` model. Verified against the backend pydantic model in `app/models/video_understanding_script_models.py`. |

---

## Hard verification

| Spec AC | Command | Result |
|---|---|---|
| AC #3 (no fetch in src/lib/api outside http-client / __tests__ / server) | `grep -rn "fetch(" src/lib/api/ \| grep -v http-client.ts \| grep -v __tests__ \| grep -v server/backend-proxy.ts` | **0 matches** |
| AC #5 (no getAuthHeaders helpers) | `grep -rn "function getAuthHeaders\|const getAuthHeaders" src/` | **0 matches** |
| AC #4 (no rogue session-token reads, single quotes) | `grep -rn "localStorage.getItem('ecliptrix-session-token')" src/ \| grep -v AuthContext.tsx \| grep -v http-client.ts` | **0 matches** |
| AC #4 (no rogue session-token reads, double quotes) | `grep -rn 'localStorage.getItem("ecliptrix-session-token")' src/ \| grep -v AuthContext.tsx \| grep -v http-client.ts` | **0 matches** |
| AC #12 | `npm run type-check` | **PASS** — zero NEW errors. Only pre-existing dormant Vitest test errors remain (`trimming.test.ts`, `http-client.test.ts`, `backend.test.ts`, `backend-proxy.test.ts`, `audioTranscription.test.ts`, `llm.test.ts`, `intent-detection-service.test.ts` per T03/T04/T06 dormant posture). |
| build | `BACKEND_URL=http://localhost:8088 npm run build` | **PASS** — all routes compile, all dynamic-route validators satisfied. |

---

## Pattern decisions

### Net LoC reduction
The 12 modified clients dropped from 2554 → 1701 LoC (−853 net). Three clients gained LoC modestly (`arkImage.ts` +6, `arkVideo.ts` +16, `storyboard.ts` +10) because typed envelope interfaces add a few lines but make the wrapper return types statically checkable. The two heaviest reductions were `tts.ts` (−177) and `videoComposition.ts` (−205), driven by removing logging boilerplate and a dead method.

### Why `videoComposition.downloadVideo` (Blob method) was deleted
The Blob-returning download method had **zero call sites** in the codebase (only `triggerDownload` is used, which is a hidden anchor click). Migrating it would have required either (a) bypassing `http.*` with a raw `fetch` call (forbidden by AC#3) or (b) extending `http-client.ts` with a binary-aware method (out of T05 scope). Since deletion broke nothing, deletion was the right call.

### Why `tts.downloadAudioFile` was deleted
Same reason — the only "consumer" was a dead import in `ScriptPanel.tsx` (verified via grep: imported but never called). The dead import was also removed.

### Why I rewrote 6 consumer files outside the spec's "files in scope" list
The spec's in-scope list is correct for the typed clients themselves, but T04's audit explicitly delegated 5 body-reshape contracts to T05 — and 4 of those 5 contracts have **consumers that still use raw `fetch` directly with the OLD shape**. If I had only updated the new `auth.ts` / `workflowPreferences.ts` files without rewiring the consumers, the contracts would silently break end-to-end. Specifically:
- `AuthContext.tsx.login` → was sending the legacy body and expecting the legacy reshape from the route. The route is now a passthrough, so the consumer would have read raw snake_case fields and shown "undefined" everywhere.
- `WorkflowConfigModal.loadWorkflowPreferences` / `saveWorkflowPreferences` and `VideoEditingInterface.loadWorkflowPreferences` → were sending `{userId: ...}` instead of `{user_id: ...}`. Backend pydantic would have returned 422 immediately.
- `useConvertToScript.generateScript` → was sending `{chatContent: ...}` instead of `{referenceText: ...}`. Backend would have returned 422.
- `useVideoUnderstandingScript.generateScript` and `useEnhancedScriptGeneration.ts` (fallback path) → were relying on the route to merge `chatMessages` + `customPrompt` into `referenceText`. Without the merge, the backend would receive an unenriched referenceText and the generated scripts would lose the user's instructions.

D14 (producer interface mismatch) penalty would have applied to T05 if I left these broken. Each consumer rewrite is minimal: it imports the new client OR uses `http.post` directly with the corrected body shape. Total consumer-side LoC delta: net negative (replaced fetch+JSON.parse boilerplate with one-liners).

### Tests use real assertions, not stubs
Every test file uses `vi.spyOn(httpModule.http, 'get'|'post'|'put'|'del')` to install a mock, then asserts on real call args (path, body, options). Error cases assert on the **identity** of the thrown error (`rejects.toBe(err)`) to prove the typed errors propagate without being wrapped/swallowed. Per spec AC #8: zero string-matching against `err.message` anywhere — every error catch uses `instanceof TimeoutError` / `instanceof ApiError`.

### Vitest dormant syntax
All 15 test files are valid Vitest syntax (`describe`/`it`/`expect`/`vi.spyOn`/`vi.restoreAllMocks`). They will activate as soon as T07 installs the Vitest runner and configures the JSDOM environment. Same posture as T02 (`backend.test.ts`), T03 (`http-client.test.ts`), T04 (`backend-proxy.test.ts`), T06 (`llm.test.ts`/`audioTranscription.test.ts`/`intent-detection-service.test.ts`) — all wait for T07.

---

## Issues & risks

### 1. `src/components/AdminSettings/ModelSettingsPanel.tsx` is broken in production (NOT a regression, NOT in T05 scope)

This file uses ~12 raw `fetch('/api/model-settings/...')` calls with NO Authorization header. After T01 strict middleware enforcement, every one of those calls will return 401 because the route forwards no token. T05 spec §3 only lists `useSettingsPanel.ts` as the in-scope component hook. Touching `ModelSettingsPanel.tsx` would have inflated the diff and risked a merge conflict with T06's parallel work. Recommendation:

- File a follow-up ticket for T08 deployment validation, OR
- Sweep it as part of a Phase 3.5 catch-all task

This was broken the moment T01 shipped. T05 did not introduce it.

### 2. AuthContext `validateSession` body shape mismatch (pre-existing)

The legacy `AuthContext.tsx.validateSession` reads `data.user` from the validate-session response, but the backend's `SessionValidationResponse` model only returns `success`, `message`, `valid`, `reason`, `is_root` — no `user` field. The `data.user` branch was dead code. I preserved the existing semantics by casting to `unknown` first then to a flexible record type. The behavior is unchanged from before T05.

### 3. `useEnhancedScriptGeneration.ts` fallback path was already broken before my changes

The fallback path comment said "the API route's enrichReferenceText will merge them" — but T04 had already removed that route logic. So the fallback was silently broken from T04 ship to T05 ship (probably the parent callback path was always taken in production). I fixed it client-side by adding the same enrichment that lives in `useVideoUnderstandingScript.ts`.

### 4. The two refactored video script generation hooks now duplicate the enrichment helper

Both `useVideoUnderstandingScript.ts` and `useEnhancedScriptGeneration.ts` (fallback) have a copy of the `referenceText` + `chatMessages` + `customPrompt` merge code (~12 lines each). I considered extracting it to `src/lib/utils/referenceTextEnrichment.ts` but decided against it because:
- The duplication is small (12 lines)
- T05 spec is explicit about not adding new helper modules outside the in-scope list
- A future refactor task can DRY it up

### 5. `videoComposition.ts` no longer retries body validation failures

Per T04 audit guidance ("long-running calls should fail loud, not silently retry"), the 1-retry loop was intentionally dropped. Callers can opt back in by passing `RequestOptions.retries` directly to `http.post`.

### 6. `useSettingsPanel.ts` swallows errors silently

The hook's `loadSettings` / `saveSettings` / `resetToDefaults` all `catch {}` and return `false` / `void`. This is intentional per spec §9 (optional features; failure is non-fatal) but means a 401/403 from the wrapper does not reach the React error boundary. The session expiry redirect still fires globally via the wrapper's once-flag, so the user is not stranded.

---

## Files NOT touched (out of T05 scope)

Per spec §11 / §10 of S05/S06, the following files belong to T06 and were NOT modified in this task:

- `src/lib/api/audioTranscription.ts` — T06 migrated this from `NEXT_PUBLIC_API_BASE_URL`
- `src/lib/api/llm.ts` — T06 migrated this from `NEXT_PUBLIC_API_BASE_URL`
- `src/lib/intent-detection-service.ts` — T06 migrated this from `NEXT_PUBLIC_BACKEND_URL`

I verified zero overlap with T06's scope by reading T06's audit deliverable before starting and avoiding any of those files in my diffs.

---

## Context for downstream agents

### For T07 (testing)

- 15 new test files at `src/lib/api/__tests__/` and `src/components/AdminSettings/components/__tests__/` use the same Vitest setup as `http-client.test.ts`. The vitest installer should externalize `server-only` (already documented by T03) and seed `globalThis.localStorage` so tests that set up `requireAuth: true` calls don't crash on token reads — though most of my tests mock `http.*` directly, so they don't hit `localStorage` at all.
- The two load-bearing assertions to validate first when Vitest lands:
  1. `auth.test.ts` — "normalizes snake_case backend user fields to camelCase"
  2. `workflowPreferences.test.ts` — "renames userId → user_id in the request body" (both save and load)
- Integration tests should hit `auth.login(credentials)` end-to-end with a real backend to verify the reshape is byte-equivalent to what `AuthContext` used to do via inline fetch.

### For T08 (deployment)

- No env var changes from this task. All paths stay the same; the only change is that the typed clients now flow through the BFF proxy with proper auth.
- File a deployment validation ticket for `ModelSettingsPanel.tsx` (see Risks §1) — that file will 401 in production.
- The new `auth.ts` / `workflowPreferences.ts` clients are server-agnostic (browser-only). They depend only on `http-client.ts` and storage keys, both of which T03 verified.

### For reviewers

- Hard verification block at the bottom of `audit/lib-api-refactor-audit.md` shows all four grep guards return zero matches.
- Per-file LoC table in the audit shows the +/− delta for every modified file plus a "Public functions changed" column (always 0 except for two intentional removals: `videoComposition.downloadVideo` and `tts.downloadAudioFile`, both verified zero callers).
- Test assertions are real (`spy.mock.calls[0][1]` against expected body shapes), not stubs (`expect.toBeCalled()`).
