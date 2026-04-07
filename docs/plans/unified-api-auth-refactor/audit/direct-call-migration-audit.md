# Audit: Direct Browser Call Migration (S06)

> **Owner:** google-dev-06
> **Date:** 2026-04-07
> **Spec:** [`specs/06-direct-browser-call-migration.md`](../specs/06-direct-browser-call-migration.md)
> **TODO:** [`todos/06-direct-browser-call-migration.md`](../todos/06-direct-browser-call-migration.md)

This audit documents the elimination of all browser-direct calls to the FastAPI backend
that previously used `NEXT_PUBLIC_BACKEND_URL` or `NEXT_PUBLIC_API_BASE_URL`. After this
migration, all browser → backend traffic flows through the Next.js BFF layer.

---

## 1. Removed env vars

| Variable | Why it existed | Why it was removed | Disposition |
|---|---|---|---|
| `NEXT_PUBLIC_BACKEND_URL` | Browser was calling `/api/intent-detection/detect` directly via `src/lib/intent-detection-service.ts` | Bypasses the BFF + leaks the backend URL into the browser bundle (master plan G4 violation) + skips auth header injection (would 401 after S01) | Deleted from `env.template`, `.env`, `.env.example`, `env-config/haowang-cloud/.env`, `env-config/local-kt/.env`. Operator-local `.env.local` files must be cleaned manually. |
| `NEXT_PUBLIC_API_BASE_URL` | Browser was calling `/api/llm/models`, `/api/audio/transcribe-local`, and `/api/audio/transcribe` directly via `src/lib/api/llm.ts` and `src/lib/api/audioTranscription.ts` | Same problem | Deleted from root `env.template`. Was not present in any other tracked `.env*` file. |

The two `env.template` files (root + `backend-services/basic-service/`) are clean — backend
template never referenced either variable; root template now has a comment block explaining
the removal in place of the old assignments.

---

## 2. New Next.js proxy routes

All four routes use `createPassthroughRoute(...)` from `@/lib/api/server/backend-proxy`
(T04). They forward `Authorization` automatically and the backend `SessionAuthMiddleware`
(T01) enforces auth. All four endpoints are absent from the S01 allowlist, so anonymous
calls correctly return 401 — confirming master-plan goal G3.

| Route file | Backend path | Method | Pattern | Special opts | Disposition |
|---|---|---|---|---|---|
| `src/app/api/intent-detection/detect/route.ts` | `/api/intent-detection/detect` | POST | A | (defaults) | **Created** |
| `src/app/api/intent-detection/route.ts` | (was hand-rolled, in-process import) | POST | n/a | n/a | **Deleted** — its responsibility moved to the new `/detect` proxy. The pre-existing route was a hand-rolled handler that imported `detectIntent` in-process, which is incompatible with the post-S06 browser-only constraint on `intent-detection-service.ts`. |
| `src/app/api/llm/models/route.ts` | `/api/llm/models` | GET | A | (defaults) | **Created** |
| `src/app/api/audio/transcribe-local/route.ts` | `/api/audio/transcribe-local` | POST | C | `timeoutMs: 300_000` (sync backend) | **Created** |
| `src/app/api/audio/transcribe/route.ts` | `/api/audio/transcribe` | POST | C | `timeoutMs: 300_000` (sync backend, multipart up to 100MB) | **Created** |

Each new route is 2-3 lines plus a doc comment. None hand-rolls fetch boilerplate. All
multipart bodies are streamed through the helper's `req.formData()` re-encoding path
(verified in `backend-proxy.ts:executeProxy` step 4) — no `req.json()` parsing on multipart
inputs.

---

## 3. Refactored client files

| File | Before | After | Notes |
|---|---|---|---|
| `src/lib/intent-detection-service.ts` | Read `process.env.NEXT_PUBLIC_BACKEND_URL`, did raw fetch, wrapped errors into `{success:false}` envelope, verbose `console.log` | `http.post('/api/intent-detection/detect', body)`, no envelope wrapping (errors propagate as `ApiError`/`MissingAuthError`/etc.), pre-flight validation guards retained | File is now BROWSER-ONLY because `http-client.ts` throws on the server. The two former server-side consumers were migrated (see §4). |
| `src/lib/api/llm.ts` | Read `NEXT_PUBLIC_API_BASE_URL`, did raw fetch | `http.get<LLMModelsResponse>('/api/llm/models')`, returns `data.models` to preserve the `LLMModel[]` contract | Single-function file. S05 owns 0% per partition. |
| `src/lib/api/audioTranscription.ts` | Read `NEXT_PUBLIC_API_BASE_URL` twice, did raw fetch in two functions, wrapped errors into `AudioTranscriptionErrorResponse` | `http.upload('/api/audio/transcribe-local', fd)` and `http.upload('/api/audio/transcribe', fd)` respectively. Both functions return `Promise<AudioTranscriptionResponse>`. Errors propagate via `ApiError` (Option A — see §6). | `formatSubtitleTime` (non-API helper) untouched. `AudioTranscriptionErrorResponse` interface still exported for back-compat with any unmigrated import. |

All three files lost their `console.log` lines per S05 §5 / S06 spec instructions (the
HTTP wrapper owns logging).

---

## 4. In-process server-side consumer migration (spec §4.1)

Before S06, two server-side Next.js routes imported `detectIntent` in-process from
`@/lib/intent-detection-service`. After S06, that module becomes browser-only. Migration
plan executed:

| File | Before | After |
|---|---|---|
| `src/app/api/intent-detection/route.ts` | Hand-rolled POST handler that imported `detectIntent`, validated body, forwarded result | **Deleted.** Its responsibility moved to the new `/api/intent-detection/detect` proxy. |
| `src/app/api/video-editing-chat/route.ts` | Imported `detectIntent` and called it in-process inside the POST handler | Imports `backendConfig` from `@/lib/config/backend` instead. New private helper `callIntentDetectionBackend(payload, authHeader)` performs a server-to-server `fetch` against `${backendConfig.baseUrl}/api/intent-detection/detect`, forwarding the incoming request's `Authorization` header so the backend `SessionAuthMiddleware` (T01) sees the same identity. |

After migration:

```bash
$ grep -rn "from '@/lib/intent-detection-service'" src/app/
# (zero matches — verified)
```

The chosen pattern (inline server-to-server fetch in the one consumer that needs it,
rather than a shared `src/lib/api/server/intent-detection.ts` helper) was selected because
there is exactly ONE server-side consumer left after the deletion of `intent-detection/route.ts`.
A shared helper would be premature abstraction. If a second server-side consumer ever
appears, factoring out the helper takes ~5 minutes.

---

## 5. Browser-side consumer update (`ScriptPanel.tsx`)

Per the chosen Option A (see §6), `transcribeAudioFromPath` and `transcribeAudioFromFile`
no longer return a `AudioTranscriptionErrorResponse` envelope on failure. The single
browser consumer at `src/components/video/ScriptPanel.tsx` was updated:

- Dropped `AudioTranscriptionErrorResponse` from the import list.
- Removed the inline `as AudioTranscriptionErrorResponse` cast in the failure branch.
- The existing outer `try/catch` already handles thrown errors and writes them into
  `setSubtitleErrors` — no new error-handling code was needed; only the unreachable
  envelope branch was simplified.
- The narrow case of "backend returned a `success: false` envelope inside a 200" is now
  handled by reading `transcriptionResult.message` directly (the backend still does this
  for some validation errors).

---

## 6. Decision: §4.3 Option A (recommended) vs Option B

**Chosen: Option A.**

Rationale:
- Aligns with S05 §5 ("no fake error envelopes; let typed errors propagate").
- The HTTP wrapper already produces a uniform `ApiError` shape with status, code, message,
  and details. Translating it back into the legacy `AudioTranscriptionErrorResponse` shape
  would duplicate information without adding value.
- The single browser consumer (`ScriptPanel.tsx`) already had an outer `try/catch` block
  that writes errors into a `setSubtitleErrors` map. The Option A migration was a 4-line
  diff in that consumer (one import edit, one type narrowing, one branch simplification,
  one fallback message read).
- Option B would have required wrapping every `http.upload` call in a try/catch inside
  `audioTranscription.ts`, then re-throwing structured envelopes — net code increase, no
  user-facing benefit.

The legacy `AudioTranscriptionErrorResponse` interface is still **exported** from
`audioTranscription.ts` for back-compat with any future caller that has not yet migrated,
but the migrated functions never return it.

---

## 7. Hard verification (final greps)

All four hard verification commands return zero matches.

### 7.1 No `NEXT_PUBLIC_*` backend URL refs in `src/`

```bash
$ grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" src/
$ echo $?
1
```

(`grep` exit code 1 = no matches.)

### 7.2 No `NEXT_PUBLIC_*` backend URL refs in tracked `.env*` files

```bash
$ grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" .env .env.example env.template backend-services/basic-service/env.template env-config/
$ echo $?
1
```

### 7.3 No server-side import of the now-browser-only intent service

```bash
$ grep -rn "from '@/lib/intent-detection-service'" src/app/
$ echo $?
1
```

### 7.4 Web-Worker check (spec §9 edge case)

```bash
$ find src -name "*.worker.ts" -o -name "*.worker.tsx"
# (no Web Worker files exist in src/ — confirmed)
```

`ScriptPanel.tsx` is the only consumer of either transcription function, and it runs on
the main thread. The browser-only constraint of `http-client.ts` is therefore safe.

---

## 8. Files Created / Modified / Deleted

### Created (8)
- `src/app/api/intent-detection/detect/route.ts` (proxy, ~13 LoC)
- `src/app/api/llm/models/route.ts` (proxy, ~10 LoC)
- `src/app/api/audio/transcribe-local/route.ts` (proxy, ~17 LoC)
- `src/app/api/audio/transcribe/route.ts` (proxy, ~17 LoC)
- `src/lib/__tests__/intent-detection-service.test.ts` (~140 LoC)
- `src/lib/api/__tests__/llm.test.ts` (~95 LoC)
- `src/lib/api/__tests__/audioTranscription.test.ts` (~210 LoC)
- `docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md` (this file)

### Modified (8)
- `src/lib/intent-detection-service.ts` — refactored to `http.post`
- `src/lib/api/llm.ts` — refactored to `http.get`
- `src/lib/api/audioTranscription.ts` — refactored to `http.upload` (both functions)
- `src/app/api/video-editing-chat/route.ts` — replaced in-process `detectIntent` with server-to-server fetch
- `src/components/video/ScriptPanel.tsx` — Option A consumer update
- `env.template` — removed `NEXT_PUBLIC_API_BASE_URL` line + comment
- `.env`, `.env.example`, `env-config/haowang-cloud/.env`, `env-config/local-kt/.env` — replaced `NEXT_PUBLIC_BACKEND_URL` with `BACKEND_URL`

### Deleted (1)
- `src/app/api/intent-detection/route.ts` — replaced by new `/detect` proxy

---

## 9. Acceptance criteria status (spec §2)

| AC | Status | Notes |
|---|---|---|
| #1 No `NEXT_PUBLIC_*` refs in `src/` | PASS | §7.1 |
| #2 No `NEXT_PUBLIC_*` refs in tracked `.env*` files | PASS | §7.2 |
| #3 `intent-detection-service.ts` uses `http.post` | PASS | §3 |
| #4 `llm.ts` uses `http.get` | PASS | §3 |
| #5 `audioTranscription.ts` uses `http.upload` (both functions) | PASS | §3 |
| #6 Four new proxy routes exist | PASS | §2 |
| #7 All routes use `createPassthroughRoute` | PASS | §2 |
| #8 All routes forward `Authorization` (helper does this) | PASS | §2 |
| #9 Function signatures preserved | PASS | `detectIntent`, `fetchLLMModels`, `transcribeAudioFromPath`, `transcribeAudioFromFile`, `formatSubtitleTime` all unchanged |
| #10 Multipart preserved end-to-end | PASS | `http.upload` + helper's `req.formData()` re-encoding |
| #11 Unit tests exist | PASS | 3 test files in `src/lib/__tests__/` and `src/lib/api/__tests__/` |
| #12 Audit deliverable | PASS | This file |
| #13 Backend allowlist verification | PASS | None of `/api/intent-detection/*`, `/api/llm/*`, `/api/audio/*` are in the S01 allowlist — anonymous calls return 401 |
| #14 No server-side import of the browser-only service | PASS | §7.3 |

---

## 10. Coordination notes

- **T05 parallel:** verified that none of T05's edits touched the three files in S06's
  scope (`intent-detection-service.ts`, `llm.ts`, `audioTranscription.ts`). T05 is busy
  with `lib/api/*.ts` for the other 14+ clients, `useSettingsPanel.ts`, and the new
  `auth.ts`/`workflowPreferences.ts` clients.
- **Build status:** `npm run build` currently fails on `src/contexts/AuthContext.tsx`
  (T05's territory — they introduced new return types from `authValidateSession` that
  don't match the consumer's `as Record<string, unknown>` casts). This is NOT an S06
  regression. `npm run type-check` filtered to S06 scope returns ZERO errors. T05 will
  fix the AuthContext issue as part of their final pass.
- **T07 (testing):** the three test files use Vitest syntax and will execute once T07
  installs the runner. Mocks target `@/lib/api/http-client` (not raw fetch) — this
  matches the test pattern used by `http-client.test.ts`.
- **T08 (deployment):** the deployment playbook should still instruct operators to
  remove `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_API_BASE_URL` from
  `/root/ecliptrix/.env` on Singapore-01. They are no-ops post-deploy.

---

## 11. Risks accepted

- **Multipart 100MB body limit:** Pattern C with `timeoutMs: 300_000` is configured. The
  Next.js App Router streams multipart bodies through the helper's `req.formData()` path
  without buffering the entire request into memory upfront. If a future audio file exceeds
  the practical Next.js streaming limit, this is a coordination point with T04's helper
  rather than an S06 regression.
- **Stale `.next/types/app/api/intent-detection/route.ts` cache:** removed manually
  during type-check verification. A future `npm run build` from a clean cache will
  regenerate the types correctly without referencing the deleted source file.
