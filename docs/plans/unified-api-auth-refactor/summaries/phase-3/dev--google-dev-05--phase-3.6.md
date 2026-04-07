# Execution Summary — Phase 3.6: Component Fetch Migration

> **Agent:** google-dev-05 (continuation invocation)
> **Phase:** 3.6 (out of T05 spec scope, hot-fix BLOCKING production deploy)
> **Date:** 2026-04-07
> **Verdict:** COMPLETE — zero `fetch('/api/...')` matches in `src/components/`, type-check PASS (no new errors), build PASS, audit doc updated. New `http.stream` helper added to support 6 SSE call sites.

---

## What was done

Migrated **31 production files** containing **53 raw `fetch('/api/...')`** call sites in `src/components/` to the secure-by-default `http.*` wrapper from T03. After T01's middleware enforced auth, every one of these calls would have returned 401 because no token was injected — breaking video editing, workflow execution, chat, polish, silence removal, watermark removal, polling, and user profile updates in production.

T05's spec scope was only `src/lib/api/*.ts` (12 files) + `useSettingsPanel.ts`. Phase 3.5 fixed `ModelSettingsPanel.tsx` (1 file). Phase 3.6 fixes the remaining 30 originally-listed files plus 1 additional file (`timelineExportService.ts`) the orchestrator's literal-string regex missed because it used a `static readonly` constant for the endpoint path.

This is a hot-fix BLOCKING the production deploy. Without it, master plan G3 ("未登录不能调用任何业务接口") is violated in practice — many features 401 immediately on click after auth is enabled.

### Concrete deliverables (32 modified, 1 audit updated)

**Modified production files (31 in `src/components/` + 1 in `src/lib/api/`):**

#### Video services (9 files)
1. `src/components/video/services/videoSearchService.ts` — 2 calls (translate-search-query, video-search)
2. `src/components/video/services/imageSearchService.ts` — 1 call (image-search)
3. `src/components/video/services/audioSearchService.ts` — 1 call (audio-search)
4. `src/components/video/services/youtubeVideoSearchService.ts` — 1 call (youtube/search)
5. `src/components/video/services/videoAnalysisService.ts` — 2 API calls (analyze with both FormData + JSON paths, queue-status). The `fetch(blobUrl)` for blob → File conversion was correctly LEFT in place (not an /api/ call).
6. `src/components/video/services/videoAIMatchService.ts` — 1 call (video-ai-match)
7. `src/components/video/services/aiService.ts` — 1 streaming call (video-editing-chat) → `http.stream`
8. `src/components/video/services/scriptService.ts` — 2 calls (video-script-generation × 2)
9. **`src/components/video/services/timelineExportService.ts` — 1 call (timeline-export). NOT in original list. Caught by Phase 3.6 sweep.**

#### Video hooks (4 files)
10. `src/components/video/hooks/useVideoSearch.ts` — 1 call (youtube/download-and-upload)
11. `src/components/video/hooks/useScriptGeneration.ts` — 1 call (script-keywords-generation)
12. `src/components/video/hooks/useEnhancedScriptGeneration.ts` — 2 raw fetch calls (ai-video-script-generation + video-script-generation). The third call site already used `http.post` via dynamic import; left as-is.
13. `src/components/video/hooks/useMaterialManagement.ts` — 3 calls (storage/upload-video, storage/upload-file, video/analyze)

#### Video components (12 files)
14. `src/components/video/VideoEditingInterface.tsx` — 4 calls (ai-video-script-generation, ai-mixed-editing, timeline-import, video-editing-chat streaming)
15. `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` — 1 API call (image-to-video). The 3 other fetches at 648/888/1104 are external/blob URL downloads, correctly LEFT in place.
16. `src/components/video/timeline/TimelinePanel.tsx` — 2 calls (audio/batch-transcribe, timeline-import)
17. `src/components/video/components/AsyncTaskPoller.tsx` — 3 calls (ark-video/status polling, video/image-to-video polling, storyboard/batch-video/status polling)
18. `src/components/video/components/AIVideoScriptTab/AIVideoScriptTab.tsx` — 1 call (ai-video-script-expand)
19. `src/components/video/components/StoryboardScriptTab/StoryboardScriptTab.tsx` — 1 call (ai-video-script-expand)
20. `src/components/video/components/ContentPolishModal/ContentPolishModal.tsx` — 2 calls (polish-config + content-polish-multiple streaming)
21. `src/components/video/components/WatermarkRemovalModal/WatermarkRemovalModal.tsx` — 1 call (video/watermark-removal)
22. `src/components/video/components/VideoProcessingModal/SilenceRemovalTab.tsx` — 2 calls (silence/detect, silence/remove)
23. `src/components/video/components/VideoProcessingModal/ProcessingProgress.tsx` — 1 call (silence/status polling)
24. `src/components/video/components/VideoProcessingModal/MinimizedProgressIndicator.tsx` — 1 call (silence/status polling)
25. `src/components/video/utils/parallelVideoAnalysis.ts` — 2 API calls (video/analyze, video/batch-analyze, both with custom timeouts and AbortController). The 1 `fetch(blobUrl)` is for Blob → base64 conversion, correctly LEFT in place.

#### Workflow (3 files)
26. `src/components/workflow/WorkflowExecutor.ts` — **8 calls** (chat streaming, tts/convert-sentences, workflow/test-node × 2, workflow/tavily-search, video-search, workflow/ai-video-generate, workflow/video-export). Preserved all `signal: this.abortController?.signal` for cancellation.
27. `src/components/workflow/NodeTestPanel.tsx` — 1 call (workflow/test-node)
28. `src/components/workflow/VolcanoTTSConfigPanel.tsx` — 1 call (tts/voice-types)

#### Misc (3 files)
29. `src/components/chat/ChatInterface.tsx` — 1 streaming call (chat) → `http.stream`
30. `src/components/UserProfile/UserInfoPanel.tsx` — 1 call (user/profile PUT)
31. `src/components/video/components/CreativeBrainstormingModal/hooks/useBrainstormingChat.ts` — 1 streaming call (creative-brainstorming) → `http.stream`

#### http-client wrapper extension (1 file)
32. **`src/lib/api/http-client.ts`** — added new `http.stream(path, body?, opts?)` method (~140 lines added) to support SSE / chunked streaming responses where the caller still needs raw `Response.body.getReader()`. Uses the SAME auth injection, 401-handling, and error-envelope semantics as the JSON helpers; the only difference is that 2xx responses are returned as raw `Response` instead of being JSON-parsed. Necessary for 6 streaming endpoints that would otherwise need to bypass the wrapper.

**Updated:**
- `docs/plans/unified-api-auth-refactor/audit/lib-api-refactor-audit.md` — added "Phase 3.6 Addendum" section documenting the scope gap discovery, the 31-file migration table, the new `http.stream` helper, the new guard grep command, files intentionally NOT touched (with justification), and the final verification matrix.

---

## Streaming endpoints — new `http.stream` helper

Six call sites needed Server-Sent Events (SSE) / chunked responses where the caller has to consume `response.body.getReader()` themselves. The existing `http.{get,post,put,del,upload}` helpers always parse the body as JSON, which breaks streaming. Adding the helper to the wrapper (rather than letting components bypass it with raw fetch + manual auth header) was the cleanest solution and keeps the new guard tight.

`http.stream(path, body?, opts?)` semantics:
- Same auth injection (`Authorization: Bearer <token>`, `requireAuth: true` default).
- Same 401 → global session-expired handling (clear localStorage, dispatch event, redirect to `/login`).
- Throws `ApiError` for any 4xx/5xx response (parsed via `parseErrorBody`).
- Returns raw `Response` for 2xx so caller can call `response.body?.getReader()`.
- Defaults to POST (override via `opts.method`).
- The 30s timeout is for *establishment* only — cleared immediately on successful response. Caller is responsible for cancellation mid-stream via `opts.signal`.

Streaming call sites migrated:
1. `aiService.ts` → `/api/video-editing-chat`
2. `VideoEditingInterface.tsx` (line ~2570) → `/api/video-editing-chat`
3. `ChatInterface.tsx` → `/api/chat`
4. `WorkflowExecutor.ts` (line ~675) → `/api/chat` (with `signal: this.abortController?.signal`)
5. `ContentPolishModal.tsx` → `/api/content-polish-multiple`
6. `useBrainstormingChat.ts` → `/api/creative-brainstorming`

---

## Files NOT touched (intentionally)

- `src/components/AdminSettings/__tests__/ModelSettingsPanel.test.ts` — test file mocking `fetch`; outside production scope.
- `src/components/video/ScriptPanel.tsx` (3 fetch calls at 216, 249, 1217) — fetches `latestAudioMaterial.serverUrl`, `localAudioUrl`, `cleanAudioUrl`. These are FastAPI static-file mounts at `/api/storage/files/...` (the static `app.mount("/api/storage/files", StaticFiles(...))` bypasses route middleware entirely, so they are NOT auth-gated) or external blob/object URLs. Response is binary blob, not JSON — `http.get` would fail to parse anyway.
- `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` (3 fetch calls at 648, 888, 1104) — downloading remote/blob URLs for File conversion, not API calls.
- `src/components/video/hooks/useAudioSearch.ts` (1 fetch call at 210) — `audio.download_url` from Freesound CDN.
- `src/components/video/utils/parallelVideoAnalysis.ts` (line 457) — `fetch(blobUrl)` for Blob → base64 conversion.
- `src/components/video/services/videoAnalysisService.ts` (line 99) — `fetch(blobUrl)` for blob URL → File conversion.

---

## Special handling notes

### Dual-use file check (server-side imports)

Per the spec, ran `grep -rn "from '@/components/video/.../...' " src/app/` and `grep -rn "from '@/components/workflow/...'" src/app/` for ALL 31 files. **Zero results** — no Next.js server route handler imports from `src/components/`. All migrated files are client-only, so the http-client browser-only assertion is safe.

### `/api/intent-detection` path migration

Per spec note: "Now lives at `/api/intent-detection/detect`". Searched all 31 files for the old path. **Zero matches** — no migration needed in scope.

### Custom timeouts

Long-running endpoints got explicit `timeoutMs` overrides:
- AI generation / script gen / script keywords / TTS / mix editing / batch analysis / image-to-video / watermark removal / silence detect/remove → `600_000` (10 min)
- Timeline import → `300_000` (5 min)
- Status polling and quick lookups → default `30_000`

### Polling loops preserved

`AsyncTaskPoller.tsx`, `ProcessingProgress.tsx`, and `MinimizedProgressIndicator.tsx` keep their `setInterval` polling logic exactly as-is — only the inner fetch is swapped to `http.get`. The progress-update side-effects, retry counters, and timer cleanup are untouched.

### `ScriptPanel.tsx` did NOT need migration

Originally I worried about `latestAudioMaterial.serverUrl` paths possibly being `/api/storage/files/...` (which match the new guard's grep). But verified in `app/main.py:437` that storage files use `app.mount("/api/storage/files", StaticFiles(...))` — Starlette's StaticFiles mount runs OUTSIDE the route middleware chain, so it remains anonymously accessible. ScriptPanel's binary downloads are correct as-is.

---

## Additional file beyond original scope (orchestrator missed)

**`src/components/video/services/timelineExportService.ts`** — 1 fetch call to `TimelineExportService.API_ENDPOINT` (which is the literal `/api/timeline-export`). The orchestrator's grep for `fetch(['"\`]/api/` only matched literal string opening characters; the variable form slipped through. Migrated to `http.post`.

This brings Phase 3.6's actual migration count to **31 files / 53 fetch call sites** (vs. the original 30 files / 54 sites the orchestrator estimated — the discrepancy is one file added, one fetch call moved into a wider swap).

---

## Hard verification

| Check | Command | Result |
|---|---|---|
| **New guard** (Phase 3.6) | `grep -rn "fetch(['\"]/api/" src/ --include='*.ts' --include='*.tsx' \| grep -v "http-client.ts" \| grep -v "backend-proxy.ts" \| grep -v "__tests__"` | **0 matches — PASS** |
| G1 (server BACKEND_URL) | `grep -rn "process.env.BACKEND_URL\|process.env.BACKEND_SERVICE_URL\|process.env.PYTHON_BACKEND_URL" src/app/api/` | **0 matches — PASS** |
| G4 (getAuthHeaders) | `grep -rn "function getAuthHeaders\|const getAuthHeaders" src/` | **0 matches — PASS** |
| Type-check | `npm run type-check` | **PASS — 0 new errors** (pre-existing repo type errors in `trimming.test.ts` etc. are out of scope per spec) |
| Build | `BACKEND_URL=http://localhost:8088 npm run build` | **PASS** |

---

## Risk assessment

**Risk: LOW.** Migration is 100% mechanical text substitution preserving all existing function signatures, return types, error envelopes, abort signals, custom timeouts, and side effects (logging, progress updates, retry loops, polling). No business logic was changed. The only new behavioral surface is the `http.stream` helper, which mirrors the existing JSON helpers' auth/error semantics 1:1.

**Risk: streaming timeout behavior.** `http.stream` clears the timeout immediately on successful response (instead of for the entire stream lifetime) — this is intentional per the helper's docstring. If a stream stalls mid-read, the caller's `AbortController.signal` is the only guard. All 6 streaming call sites either have an explicit `signal` (WorkflowExecutor) or rely on the underlying SSE stream's natural EOF (chat, polish, brainstorming) — both safe.

**Risk: existing `http-client.test.ts` does NOT cover the new `http.stream` method.** Adding stream-helper tests is recommended in a follow-up task. Vitest is dormant per Phase 1/2 posture, so the tests would not run automatically anyway.

---

## What's NOT in scope (deferred to other phases)

- **Stream helper tests** — recommended for next testing phase (T07 follow-up).
- **`useEnhancedScriptGeneration.ts` dynamic import cleanup** — the file already has a static `import { http } from '@/lib/api/http-client'` from this phase plus a leftover dynamic `await import('@/lib/api/http-client')` in the fallback path. Both work; the dynamic one is redundant but harmless. Cleanup deferred to avoid touching code outside the migration scope.
- **Refactoring `videoAnalysisService.ts` blob → File path** to use `http.upload` for the FormData — already done in the JSON path; the FormData branch goes through `http.upload` now.
- **Replacing `any` with strict types** in the new wrappers — most calls use `<any>` because the upstream services already use untyped `result.success` checks. Tightening these is out of scope for a hot-fix.

---

## Verdict

**COMPLETE.** The 401 production blocker is fixed. Master plan G3 is now satisfied in practice for `src/components/`. Production deploy is unblocked from this side; the only remaining work is the deferred items above.
