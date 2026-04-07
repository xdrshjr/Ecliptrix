# Spec 06: Direct Browser Call Migration

> **Owner role:** Frontend developer (browser + Next.js BFF)
> **Layer:** Browser (`src/lib/`) + Next.js routes (`src/app/api/`)
> **Depends on:** S02 (config module), S03 (HTTP wrapper), S04 (proxy helper pattern)
> **Blocks:** S07 (testing), S08 (deployment removes the env vars)

---

## 1. Purpose

Eliminate the 3 remaining source files that bypass the Next.js BFF layer and call the FastAPI backend directly from the browser:

| File | Currently calls | Bypass mechanism |
|---|---|---|
| `src/lib/intent-detection-service.ts` | `${NEXT_PUBLIC_BACKEND_URL}/api/intent-detection/detect` (single function `detectIntent`) | `NEXT_PUBLIC_BACKEND_URL` env var leaks the backend URL into the browser bundle |
| `src/lib/api/llm.ts` | `${NEXT_PUBLIC_API_BASE_URL}/api/llm/models` (single function `fetchLLMModels`) | `NEXT_PUBLIC_API_BASE_URL` env var same problem |
| `src/lib/api/audioTranscription.ts` | `${NEXT_PUBLIC_API_BASE_URL}/api/audio/transcribe-local` AND `${NEXT_PUBLIC_API_BASE_URL}/api/audio/transcribe` (two functions: `transcribeAudioFromPath`, `transcribeAudioFromFile`) | Same env var |

These bypasses violate **master plan goal G4** (no browser→backend direct calls). They also mean the requests skip auth header injection and the new backend middleware will reject them with 401 once S01 lands.

The fix is conceptually simple: for each direct call, create (or reuse) a Next.js proxy route under `src/app/api/`, then refactor the client file to use `http.*` from S03 against the proxy. After this, both `NEXT_PUBLIC_*` env vars are deleted entirely.

**Important pre-existing state (verified at spec time):**
- `src/app/api/intent-detection/route.ts` ALREADY EXISTS as a hand-rolled handler that imports `detectIntent` IN-PROCESS (no fetch). It is mounted at `/api/intent-detection`, NOT `/api/intent-detection/detect`. The browser side currently does not call this Next.js route at all — it calls the backend directly. S06 must (a) introduce a proper proxy route and (b) decide how to handle the existing in-process consumers (`src/app/api/video-editing-chat/route.ts` and the existing `src/app/api/intent-detection/route.ts` itself) so they do not break when `detectIntent` is rewritten to use `http.*` (which throws on the server). See Section 4.1 and Section 9.
- `src/app/api/llm/` directory does NOT exist. The proxy route is genuinely new.
- `src/app/api/audio/transcribe-local/` directory does NOT exist. The proxy route is genuinely new. `src/app/api/audio/transcribe/` also does NOT exist and must be created for `transcribeAudioFromFile`.

---

## 2. Acceptance Criteria

1. `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" src/` returns ZERO matches
2. `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" .env*` (root + `backend-services/basic-service/`) shows the variables are removed from `env.template` (and any other tracked `.env*` files). Operator-local `.env.local` files are not tracked, but the PR description must instruct operators to remove these vars
3. `src/lib/intent-detection-service.ts` no longer reads `process.env` for any URL; its `detectIntent(userMessage, enabledWorkflows, conversationHistory?)` function uses `http.post('/api/intent-detection/detect', body)` from S03 — see Section 4.1 for the in-process server-side import problem and its resolution
4. `src/lib/api/llm.ts` no longer reads `process.env` for any URL; its `fetchLLMModels()` function uses `http.get('/api/llm/models')` from S03
5. `src/lib/api/audioTranscription.ts` no longer reads `process.env` for any URL; BOTH `transcribeAudioFromPath(request)` AND `transcribeAudioFromFile(file, options?)` use `http.upload(...)` from S03 against `/api/audio/transcribe-local` and `/api/audio/transcribe` respectively
6. Four Next.js proxy routes EXIST under `src/app/api/`:
   - `src/app/api/intent-detection/detect/route.ts` — NEW. Proxies to backend `/api/intent-detection/detect` (Pattern A from S04)
   - `src/app/api/llm/models/route.ts` — NEW. Proxies to backend `/api/llm/models` (Pattern A from S04)
   - `src/app/api/audio/transcribe-local/route.ts` — NEW. Proxies to backend `/api/audio/transcribe-local` (Pattern C from S04 — extended timeout, see Section 4.3)
   - `src/app/api/audio/transcribe/route.ts` — NEW. Proxies to backend `/api/audio/transcribe` (Pattern C from S04 — extended timeout, see Section 4.3)
   - The pre-existing `src/app/api/intent-detection/route.ts` is RETIRED in this spec — see Section 4.1 for the migration of its in-process consumers
7. All 4 new proxy routes use the `createPassthroughRoute` helper from S04, NOT hand-rolled fetch boilerplate
8. All 4 new proxy routes forward `Authorization` header (handled automatically by the helper)
9. The 3 client files keep their existing exported function signatures so consumers do not need changes (specifically: `detectIntent(userMessage, enabledWorkflows, conversationHistory?)`, `fetchLLMModels()`, `transcribeAudioFromPath(request)`, `transcribeAudioFromFile(file, options?)`, and the non-API helper `formatSubtitleTime` is left untouched)
10. Audio transcription's file-upload path is preserved: `FormData` with the file/file_path is sent through `http.upload`, the proxy route forwards multipart unchanged, and the backend receives the file with content-type intact
11. Unit tests in `src/lib/api/__tests__/` exist for the migrated `llm.ts` and `audioTranscription.ts` clients (intent-detection has its test file at `src/lib/__tests__/intent-detection-service.test.ts` since it lives in `src/lib/`, not `src/lib/api/`)
12. The audit deliverable `docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md` documents: each removed env var, each new route created, the disposition of the pre-existing `intent-detection/route.ts`, and the final grep results proving AC #1
13. **Backend allowlist verification (cross-spec):** S01's allowlist does NOT include `/api/intent-detection/*`, `/api/llm/*`, or `/api/audio/*`. Therefore, after this spec lands, anonymous calls to all four new endpoints return 401 — confirming master plan G3 (login required for all business endpoints)
14. The two server-side in-process consumers of `detectIntent` (`src/app/api/video-editing-chat/route.ts` and the pre-existing `src/app/api/intent-detection/route.ts`) are migrated per Section 4.1 so that nothing on the Next.js server side imports `detectIntent` from `@/lib/intent-detection-service` anymore (the file becomes browser-only after refactor)

---

## 3. Inventory of Direct Calls (verified at spec time)

| File | Function | Method | Backend path | Env var | Body type |
|---|---|---|---|---|---|
| `src/lib/intent-detection-service.ts` | `detectIntent(userMessage, enabledWorkflows, conversationHistory?)` | POST | `/api/intent-detection/detect` | `NEXT_PUBLIC_BACKEND_URL` | JSON `{ user_message, enabled_workflows, conversation_history }`, returns `IntentDetectionResult` |
| `src/lib/api/llm.ts` | `fetchLLMModels()` | GET | `/api/llm/models` | `NEXT_PUBLIC_API_BASE_URL` | (none); returns `LLMModel[]` extracted from `LLMModelsResponse.models` |
| `src/lib/api/audioTranscription.ts` | `transcribeAudioFromPath(request)` | POST | `/api/audio/transcribe-local` | `NEXT_PUBLIC_API_BASE_URL` | `FormData` with `file_path` string + form fields (language, use_itn, use_punc, max_lines, words_per_line, generate_srt_file) |
| `src/lib/api/audioTranscription.ts` | `transcribeAudioFromFile(file, options?)` | POST | `/api/audio/transcribe` | `NEXT_PUBLIC_API_BASE_URL` | `FormData` with `file` File + same form fields |

Note: `audioTranscription.ts` also exports a non-API helper `formatSubtitleTime(timeMs)`. This is a pure formatting function, NOT touched by S06.

Verified consumers (grepped at spec time, NOT during implementation):
- `src/lib/intent-detection-service.ts` is consumed by:
  - **`src/app/api/video-editing-chat/route.ts` (SERVER-SIDE Next.js route)** — calls `detectIntent` IN-PROCESS via direct import. This is the critical SSR-style consumer that breaks if `detectIntent` is rewritten naively to use `http-client.ts` (which throws on the server). See Section 4.1 for the resolution.
  - **`src/app/api/intent-detection/route.ts` (the pre-existing Next.js route)** — also calls `detectIntent` IN-PROCESS via direct import. Same problem. Section 4.1 retires this route.
  - No browser-side React component currently imports `detectIntent` — the browser fetches `${NEXT_PUBLIC_BACKEND_URL}/api/intent-detection/detect` only because `detectIntent` itself happens to do the fetch. After refactor, there are still no direct React-side imports; the helper just becomes a thin wrapper around `http.post`.
- `src/lib/api/llm.ts` (`fetchLLMModels`) is consumed by 3 browser-side components:
  - `src/components/workflow/ToArrayConfigPanel.tsx`
  - `src/components/workflow/ResultsCombineConfigPanel.tsx`
  - `src/components/workflow/ChatLLMConfigPanel.tsx`
- `src/lib/api/audioTranscription.ts` (both functions) is consumed by:
  - `src/components/video/ScriptPanel.tsx` (browser-side)

The implementer MUST re-run these greps BEFORE deleting anything to confirm no new consumer has appeared since spec time, and to confirm signatures stay backwards compatible.

---

## 4. Migration Details Per File

### 4.1 intent-detection-service.ts (and its in-process server-side consumers)

**New proxy route** `src/app/api/intent-detection/detect/route.ts` (Pattern A):
- Uses `createPassthroughRoute` from S04, pointing at backend path `/api/intent-detection/detect`.
- No body transformation. No timeout override (Fast LLM is, well, fast).

**Backend mount path verification:** `intent_detection_router` is registered in `app/main.py` WITHOUT a prefix at `app.include_router(intent_detection_router.router)`, and the router itself declares `prefix="/api/intent-detection"`. Final backend URL is `/api/intent-detection/detect`. ✓

**Refactored client** `src/lib/intent-detection-service.ts`:
- Imports `http` from `@/lib/api/http-client`.
- Keeps the `detectIntent(userMessage, enabledWorkflows, conversationHistory?)` signature unchanged.
- Body shape unchanged: `{ user_message, enabled_workflows, conversation_history }`.
- Return type unchanged: `IntentDetectionResult`.
- Removes the `BACKEND_URL` constant, removes the explicit `try/catch` that wraps fetch errors into `{success:false}` envelopes — let `ApiError` propagate per S03 conventions. Validation of empty `userMessage` / empty `enabledWorkflows` MAY remain (it is a pure pre-flight check, not a network/auth concern).
- The verbose `console.log` statements are removed (per S05 §5 convention — let the wrapper own logging).

**Resolution of the in-process consumer problem (CRITICAL):**

After the refactor, `intent-detection-service.ts` becomes browser-only because `http-client.ts` throws when `window` is undefined (S03 §3). Two server-side files currently import `detectIntent` directly:

| File | Current usage | Migration |
|---|---|---|
| `src/app/api/video-editing-chat/route.ts` | Calls `detectIntent(...)` in-process inside the POST handler (line ~118) | Replace the in-process call with a server-to-server `fetch` against `${backendConfig.baseUrl}/api/intent-detection/detect` (using the S02 config module), forwarding the incoming request's `Authorization` header. Equivalent to building a one-line proxy inline. NO new helper needed — this is one route. Alternatively, factor a tiny `callIntentDetectionBackend(payload, authHeader)` server-side helper into `src/lib/api/server/intent-detection.ts` and reuse it in the new proxy route too. The implementer chooses based on what's cleaner. |
| `src/app/api/intent-detection/route.ts` (the pre-existing route) | Hand-rolled handler that imports `detectIntent`, validates body, and forwards | **DELETED.** Its responsibility is fully replaced by the new `/api/intent-detection/detect/route.ts` proxy. Verify (via `grep`) that no external caller depends on the old `/api/intent-detection` path with no `/detect` suffix. If any does, that caller is updated to use `/api/intent-detection/detect`. |

After this migration, NOTHING under `src/app/api/**` imports from `@/lib/intent-detection-service`. The `grep -rn "from '@/lib/intent-detection-service'" src/app/` check returns ZERO matches. The audit records this.

### 4.2 llm.ts (`fetchLLMModels` only — file is single-function in scope)

**New proxy route** `src/app/api/llm/models/route.ts` (Pattern A):
- Uses `createPassthroughRoute` from S04, pointing at backend path `/api/llm/models`.
- No body, no transformation, no timeout override.

**Backend mount path verification:** `llm_router` is registered in `app/main.py` with `app.include_router(llm_router.router, prefix="/api")`, and the router itself declares `prefix="/llm"`. Final backend URL is `/api/llm/models`. ✓

**Refactored client** `src/lib/api/llm.ts`:
- Imports `http` from `@/lib/api/http-client`.
- Keeps the `fetchLLMModels(): Promise<LLMModel[]>` signature unchanged.
- Calls `http.get<LLMModelsResponse>('/api/llm/models')` and returns `response.models` to preserve the existing `LLMModel[]` return contract.
- Removes the `API_BASE_URL` constant, the explicit `try/catch`, and the `console.log` calls.

**Important — single-function file confirmation:** At spec time, `src/lib/api/llm.ts` exports exactly one function (`fetchLLMModels`) plus a type re-import. There is NO mixed-file situation. S05's OOS list correctly defers this entire file to S06. If by implementation time the file has grown new functions, the implementer MUST classify each new function:
- If it calls `NEXT_PUBLIC_*` directly → S06 migrates it the same way.
- If it already calls a Next.js route via raw `fetch` → S06 migrates it to `http.*` (S06 owns the file end-to-end since S05 explicitly excluded it).

Either way, S06 owns 100% of `llm.ts` and S05 owns 0% — there is no overlap.

### 4.3 audioTranscription.ts (BOTH `transcribeAudioFromPath` AND `transcribeAudioFromFile`)

**Two new proxy routes** (the file calls TWO different backend endpoints, NOT one):

1. `src/app/api/audio/transcribe-local/route.ts` (Pattern C — extended timeout):
   - Uses `createPassthroughRoute('/api/audio/transcribe-local', { timeoutMs: 300_000 })`.
   - **300s timeout is required.** The backend endpoint is **synchronous** — `audio_router.transcribe_local_audio` blocks until transcription completes and returns the full subtitle list inline (no task id, no separate status endpoint). Verified at spec time by reading `app/routers/audio_router.py:177-294`.
2. `src/app/api/audio/transcribe/route.ts` (Pattern C — extended timeout):
   - Uses `createPassthroughRoute('/api/audio/transcribe', { timeoutMs: 300_000 })`.
   - Same reason: `audio_router.transcribe_audio` is also synchronous (blocks, returns full result inline). Plus this is a multipart upload (up to 100MB per backend's own size check), so the timeout headroom is even more important.

**Backend mount path verification:** `audio_router` is registered in `app/main.py` with `app.include_router(audio_router.router, prefix="/api")`, and the router declares `prefix="/audio"`. Final URLs are `/api/audio/transcribe-local` and `/api/audio/transcribe`. ✓

**Refactored client** `src/lib/api/audioTranscription.ts`:
- Imports `http` from `@/lib/api/http-client`.
- BOTH functions keep their existing signatures:
  - `transcribeAudioFromPath(request: AudioTranscriptionRequest): Promise<AudioTranscriptionResponse | AudioTranscriptionErrorResponse>` — builds a `FormData` with `file_path` string + the form fields (language, use_itn, use_punc, max_lines, words_per_line, generate_srt_file) and calls `http.upload('/api/audio/transcribe-local', fd)`.
  - `transcribeAudioFromFile(file: File, options?: Omit<AudioTranscriptionRequest, 'file_path'>): Promise<AudioTranscriptionResponse | AudioTranscriptionErrorResponse>` — builds a `FormData` with `file` File + same form fields and calls `http.upload('/api/audio/transcribe', fd)`.
- The non-API helper `formatSubtitleTime(timeMs)` is NOT touched.
- Removes the `API_BASE_URL` constant, removes the explicit `try/catch` that wraps errors into the `AudioTranscriptionErrorResponse` envelope. **Decision point:** S03 errors (`MissingAuthError`, `ApiError`) propagate as exceptions, but the existing return type union allows `AudioTranscriptionErrorResponse`. The implementer MUST pick ONE of:
  - **Option A (recommended):** Drop `AudioTranscriptionErrorResponse` from the return union and let `ApiError` propagate. Update the single consumer `src/components/video/ScriptPanel.tsx` to use try/catch. This aligns with S05 §5 (no console.error / no fake error envelopes).
  - **Option B (compatibility):** Keep the return union and translate caught `ApiError` instances back into `AudioTranscriptionErrorResponse` shape. Less work for the consumer but inconsistent with S05.
  
  The implementer documents the choice in the audit deliverable.
- Removes the verbose `console.log` calls.

The `http.upload` method handles `FormData` correctly (Content-Type set by the browser; multipart boundary generated automatically per S03 §3 / AC #10).

### 4.4 Additional functions discovered during implementation

If `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" src/` reveals MORE files than the 3 listed in Section 3 (e.g., a recently-added file the spec exploration missed), they ALL fall under S06. The implementer MUST migrate them with the same pattern. The audit deliverable must list them.

---

## 5. Removal of env vars

After all 3 source files are migrated:

| File | Action |
|---|---|
| `env.template` (root) | Remove any line setting `NEXT_PUBLIC_BACKEND_URL` or `NEXT_PUBLIC_API_BASE_URL` (if present) |
| `backend-services/basic-service/env.template` | Same (verify; backend env templates rarely contain frontend vars but check) |
| Singapore-01 production `.env` (operational) | Operator removes during deploy. S08's deployment playbook covers this. |
| Developer `.env.local` files | NOT touched (they are gitignored). PR description includes a `# Migration` block telling developers to delete these vars from their local files |

---

## 6. Coordination with S04 routes sweep

S04 sweeps every file under `src/app/api/**/route.ts` that EXISTS at the time the sweep runs. The 4 NEW routes from S06 are added AFTER S04 has finished, so they do NOT need to be re-swept — they are born clean (using `createPassthroughRoute`).

S06 also DELETES one pre-existing file (`src/app/api/intent-detection/route.ts`). If S04 already touched/migrated that file during its sweep, S04's audit row for it becomes invalid post-S06; the integration step must reconcile. The simplest convention: **S06 launches AFTER S04 reports complete**, and S04 explicitly does NOT touch `src/app/api/intent-detection/route.ts` (S06 owns it). S04's escape-hatch list (Pattern E) should explicitly defer this file to S06. The orchestration file (Phase 2.5) enforces the linear dependency.

---

## 7. Test Matrix

### 7.1 New proxy route smoke tests (added to S04's test file or per-route)
| # | Scenario | Expected |
|---|---|---|
| T1 | POST `/api/intent-detection/detect` with valid body (`user_message`, `enabled_workflows`) and valid token | 200, body forwarded to backend |
| T2 | POST `/api/intent-detection/detect` with NO token | 401 (backend middleware enforces) |
| T3 | GET `/api/llm/models` with valid token | 200, `LLMModelsResponse` returned |
| T4 | GET `/api/llm/models` with NO token | 401 |
| T5 | POST `/api/audio/transcribe-local` with FormData (`file_path` + form fields) + valid token | 200, multipart forwarded, sync result inline |
| T6 | POST `/api/audio/transcribe-local` with NO token | 401 |
| T7 | POST `/api/audio/transcribe` with FormData (`file` File + form fields) + valid token | 200, multipart forwarded, sync result inline |
| T8 | POST `/api/audio/transcribe` with NO token | 401 |
| T9 | (Server-side) `src/app/api/video-editing-chat/route.ts` after migration successfully calls intent-detection backend with forwarded auth header | 200, no `window`/`localStorage` access at runtime |

### 7.2 Client unit tests
| # | Scenario | Expected |
|---|---|---|
| C1 | `detectIntent('hello', [...])` calls `http.post('/api/intent-detection/detect', { user_message:'hello', enabled_workflows:[...], conversation_history:null })` | mocked http.post called with correct path + body |
| C2 | `fetchLLMModels()` calls `http.get('/api/llm/models')` and returns the `models` array from the response | mocked http.get called correctly, return value is `LLMModel[]` |
| C3 | `transcribeAudioFromPath({ file_path:'/tmp/x.mp3' })` calls `http.upload('/api/audio/transcribe-local', formData)` with `file_path` appended | mocked http.upload called with FormData containing `file_path` |
| C4 | `transcribeAudioFromFile(file)` calls `http.upload('/api/audio/transcribe', formData)` with the File appended under key `file` | mocked http.upload called with FormData containing the file |
| C5 | `detectIntent` propagates `MissingAuthError` from http-client | error propagates (or — under Option B in §4.3 — translates to `{success:false}` envelope; consistent with chosen option) |
| C6 | `fetchLLMModels` propagates `SessionExpiredError` from http-client | error propagates |
| C7 | `transcribeAudioFromPath` and `transcribeAudioFromFile` propagate / translate `ApiError` per the chosen option in §4.3 | behavior matches chosen option, documented in audit |

---

## 8. Files to Create / Modify

| File | Action | LoC est |
|---|---|---|
| `src/app/api/intent-detection/detect/route.ts` | Create | ~3 |
| `src/app/api/intent-detection/route.ts` | **Delete** (its responsibility moves to the new `/detect` proxy; pre-existing in-process import is removed) | -77 |
| `src/app/api/llm/models/route.ts` | Create | ~3 |
| `src/app/api/audio/transcribe-local/route.ts` | Create | ~3 |
| `src/app/api/audio/transcribe/route.ts` | Create | ~3 |
| `src/app/api/video-editing-chat/route.ts` | Modify (replace in-process `detectIntent` import + call with a server-to-server fetch using `backendConfig.baseUrl`, forwarding `Authorization`) | net +5 |
| `src/lib/intent-detection-service.ts` | Modify (becomes browser-only `http.post` wrapper) | net -50 |
| `src/lib/api/llm.ts` | Modify (single function `fetchLLMModels`) | net -25 |
| `src/lib/api/audioTranscription.ts` | Modify (BOTH `transcribeAudioFromPath` and `transcribeAudioFromFile`; `formatSubtitleTime` untouched) | net -50 |
| `src/lib/__tests__/intent-detection-service.test.ts` | Create | ~80 |
| `src/lib/api/__tests__/llm.test.ts` | Create | ~50 |
| `src/lib/api/__tests__/audioTranscription.test.ts` | Create (covers BOTH functions) | ~120 |
| `env.template` (root) | Modify (remove any `NEXT_PUBLIC_BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL` lines if present) | ~-3 |
| `docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md` | Create | ~100 |

**Estimated total: net source LoC reduction ~190 lines (boilerplate removal + retired hand-rolled route). New tests add ~250 lines.**

---

## 9. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| `llm.ts` exports MORE functions by implementation time (mixed file) | S06 owns the entire file (S05 explicitly excluded it). Migrate every function inside, classifying each per Section 4.2's "Important — single-function file confirmation" note |
| `intent-detection-service.ts` is consumed server-side by `video-editing-chat/route.ts` and the pre-existing `intent-detection/route.ts` | **CONFIRMED at spec time, RESOLVED in Section 4.1.** The pre-existing `intent-detection/route.ts` is deleted. The `video-editing-chat/route.ts` consumer is rewritten to call the backend directly via `backendConfig.baseUrl` + forwarded `Authorization` header (server-to-server), bypassing `intent-detection-service.ts` entirely. After migration, `intent-detection-service.ts` is browser-only and ZERO server-side files import from it. The grep `grep -rn "from '@/lib/intent-detection-service'" src/app/` returns no matches |
| Either audio transcription function is called from a Web Worker | `http-client.ts` accesses `window.localStorage`. Web Workers don't have `window`. Verified at spec time: `ScriptPanel.tsx` is the only consumer and runs on the main thread. The implementer MUST re-grep `*.worker.ts` for `transcribeAudioFromPath` and `transcribeAudioFromFile` to confirm |
| Backend `/api/audio/transcribe-local` and `/api/audio/transcribe` body size limit | The Next.js proxy has its own body size limit. The App Router under Next.js 15 streams multipart by default; the helper from S04 must NOT call `req.json()` for multipart. Pattern C (Section 4.3) is configured with `timeoutMs: 300_000`. The backend enforces 100MB max on `/api/audio/transcribe`; verify the proxy helper does NOT silently truncate requests that exceed Next.js defaults — if it does, S04's helper must support large multipart bodies (this is a coordination point with S04) |
| `NEXT_PUBLIC_BACKEND_URL` is referenced in a comment but not actively used | Remove the comment too — leaving it confuses future developers |
| The 4 backend endpoints return non-JSON content | All four return JSON (verified: intent-detection returns `IntentDetectionResponse`, llm returns `LLMModelsResponse`, both audio routes return `AudioTranscriptionResponse | AudioTranscriptionErrorResponse`). Pattern A/C buffering is correct; Pattern D streaming is NOT needed |
| The audit must distinguish "deleted" vs "created" routes for `intent-detection` | The audit table includes a "Disposition" column for the pre-existing `intent-detection/route.ts` (Deleted) and the new `intent-detection/detect/route.ts` (Created). The grep verification block proves no orphaned imports remain |

---

## 10. Coordination Notes for Other Agents

- **For S04 (routes sweep):** S06 creates NEW routes after S04's sweep, AND deletes one pre-existing route (`src/app/api/intent-detection/route.ts`). The new routes are born using the helper. S04's sweep MAY have already touched the deleted route (if it existed at sweep time and used `process.env.BACKEND_URL`); S04's audit should be cross-checked against S06's deletion list at integration time. S06 also REQUIRES that S04's `createPassthroughRoute` helper supports large multipart uploads (~100MB) — if it does not, this is a blocker that must be raised to S04 before S06 begins
- **For S05 (lib/api refactor):** S05 explicitly excludes `audioTranscription.ts`, `llm.ts`, and `intent-detection-service.ts` from its scope (verified: S05 §3 OOS rows for files #10, #11, plus S05 §11 final OOS list). S06 owns these 3 files end-to-end. There must be NO overlap to avoid race conditions
- **For S07 (testing):** Integration tests should verify: anonymous → 401 on each of the 4 new proxy routes, logged-in → 200 / valid response on each. Production smoke includes all 4 paths. Additionally, an end-to-end test for the migrated `video-editing-chat` route (which now does server-to-server intent detection) confirms it works without `window`
- **For S08 (deployment):** The deployment playbook MUST instruct the operator to remove `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_API_BASE_URL` from `/root/ecliptrix/.env` on Singapore-01. They become no-ops post-deploy (nothing reads them) but cleanliness matters for future audits

---

## 11. Out of Scope

- Migrating direct calls to OTHER backends (third-party LLM APIs, OpenAI, etc.) — those are intentional client-side calls and stay
- Server-side rendering of intent detection / model lists — these are user-action triggered, not initial-render data
- Caching the model list — separate optimization ticket
- Adding rate limiting to the new proxy routes — handled by Nginx in front
- Removing the backend's `intent_detection_router` `/detect` endpoint — the backend route stays; only the BROWSER calling pattern changes
- Adding new functions to `llm.ts`, `audioTranscription.ts`, or `intent-detection-service.ts` — S06 only migrates existing functions; new endpoints are separate work
- Re-shaping any of the four migrated functions' public signatures — consumers (`ScriptPanel.tsx`, the 3 workflow config panels, `video-editing-chat/route.ts`) are NOT updated except to match the unchanged signatures
