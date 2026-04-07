# TODO 06: Direct Browser Call Migration

> **Spec:** [specs/06-direct-browser-call-migration.md](../specs/06-direct-browser-call-migration.md)

## Dependencies

```yaml
depends_on: [02, 03, 04]
blocks: [07]
parallel_group: C
```

- **Depends on T02** — new proxy routes use `backendConfig.baseUrl`
- **Depends on T03** — migrated client files use `http.*`
- **Depends on T04** — uses `createPassthroughRoute` helper. Sequenced AFTER T04 sweep finishes so the new routes aren't included in the sweep audit
- **Blocks T07** — testing covers the new proxy routes
- **Parallel group C** — runs in Phase 3 alongside T05 (no file overlap)

## Tasks

- [ ] Read sibling spec `06-direct-browser-call-migration.md` end to end, especially §4.1 (in-process consumer migration) and §4.3 Decision Point (Option A vs Option B for `AudioTranscriptionErrorResponse`)
- [ ] Read sibling specs `02-backend-url-config-module.md`, `03-frontend-http-client-wrapper.md`, and `04-nextjs-routes-sweep.md`
- [ ] **Verify pre-existing state:**
  - [ ] `src/app/api/intent-detection/route.ts` exists (confirmed at spec time — must be deleted)
  - [ ] `src/app/api/llm/`, `src/app/api/audio/transcribe-local/`, `src/app/api/audio/transcribe/` do NOT exist (confirmed)
  - [ ] Re-grep for current consumers per spec §3 to confirm no new caller has appeared since spec time:
    - [ ] `grep -rn "from '@/lib/intent-detection-service'" src/` — should still only show `video-editing-chat/route.ts` and `intent-detection/route.ts`
    - [ ] `grep -rn "fetchLLMModels" src/` — should still only show the 3 workflow config panels
    - [ ] `grep -rn "transcribeAudioFromPath\|transcribeAudioFromFile" src/` — should still only show `ScriptPanel.tsx`
    - [ ] `grep -rn "transcribeAudioFromPath\|transcribeAudioFromFile" src/**/*.worker.ts` — must return ZERO matches (Web Workers cannot use `http-client.ts` per spec §9)
  - [ ] Verify with the S01 owner that the backend allowlist does NOT include `/api/intent-detection/*`, `/api/llm/*`, or `/api/audio/*` (per spec AC #13)
- [ ] **Create 4 new Next.js proxy routes** using `createPassthroughRoute` from S04 (NOT hand-rolled fetch boilerplate; per spec AC #7). The helper automatically forwards `Authorization` headers (per spec AC #8):
  - [ ] `src/app/api/intent-detection/detect/route.ts` → backend `/api/intent-detection/detect` (Pattern A — no body transform, no timeout override)
  - [ ] `src/app/api/llm/models/route.ts` → backend `/api/llm/models` (Pattern A — no body, no transform, no timeout override)
  - [ ] `src/app/api/audio/transcribe-local/route.ts` → backend `/api/audio/transcribe-local` (Pattern C, `timeoutMs: 300_000` — backend endpoint is synchronous; multipart must be streamed, NOT parsed via `req.json()`)
  - [ ] `src/app/api/audio/transcribe/route.ts` → backend `/api/audio/transcribe` (Pattern C, `timeoutMs: 300_000` — synchronous backend, multipart up to 100MB)
  - [ ] **Coordination check before creating the audio routes:** confirm with the S04 owner that `createPassthroughRoute` supports large multipart bodies (~100MB). If not, escalate as a blocker per spec §10 / §9
- [ ] **Refactor `src/lib/intent-detection-service.ts`:**
  - [ ] Remove all `process.env.NEXT_PUBLIC_BACKEND_URL` reads (and any `BACKEND_URL` constant)
  - [ ] Replace fetch with `http.post('/api/intent-detection/detect', { user_message, enabled_workflows, conversation_history })`
  - [ ] Preserve the `detectIntent(userMessage, enabledWorkflows, conversationHistory?)` signature
  - [ ] Preserve return type `IntentDetectionResult`
  - [ ] Remove the explicit `try/catch` that wraps fetch errors into `{success:false}` envelopes — let `ApiError` propagate per S03 conventions (the empty `userMessage` / empty `enabledWorkflows` pre-flight validation MAY remain)
  - [ ] Remove the verbose `console.log` statements (per S05 §5 convention)
- [ ] **Migrate in-process server-side consumers** (per spec §4.1):
  - [ ] DELETE `src/app/api/intent-detection/route.ts` (replaced by `/detect` proxy). Verify via grep that no external caller depends on the bare `/api/intent-detection` path with no `/detect` suffix; if any does, update it to use `/api/intent-detection/detect`
  - [ ] Rewrite `src/app/api/video-editing-chat/route.ts` to call backend server-to-server via `${backendConfig.baseUrl}/api/intent-detection/detect` (using the S02 config module) instead of importing `detectIntent` (server context cannot use `http.*`); the rewritten handler must forward the incoming request's `Authorization` header
  - [ ] After migration, run `grep -rn "from '@/lib/intent-detection-service'" src/app/` — must return ZERO matches (per spec §4.1 + AC #14)
- [ ] **Refactor `src/lib/api/llm.ts`:**
  - [ ] Remove `NEXT_PUBLIC_API_BASE_URL` read (and any `API_BASE_URL` constant)
  - [ ] Replace fetch with `http.get<LLMModelsResponse>('/api/llm/models')`
  - [ ] Preserve `fetchLLMModels(): Promise<LLMModel[]>` signature (extract `.models` from response to keep the `LLMModel[]` return contract)
  - [ ] Remove the explicit `try/catch` and `console.log` calls
  - [ ] **If by implementation time the file has grown additional functions** (mixed-file scenario per spec §4.2): S06 owns 100% of `llm.ts` — migrate every function in the file using the same pattern
- [ ] **Refactor `src/lib/api/audioTranscription.ts`:**
  - [ ] Remove `NEXT_PUBLIC_API_BASE_URL` reads
  - [ ] Replace `transcribeAudioFromPath(request)` fetch with `http.upload('/api/audio/transcribe-local', formData)` (FormData with `file_path` string + form fields: language, use_itn, use_punc, max_lines, words_per_line, generate_srt_file)
  - [ ] Replace `transcribeAudioFromFile(file, options?)` fetch with `http.upload('/api/audio/transcribe', formData)` (FormData with `file` File + same form fields)
  - [ ] Preserve both function signatures
  - [ ] Leave the non-API helper `formatSubtitleTime` untouched
  - [ ] **Decide and document:** Pick Option A (recommended — drop `AudioTranscriptionErrorResponse` from the return union, let `ApiError` propagate, update `src/components/video/ScriptPanel.tsx` to use try/catch) OR Option B (keep return union, translate caught `ApiError` into `AudioTranscriptionErrorResponse` shape) per spec §4.3. Record the choice in the audit deliverable.
  - [ ] Remove the verbose `console.log` calls
- [ ] **Remove env vars from templates:**
  - [ ] Remove any line setting `NEXT_PUBLIC_BACKEND_URL` or `NEXT_PUBLIC_API_BASE_URL` in root `env.template`
  - [ ] Same in `backend-services/basic-service/env.template`
- [ ] **Smoke tests** (mock `httpModule.http`, NOT raw fetch):
  - [ ] Create `src/lib/__tests__/intent-detection-service.test.ts` covering: (C1) `detectIntent` calls `http.post('/api/intent-detection/detect', { user_message, enabled_workflows, conversation_history })`; (C5) propagates `MissingAuthError`
  - [ ] Create `src/lib/api/__tests__/llm.test.ts` covering: (C2) `fetchLLMModels()` calls `http.get('/api/llm/models')` and returns the `models` array; (C6) propagates `SessionExpiredError`
  - [ ] Create `src/lib/api/__tests__/audioTranscription.test.ts` covering BOTH functions: (C3) `transcribeAudioFromPath` calls `http.upload('/api/audio/transcribe-local', formData)` with `file_path` appended; (C4) `transcribeAudioFromFile` calls `http.upload('/api/audio/transcribe', formData)` with the File appended under key `file`; (C7) `ApiError` propagates / translates per the chosen Option in §4.3
- [ ] Run `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" src/` — must return ZERO matches
- [ ] Run `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" .env*` (root + `backend-services/basic-service/`) — must show templates clean
- [ ] Run `npm run type-check` — must pass
- [ ] Run `npm run build` — must succeed
- [ ] Generate audit at `docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md` per spec §2 AC #12, including: each removed env var; each new route created (with a "Disposition" column distinguishing Created vs Deleted for the intent-detection rows); the chosen Option (A or B) for `audioTranscription.ts` per §4.3; the final grep results from AC #1, AC #14, and the Web-Worker check; any extra files discovered per spec §4.4
- [ ] Sync all new and modified files (4 new route files, 3 modified clients, deleted intent-detection route, modified video-editing-chat route, env templates, audit doc) to Singapore-01 staging area
- [ ] Write execution summary at `summaries/phase-3/dev--<agent-id>--todo-06.md`
- [ ] Mark TODO complete in the agent's completion report
