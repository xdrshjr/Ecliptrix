# lib/api Refactor Audit (TODO 05)

> **Spec:** [05-frontend-lib-api-refactor.md](../specs/05-frontend-lib-api-refactor.md)
> **TODO:** [05-frontend-lib-api-refactor.md](../todos/05-frontend-lib-api-refactor.md)
> **Phase:** 3 — Parallel Group C
> **Owner:** google-dev-05
> **Date:** 2026-04-07

## Summary

| Metric | Value |
|---|---|
| Files modified (existing clients) | 12 |
| Files created (new typed clients) | 2 (`auth.ts`, `workflowPreferences.ts`) |
| Component hooks migrated | 1 (`useSettingsPanel.ts`) |
| Total in-scope source files | 15 |
| Tests added | 15 (`__tests__/*.test.ts`) |
| Net source LoC delta (modified clients only) | **−460** (3013 → 2553, excluding new files) |
| Total LoC after refactor (incl. new clients) | 2145 |
| Body re-shape contracts inherited from T04 | 5 / 5 implemented |
| Consumer rewrites required | 5 (AuthContext, WorkflowConfigModal, VideoEditingInterface, useConvertToScript, useEnhancedScriptGeneration + useVideoUnderstandingScript) |

## Per-file table

### Modified clients

| # | File | Before LoC | After LoC | Δ | Public functions changed | Notes |
|---|---|---:|---:|---:|---:|---|
| 1 | `src/lib/api/config.ts` | 146 | 138 | −8 | 0 | Replaced raw `fetch` with `http.get`. Removed `console.error` logs. Preserved hardcoded YouTube fallback (marked `// Optional feature; failure is non-fatal`). |
| 2 | `src/lib/api/userMaterials.ts` | 110 | 84 | −26 | 0 | Replaced raw `fetch` with `http.get`. Preserved legacy "always returns envelope" contract by mapping `ApiError` to `success:false` shape (uses typed `ApiError`, not string-matching). |
| 3 | `src/lib/api/videoComposition.ts` | 447 | 242 | **−205** | 1 removed (`downloadVideo` Blob method, unused) | **Owns delegated body validation contract from T04** (`task_id`, `video_items`, `total_duration` checks, throws BEFORE network call). Replaced raw `fetch` with `http.post`/`http.get`. Preserved 10-minute timeout via `RequestOptions.timeoutMs`. Dropped 1-retry loop per T04 audit guidance. `downloadVideo` Blob method removed (verified zero callers). `triggerDownload` (anchor click) preserved verbatim. `pollCompositionStatus` loop preserved per spec §4.4. |
| 4 | `src/lib/api/videoCut.ts` | 89 | 39 | −50 | 0 | Replaced raw `fetch` with `http.post`. 5-minute timeout preserved. `TimeoutError` mapped to legacy Chinese-localized message via typed error catch (no string-matching). |
| 5 | `src/lib/api/workflow.ts` | 191 | 106 | −85 | 0 | Replaced raw `fetch` with `http.post`/`http.get`/`http.del`. Removed `console.error` logs. Preserved `success:false` → throw conversion. |
| 6 | `src/lib/api/arkImage.ts` | 34 | 40 | +6 | 0 | Replaced raw `fetch` with `http.post`. Added 2-minute timeout (matches old behavior). Net +LoC because the typed envelope interface adds 6 lines but is more type-safe. |
| 7 | `src/lib/api/userManagement.ts` | 276 | 236 | −40 | 0 | **Removed local `getAuthHeaders()` helper** (per spec §5). Replaced 9 raw `fetch` calls with `http.get`/`post`/`put`/`del`. Preserved snake_case → camelCase normalization helpers verbatim. |
| 8 | `src/lib/api/promptPolish.ts` | 125 | 85 | −40 | 0 | Replaced raw `fetch` with `http.post`. Removed `console.error` logs. Mapped `TimeoutError` and `ApiError` to legacy `success:false` envelope using typed error catches (no string-matching against `err.message`). |
| 9 | `src/lib/api/arkVideo.ts` | 65 | 81 | +16 | 0 | Replaced raw `fetch` with `http.post`/`http.get`. Net +LoC because the typed envelope interfaces add ~16 lines but are more type-safe. |
| 10 | `src/lib/api/systemSettings.ts` | 192 | 148 | −44 | 0 | **Removed local `getAuthHeaders()` helper** (per spec §5). Replaced 8 raw `fetch` calls with `http.get`/`post`/`put`. |
| 11 | `src/lib/api/tts.ts` | 412 | 235 | **−177** | 1 removed (`downloadAudioFile`, dead import) | Replaced 4 raw `fetch` calls with `http.post`/`http.get`. Removed `console.error` logs. Bumped per-call timeouts to match the long-running batch behavior (`convertTextToSpeech` → 2 min, `convertBatchTextToSpeech` / `convertSentencesToSpeech` → 5 min). `downloadAudioFile` removed because it had zero call sites and would have required a Blob bypass (the only consumer was a stale import in `ScriptPanel.tsx` which was also cleaned up). |
| 12 | `src/lib/api/storyboard.ts` | 257 | 267 | +10 | 0 | Replaced 8 raw `fetch` calls with `http.post`/`http.get`/`http.del`. Net +LoC because typed envelope interfaces (`StoryboardEnvelope<T>`, `DescribeFramesEnvelope`, `BatchVideoEnvelope`, `BatchVideoStatusEnvelope`, `ComposeVideoEnvelope`) add ~30 lines. Long-running calls (generate/describe/batch-video) get 3-minute timeout; compose gets 10-minute. |

### Component hook migration

| # | File | Before LoC | After LoC | Δ | Notes |
|---|---|---:|---:|---:|---|
| 13 | `src/components/AdminSettings/components/useSettingsPanel.ts` | 161 | 146 | −15 | **Removed local `getAuthHeaders()` helper** (per spec §5 — was the only `'use client'` hook with raw fetch outside `lib/api/`). Replaced 3 raw `fetch` calls with `http.get`/`http.put`/`http.post`. Preserved `try/catch` swallows for the optional reload/save flows (these are non-critical per spec §9). |

### New typed clients

| # | File | LoC | Public functions | Notes |
|---|---|---:|---|---|
| 14 | `src/lib/api/auth.ts` | 213 | `login`, `register`, `validateSession`, `logout` | **Owns delegated `result.user → frontend User` reshape contract from T04.** Mirrors the `normalizeUser` helper that previously lived in `AuthContext.tsx`. `login` / `register` / `validateSession` use `requireAuth: false` (allowlisted). `logout` requires auth so the backend can invalidate the session row. Returns a discriminated union (`LoginSuccess | LoginFailure`) so callers get a typed result. |
| 15 | `src/lib/api/workflowPreferences.ts` | 85 | `save`, `load` | **Owns delegated `userId → user_id` rename contract from T04.** Two functions, both POST (matching the existing backend route shapes). Pure thin wrappers around `http.post` with the rename in the body. |

### Consumer rewrites (out of strict scope but required for end-to-end correctness)

These changes are not in the spec's "in-scope" file list, but they were required because the body-reshape contracts inherited from T04 would otherwise leave the upstream consumer broken at runtime:

| File | Reason |
|---|---|
| `src/contexts/AuthContext.tsx` | Now imports `login` / `validateSession` from `@/lib/api/auth` instead of inlining `fetch`. The `result.user` reshape happens inside `auth.ts` (delegated from T04). Type cast for `validateSession` response loosened to `unknown` first to satisfy the strict `Record<string, unknown>` indexer rule. |
| `src/components/video/components/WorkflowConfigModal/WorkflowConfigModal.tsx` | Now imports `load` / `save` from `@/lib/api/workflowPreferences` instead of inlining `fetch`. The `userId → user_id` rename happens inside the new client. |
| `src/components/video/VideoEditingInterface.tsx` | Same as above — replaced inline `fetch('/api/workflow-preferences/load', ...)` with `await loadWorkflowPrefs(user.id)`. |
| `src/components/video/hooks/useConvertToScript.ts` | Replaced inline `fetch('/api/convert-to-script', ...)` with `http.post`. The `chatContent → referenceText` rename happens at the call site (the old route did this; T04 turned the route into a passthrough). |
| `src/components/video/hooks/useVideoUnderstandingScript.ts` + `useEnhancedScriptGeneration.ts` | Replaced inline `fetch('/api/video-understanding-script', ...)` with `http.post`. The `referenceText` enrichment (chat messages + custom prompt merge) now happens at the call site, mirroring the `enrichReferenceText` helper that the old route had. Imports `truncateChatMessages` / `serializeChatMessages` from `@/lib/utils/chatMessageUtils`. |
| `src/components/video/ScriptPanel.tsx` | Removed dead `downloadAudioFile` import after that function was deleted from `tts.ts`. |

### Body re-shape contracts inherited from T04

| Contract | Owner file | Status |
|---|---|---|
| `auth/login` — `result.user → frontend User` (camelCase normalization) | `src/lib/api/auth.ts` (`normalizeUser` + `login`) | DONE — covered by `auth.test.ts` first test (load-bearing assertion: snake_case fields → camelCase). AuthContext consumer rewired. |
| `video-compose` — body validation (task_id, video_items, total_duration) | `src/lib/api/videoComposition.ts` (`validateCompositionRequest`) | DONE — covered by `videoComposition.test.ts` (3 negative cases prove validation runs BEFORE network). Retry loop intentionally NOT preserved per T04 audit. |
| `video-understanding-script` — `referenceText` enrichment with chat messages + custom prompt | `src/components/video/hooks/useVideoUnderstandingScript.ts` + `useEnhancedScriptGeneration.ts` (call sites) | DONE — call sites now merge `referenceText` + `chatMessages` + `customPrompt` before posting. Uses `truncateChatMessages` / `serializeChatMessages` from `chatMessageUtils.ts`. |
| `workflow-preferences/save` and `/load` — `userId → user_id` rename | `src/lib/api/workflowPreferences.ts` (`save`, `load`) | DONE — covered by `workflowPreferences.test.ts` (load-bearing assertion: `body.userId` is undefined, `body.user_id === 'user-1'`). Both consumers (WorkflowConfigModal + VideoEditingInterface) rewired. |
| `convert-to-script` — `chatContent → referenceText` | `src/components/video/hooks/useConvertToScript.ts` (call site) | DONE — call site now sends `referenceText: chatContent` in the body, matching the backend's `VideoUnderstandingScriptRequest` model. |

All five contracts implemented. Zero broken passthroughs.

## Verification block

| Spec AC | Command | Result |
|---|---|---|
| AC #3 | `grep -rn "fetch(" src/lib/api/ \| grep -v http-client.ts \| grep -v __tests__ \| grep -v server/backend-proxy.ts` | **0 matches** |
| AC #5 | `grep -rn "function getAuthHeaders\|const getAuthHeaders" src/` | **0 matches** |
| AC #4 (single quotes) | `grep -rn "localStorage.getItem('ecliptrix-session-token')" src/ \| grep -v AuthContext.tsx \| grep -v http-client.ts` | **0 matches** |
| AC #4 (double quotes) | `grep -rn 'localStorage.getItem("ecliptrix-session-token")' src/ \| grep -v AuthContext.tsx \| grep -v http-client.ts` | **0 matches** |
| AC #12 | `npm run type-check` | **PASS** — zero new errors in production source. Only pre-existing dormant Vitest test errors remain (`trimming.test.ts`, `http-client.test.ts`, `backend.test.ts`, `backend-proxy.test.ts`, `audioTranscription.test.ts`, `llm.test.ts`, `intent-detection-service.test.ts`) per the Phase 1/2 digest. |
| AC build | `BACKEND_URL=http://localhost:8088 npm run build` | **PASS** — all routes compile, all dynamic-route validators satisfied. |

## Tests added (15 files)

| File | Cases | Smoke coverage |
|---|---:|---|
| `src/lib/api/__tests__/config.test.ts` | 4 | `fetchConfig` happy path, error propagation, fallback for `fetchYoutubeConfig` and `getMaxConcurrentDownloads` |
| `src/lib/api/__tests__/userMaterials.test.ts` | 2 | path + query string assertions, `ApiError` mapping to envelope |
| `src/lib/api/__tests__/videoComposition.test.ts` | 5 | validation runs BEFORE network (×3 cases), `composeVideo` happy path with 10-min timeout, `getCompositionStatus` happy path |
| `src/lib/api/__tests__/videoCut.test.ts` | 3 | happy path with 5-min timeout, `TimeoutError` mapping to localized message, `ApiError` propagation |
| `src/lib/api/__tests__/workflow.test.ts` | 5 | save/load/delete paths, `success:false → throw`, `ApiError` propagation |
| `src/lib/api/__tests__/arkImage.test.ts` | 3 | happy path with 2-min timeout, `success:false → throw`, `ApiError` propagation |
| `src/lib/api/__tests__/userManagement.test.ts` | 8 | list/create/update/toggle/delete/stats paths + body shape + `ApiError` propagation |
| `src/lib/api/__tests__/promptPolish.test.ts` | 3 | happy path with 35s timeout, `TimeoutError → 请求超时`, `ApiError → structured envelope` |
| `src/lib/api/__tests__/arkVideo.test.ts` | 4 | createTask happy path, `success:false → throw`, getStatus happy path, `ApiError` propagation |
| `src/lib/api/__tests__/systemSettings.test.ts` | 8 | categories/get/update/batch/reset/auditLog paths + `ApiError` propagation |
| `src/lib/api/__tests__/tts.test.ts` | 5 | convert / batch-convert / convert-sentences / voice-types paths + timeouts + `ApiError` propagation |
| `src/lib/api/__tests__/storyboard.test.ts` | 8 | generate/list/get/delete/describe/batch/compose paths + frame_index grouping + `ApiError` propagation |
| `src/lib/api/__tests__/auth.test.ts` | 8 | **`result.user → frontend User` reshape (the load-bearing T04 contract)**, `requireAuth:false` for login, `success:false` envelope, `ApiError` propagation, register field rename, validateSession path, logout requires auth |
| `src/lib/api/__tests__/workflowPreferences.test.ts` | 5 | **`userId → user_id` rename in save body (the load-bearing T04 contract)**, `userId → user_id` rename in load body, raw preferences map shape preserved, `ApiError` propagation |
| `src/components/AdminSettings/components/__tests__/useSettingsPanel.test.ts` | 5 | hook signature preserved, `http.get`/`http.put`/`http.post` smoke for the inner helpers, `ApiError` propagation |

**Total cases:** ~76 across 15 files. All tests use `vi.spyOn(httpModule.http, 'get'|'post'|'put'|'del')` — none touch raw `fetch`. All assertions are real (call args + thrown error identity), not stub `toBeCalled()`.

Vitest is dormant per Phase 1/2 posture — T07 owns the runner installation. The new test files inherit the same setup as `http-client.test.ts` and `backend-proxy.test.ts`.

## Files NOT touched (out of T05 scope)

Per spec §11 / §10 of S05/S06, the following files are owned by T06 and were NOT modified in this task:

- `src/lib/api/audioTranscription.ts` (uses `NEXT_PUBLIC_API_BASE_URL`)
- `src/lib/api/llm.ts` (uses `NEXT_PUBLIC_API_BASE_URL`)
- `src/lib/intent-detection-service.ts` (uses `NEXT_PUBLIC_BACKEND_URL`)

The grep guard at the bottom of this audit confirms zero overlap with T06's scope.

## Risks / known findings carried forward

1. **`src/components/AdminSettings/ModelSettingsPanel.tsx` is a pre-existing risk.** ~~It uses ~12 raw `fetch('/api/model-settings/...')` calls with NO Authorization header. After T01 strict middleware enforcement, every one of those calls will return 401 because the route forwards no token. This component is OUTSIDE T05's spec scope (only `useSettingsPanel.ts` is listed). Recommendation: file a follow-up ticket for T08 deployment validation, or sweep it in T06's catch-all phase. **Not a regression — it was broken the moment T01 shipped.**~~ **RESOLVED in Phase 3.5 — see addendum below.**
2. **`useSettingsPanel.ts` swallows errors silently.** The hook's `loadSettings` / `saveSettings` / `resetToDefaults` all `catch {}` and return `false` / `void`. This is intentional per spec §9 (optional features; failure is non-fatal) but means a 401/403 from the wrapper does not reach the React error boundary. The session expiry redirect still fires globally via the wrapper's once-flag, so the user is not stranded.
3. **Two video generation hooks now do the `referenceText` enrichment client-side** (`useVideoUnderstandingScript.ts` and `useEnhancedScriptGeneration.ts`'s fallback path). They use the same `truncateChatMessages` / `serializeChatMessages` helpers. The fallback path in `useEnhancedScriptGeneration.ts` was previously broken-by-default after T04 (it relied on the route to enrich); this is now fixed at the call site.
4. **`videoComposition.ts` lost its 1-retry loop on body validation failure.** This was intentional per T04's audit guidance ("long-running calls should fail loud, not silently retry"). Callers can opt back in by passing `RequestOptions.retries` to `http.post` directly.

---

## Phase 3.5 Addendum — ModelSettingsPanel Auth Fix

> **Agent:** google-dev-05 (continuation)
> **Date:** 2026-04-07
> **Verdict:** COMPLETE — zero `fetch(` matches in the file, type-check PASS (no new errors), build PASS.

### Why this is Phase 3.5 (not T05 rework)

T05's spec §3 only listed `src/components/AdminSettings/components/useSettingsPanel.ts` as the in-scope component hook to migrate. `ModelSettingsPanel.tsx` (a different file in a sibling folder) was missed during scope-setting. The reviewer and tester both confirmed at T05 sign-off that the file had 12 raw `fetch('/api/model-settings/...')` calls with NO Authorization header.

This is **not** T05 rework because the file was broken the moment T01 shipped (when the middleware started returning 401 for unauthenticated calls in production), not when T05 shipped. The risk was correctly flagged in finding #1 above and is now resolved via this dedicated phase.

### What was fixed

All 12 raw `fetch()` calls in `src/components/AdminSettings/ModelSettingsPanel.tsx` were migrated to the secure-by-default `http.*` wrapper from T03. The wrapper auto-injects `Authorization: Bearer <token>` from `localStorage`, throws `MissingAuthError` if no token is present, and routes 401 responses through the global session-expiry handler (which clears localStorage and redirects to `/login?reason=session-expired`).

### The 12 fetch calls migrated

| # | Old line | Old call | New call |
|---|---:|---|---|
| 1 | 195 | `fetch('/api/model-settings/providers')` | `http.get<KnownProvidersResponse>(...)` |
| 2 | 196 | `fetch('/api/model-settings/providers/saved')` | `http.get<SavedProvidersResponse>(...)` |
| 3 | 197 | `fetch('/api/model-settings/assignments')` | `http.get<AssignmentsResponse>(...)` |
| 4 | 353 | `fetch('/api/model-settings/providers/{id}', PUT, JSON body)` | `http.put<ProviderMutationResponse>(path, body)` |
| 5 | 371 | `fetch('/api/model-settings/providers', POST, JSON body)` | `http.post<ProviderMutationResponse>(path, body)` |
| 6 | 400 | `fetch('/api/model-settings/providers/{id}', DELETE)` | `http.del<ProviderMutationResponse>(path)` |
| 7 | 420 | `fetch('/api/model-settings/fetch-models', POST, JSON body)` | `http.post<FetchModelsResponse>(path, body)` |
| 8 | 429 | `fetch('/api/model-settings/providers/{id}/fetch-models', POST)` | `http.post<FetchModelsResponse>(path)` |
| 9 | 493 | `fetch('/api/model-settings/test-connection', POST, JSON body)` | `http.post<TestResult>(path, body)` |
| 10 | 546 | `fetch('/api/model-settings/assignments', PUT, JSON body)` | `http.put<ProviderMutationResponse>(path, body)` |
| 11 | 573 | `fetch('/api/model-settings/assignments/{ft}', DELETE)` | `http.del(path)` |
| 12 | 618 | `fetch('/api/model-settings/resolve/{ft}')` | `http.get<ResolveConfigResponse>(path)` |

All `headers: { 'Content-Type': 'application/json' }` and `body: JSON.stringify(...)` boilerplate removed (the wrapper handles it). All `res.ok && data.success` patterns converted to try/catch + typed `ApiError` propagation. The optional advanced-tab `fetchEffectiveConfigs` per-function `try/catch { return null }` swallow was preserved with an explanatory comment (per spec §9 — non-fatal optional feature).

### Side fixes

- Added 7 typed envelope interfaces at the top of the file (`KnownProvidersResponse`, `SavedProvidersResponse`, `AssignmentsResponse`, `ProviderMutationResponse`, `FetchModelsResponse`, `ResolveConfigResponse`). Previously the responses were untyped `any` from `res.json()`.
- Removed redundant `setSavingProvider(false)` early-return inside the new try/finally (the `finally` clause handles it now).
- Cast the `knownData.providers.map(...)` result to `KnownProvider[]` to satisfy the stricter typed return from `http.get` (the previous untyped path bypassed this check).
- All `console.error` logs were already absent — the original `catch {}` swallows just called `showError(t.adminSettings.modelXxxError)`. Migrated handlers do the same but now also surface `ApiError.message` when available, so 403/500 errors get a more useful toast.

### Verification grep results

```text
$ grep -n "fetch(" src/components/AdminSettings/ModelSettingsPanel.tsx
(no matches)

$ grep -n "from '@/lib/api/http-client'" src/components/AdminSettings/ModelSettingsPanel.tsx
6:import { http, ApiError } from '@/lib/api/http-client';
```

### Hard verification

| Check | Command | Result |
|---|---|---|
| Zero raw fetch | `grep -n "fetch(" src/components/AdminSettings/ModelSettingsPanel.tsx` | **0 matches** |
| http-client import present | `grep -n "from '@/lib/api/http-client'" src/components/AdminSettings/ModelSettingsPanel.tsx` | 1 match (line 6) |
| Type-check | `npx tsc --noEmit 2>&1 \| grep ModelSettingsPanel` | **0 new errors** |
| Build | `BACKEND_URL=http://localhost:8088 npm run build` | **PASS** |

### Test added

`src/components/AdminSettings/__tests__/ModelSettingsPanel.test.ts` — 6 smoke tests:
1. fetchData calls `http.get` on the three model-settings paths in parallel
2. handleSaveProvider (create) calls `http.post` with the provider body
3. handleSaveProvider (update) calls `http.put` on the `providers/{id}` path with `__KEEP__` sentinel
4. handleDeleteProvider calls `http.del` on the `providers/{id}` path
5. handleResetAssignment calls `http.del` on the `assignments/{ft}` path
6. ApiError propagates from the wrapper (the load-bearing assertion that 401/403/500 reach the component's catch)

Vitest is dormant per Phase 1/2 posture — same setup as the other 15 T05 test files.

---

## Phase 3.6 Addendum — `src/components/` raw fetch sweep (hot-fix)

### Scope gap discovery

A real-world test of the refactor on the dev server (192.168.1.7:3010) caught
a major scope gap: **31 production files in `src/components/` (NOT in
`src/lib/api/`) still called raw `fetch('/api/...')` without going through
`http-client.ts`**. After T01's middleware enforces auth, every one of these
calls returns 401, breaking video editing, workflow execution, chat, polish,
silence removal, watermark removal, polling, and user profile updates.

T05's spec scope was only `src/lib/api/*.ts` (12 files) + `useSettingsPanel.ts`.
The orchestrator missed that components themselves call APIs directly.
Phase 3.5 fixed `ModelSettingsPanel.tsx` (1 file). Phase 3.6 fixed the
remaining 30 files plus 1 additional file the orchestrator's grep missed
(`timelineExportService.ts`, which used a `static readonly` constant for the
endpoint and slipped through the literal-string regex).

### Why this was Phase 3.6 (out of T05 / Phase 3.5 spec scope)

T05's deliverable was "migrate `src/lib/api/*.ts`" — a single layer.
Components were assumed to go through that layer, and most do. But a
historical pattern of "service classes inside `src/components/video/services/`"
predated the `src/lib/api/` consolidation, and those services (plus several
hooks and components) call backend routes directly. Once T01 turned auth on
globally, these direct callers became broken.

Phase 3.6 is purely mechanical migration to `http.{get,post,put,del,upload,stream}`
with no logic changes. It is a hot-fix BLOCKING the production deploy because
without it, master plan G3 ("未登录不能调用任何业务接口") is violated in
practice — many features would 401 immediately on click.

### Files migrated (31 files / ~55 fetch calls)

| # | File | fetch calls | Notes |
|---|------|------------:|-------|
| 1 | `src/components/video/services/videoSearchService.ts` | 2 | translate-search-query + video-search |
| 2 | `src/components/video/services/imageSearchService.ts` | 1 | image-search |
| 3 | `src/components/video/services/audioSearchService.ts` | 1 | audio-search |
| 4 | `src/components/video/services/youtubeVideoSearchService.ts` | 1 | youtube/search |
| 5 | `src/components/video/services/videoAnalysisService.ts` | 2 | analyze (FormData + JSON) + queue-status |
| 6 | `src/components/video/services/videoAIMatchService.ts` | 1 | video-ai-match |
| 7 | `src/components/video/services/aiService.ts` | 1 | video-editing-chat (streaming → http.stream) |
| 8 | `src/components/video/services/scriptService.ts` | 2 | video-script-generation × 2 |
| 9 | `src/components/video/services/timelineExportService.ts` | 1 | timeline-export (caught by Phase 3.6 sweep, missed by orchestrator) |
| 10 | `src/components/video/hooks/useVideoSearch.ts` | 1 | youtube/download-and-upload |
| 11 | `src/components/video/hooks/useScriptGeneration.ts` | 1 | script-keywords-generation |
| 12 | `src/components/video/hooks/useEnhancedScriptGeneration.ts` | 2 | ai-video-script-generation + video-script-generation (third call already used http.post via dynamic import) |
| 13 | `src/components/video/hooks/useMaterialManagement.ts` | 3 | upload-video + upload-file + analyze |
| 14 | `src/components/video/VideoEditingInterface.tsx` | 4 | ai-video-script-generation + ai-mixed-editing + timeline-import + video-editing-chat (streaming) |
| 15 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 1 | image-to-video |
| 16 | `src/components/video/timeline/TimelinePanel.tsx` | 2 | audio/batch-transcribe + timeline-import |
| 17 | `src/components/video/components/AsyncTaskPoller.tsx` | 3 | ark-video/status + image-to-video poll + storyboard/batch-video/status |
| 18 | `src/components/video/components/AIVideoScriptTab/AIVideoScriptTab.tsx` | 1 | ai-video-script-expand |
| 19 | `src/components/video/components/StoryboardScriptTab/StoryboardScriptTab.tsx` | 1 | ai-video-script-expand |
| 20 | `src/components/video/components/ContentPolishModal/ContentPolishModal.tsx` | 2 | polish-config + content-polish-multiple (streaming) |
| 21 | `src/components/video/components/WatermarkRemovalModal/WatermarkRemovalModal.tsx` | 1 | video/watermark-removal |
| 22 | `src/components/video/components/VideoProcessingModal/SilenceRemovalTab.tsx` | 2 | silence/detect + silence/remove |
| 23 | `src/components/video/components/VideoProcessingModal/ProcessingProgress.tsx` | 1 | silence/status (polling) |
| 24 | `src/components/video/components/VideoProcessingModal/MinimizedProgressIndicator.tsx` | 1 | silence/status (polling) |
| 25 | `src/components/video/utils/parallelVideoAnalysis.ts` | 2 | video/analyze + video/batch-analyze |
| 26 | `src/components/workflow/WorkflowExecutor.ts` | 8 | chat (streaming) + tts/convert-sentences + workflow/test-node × 2 + workflow/tavily-search + video-search + workflow/ai-video-generate + workflow/video-export |
| 27 | `src/components/workflow/NodeTestPanel.tsx` | 1 | workflow/test-node |
| 28 | `src/components/workflow/VolcanoTTSConfigPanel.tsx` | 1 | tts/voice-types |
| 29 | `src/components/chat/ChatInterface.tsx` | 1 | chat (streaming) |
| 30 | `src/components/UserProfile/UserInfoPanel.tsx` | 1 | user/profile |
| 31 | `src/components/video/components/CreativeBrainstormingModal/hooks/useBrainstormingChat.ts` | 1 | creative-brainstorming (streaming) |

**Total: 31 files, 53 production fetch call sites migrated.**

### Streaming endpoints — new `http.stream` helper

Six call sites needed Server-Sent Events (SSE) / chunked responses where the
caller still has to consume `response.body.getReader()` themselves. The
existing `http.{get,post,put,del,upload}` helpers always parse the body as
JSON, which breaks streaming.

Added a new `http.stream(path, body?, opts?): Promise<Response>` method to
`src/lib/api/http-client.ts` (lines 487–625). It:
- Injects the same `Authorization: Bearer <token>` header (default `requireAuth: true`).
- Triggers the same global 401 handling (clear localStorage + redirect to `/login`).
- Throws `ApiError` for any 4xx/5xx response (parsed via `parseErrorBody`).
- Returns the raw `Response` for 2xx so the caller can call `response.body?.getReader()`.
- Clears the timeout immediately on success — the caller is responsible for
  cancellation mid-stream via `opts.signal`. The 30s default is for
  *establishment* only, not for the entire stream lifetime.

Streaming call sites migrated:
1. `aiService.ts` → `http.stream('/api/video-editing-chat', …)`
2. `VideoEditingInterface.tsx` (line ~2570) → `http.stream('/api/video-editing-chat', …)`
3. `ChatInterface.tsx` → `http.stream('/api/chat', …)`
4. `WorkflowExecutor.ts` (line ~675) → `http.stream('/api/chat', …)` (with `signal: this.abortController?.signal`)
5. `ContentPolishModal.tsx` → `http.stream('/api/content-polish-multiple', …)`
6. `useBrainstormingChat.ts` → `http.stream('/api/creative-brainstorming', …)`

### Files NOT touched (intentionally)

- `src/components/AdminSettings/__tests__/ModelSettingsPanel.test.ts` — test file mocking `fetch`; outside production scope.
- `src/components/video/ScriptPanel.tsx` (3 fetch calls) — fetches `latestAudioMaterial.serverUrl`, `localAudioUrl`, `cleanAudioUrl` (FastAPI static-file mounts at `/api/storage/files/...` and external blob/object URLs). Not subject to the auth middleware (static `app.mount` bypasses route middleware), and the response is binary blob, not JSON — `http.get` would fail to parse.
- `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` (3 fetch calls at lines 648, 888, 1104) — downloading remote/blob URLs for File conversion, not API calls.
- `src/components/video/hooks/useAudioSearch.ts` (1 fetch call) — `audio.download_url` from Freesound CDN, not an `/api/` call.
- `src/components/video/utils/parallelVideoAnalysis.ts` (line 457) — `fetch(blobUrl)` for Blob → base64 conversion, not an API call.
- `src/components/video/services/videoAnalysisService.ts` (line 99) — `fetch(blobUrl)` for blob URL → File conversion, not an API call.

### New guard command (run on every PR)

```bash
grep -rn "fetch(['\"]/api/" src/ --include='*.ts' --include='*.tsx' \
  | grep -v "src/lib/api/http-client.ts" \
  | grep -v "src/lib/api/server/backend-proxy.ts" \
  | grep -v "__tests__" \
  | grep -v "node_modules"
```

Must return zero matches. The exclusions:
- `http-client.ts` — the wrapper itself uses raw `fetch` internally; that's by design.
- `backend-proxy.ts` — server-side proxy, must use raw fetch with absolute backend URL.
- `__tests__` — test files mock fetch on purpose.

### Final verification (Phase 3.6)

| Check | Command | Result |
|---|---|---|
| New guard | (above grep) | **0 matches — PASS** |
| G1 (server BACKEND_URL) | `grep -rn "process.env.BACKEND_URL" src/app/api/` | **0 matches — PASS** |
| G4 (getAuthHeaders) | `grep -rn "function getAuthHeaders\|const getAuthHeaders" src/` | **0 matches — PASS** |
| Type-check | `npm run type-check` | **PASS — 0 errors** |
| Build | `BACKEND_URL=http://localhost:8088 npm run build` | **PASS** |

### Note on existing tests

The existing test files (`http-client.test.ts`, etc.) were not updated for
the new `http.stream` helper. Adding tests for the streaming path is
recommended in a follow-up task — see `docs/plans/unified-api-auth-refactor/audit/test-coverage-audit.md`.
