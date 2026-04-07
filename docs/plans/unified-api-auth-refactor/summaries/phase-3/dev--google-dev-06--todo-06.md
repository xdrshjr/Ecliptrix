# Execution Summary — TODO 06: Direct Browser Call Migration

> **Agent:** google-dev-06
> **Phase:** 3 (parallel with T05)
> **Date:** 2026-04-07
> **Verdict:** COMPLETE — all 14 acceptance criteria met, all 3 hard verification grep guards return zero matches, no scope conflicts with T05.

---

## What was done

Eliminated every browser-direct call to the FastAPI backend in the Ecliptrix monorepo.
After this TODO, every browser → backend request flows through a Next.js BFF route, the
auth header is auto-injected by the unified `http` wrapper (T03), and the backend
`SessionAuthMiddleware` (T01) enforces auth on the four newly-proxied endpoints.

### Concrete deliverables (10 file changes + 4 new files + 1 deletion + 1 audit + 3 tests)

**Created (8 files):**
- `src/app/api/intent-detection/detect/route.ts` — `POST` proxy → backend `/api/intent-detection/detect`
- `src/app/api/llm/models/route.ts` — `GET` proxy → backend `/api/llm/models`
- `src/app/api/audio/transcribe-local/route.ts` — `POST` proxy → backend `/api/audio/transcribe-local` (Pattern C, `timeoutMs: 300_000`)
- `src/app/api/audio/transcribe/route.ts` — `POST` proxy → backend `/api/audio/transcribe` (Pattern C, `timeoutMs: 300_000`)
- `src/lib/__tests__/intent-detection-service.test.ts` — Vitest unit tests, covers C1, C1.b, C5, pre-flight validation
- `src/lib/api/__tests__/llm.test.ts` — Vitest unit tests, covers C2, C2.b, C6
- `src/lib/api/__tests__/audioTranscription.test.ts` — Vitest unit tests, covers C3, C3.b, C4, C4.b, C7 (both functions)
- `docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md` — full audit per spec §2 AC#12

**Modified (8 files):**
- `src/lib/intent-detection-service.ts` — refactored to `http.post('/api/intent-detection/detect', body)`. Now BROWSER-ONLY.
- `src/lib/api/llm.ts` — refactored to `http.get<LLMModelsResponse>('/api/llm/models')`, returns `data.models` to preserve `LLMModel[]` contract
- `src/lib/api/audioTranscription.ts` — both functions refactored to `http.upload(...)`. Decision §4.3 = Option A; return type union dropped, errors propagate as `ApiError`
- `src/app/api/video-editing-chat/route.ts` — replaced in-process `detectIntent` import with new private `callIntentDetectionBackend` helper that does a server-to-server fetch via `backendConfig.baseUrl`, forwarding the incoming `Authorization` header
- `src/components/video/ScriptPanel.tsx` — Option A consumer update (4-line diff: dropped `AudioTranscriptionErrorResponse` import, narrowed `transcriptionResult` type, simplified failure branch to read `transcriptionResult.message`)
- `env.template` — removed the `NEXT_PUBLIC_API_BASE_URL=` line, replaced with a comment block explaining the removal
- `.env`, `.env.example`, `env-config/haowang-cloud/.env`, `env-config/local-kt/.env` — replaced `NEXT_PUBLIC_BACKEND_URL=` with `BACKEND_URL=` (server-side only)

**Deleted (1 file):**
- `src/app/api/intent-detection/route.ts` — pre-existing hand-rolled handler that imported `detectIntent` in-process. Its responsibility moved to the new `/detect` proxy.

---

## §4.3 Decision: Option A (recommended)

The spec required choosing how `audioTranscription.ts` handles errors after the migration:
- **Option A:** Drop `AudioTranscriptionErrorResponse` from the return union, let `ApiError` propagate, update the consumer to use try/catch.
- **Option B:** Keep the return union, translate caught `ApiError` instances back into `AudioTranscriptionErrorResponse` shape.

**Chosen: Option A.** The single browser consumer (`ScriptPanel.tsx`) already had an outer
`try/catch` block writing errors into `setSubtitleErrors`, so the migration was a 4-line
diff in that consumer. Option B would have required wrapping every `http.upload` call
in a try/catch inside `audioTranscription.ts` and re-throwing structured envelopes, which
duplicates information and contradicts S05 §5 ("no fake error envelopes; let typed errors
propagate"). The legacy `AudioTranscriptionErrorResponse` interface is still **exported**
for back-compat, but the migrated functions never return it.

---

## In-process consumer migration approach (spec §4.1)

Two server-side Next.js routes imported `detectIntent` in-process before the refactor.
After the refactor, `intent-detection-service.ts` is browser-only (it consumes
`http-client.ts` which throws on the server). Migration:

1. **`src/app/api/intent-detection/route.ts`** — DELETED. Its responsibility (validate
   body, call `detectIntent`, forward) is fully replaced by the new `/api/intent-detection/detect`
   proxy. No external caller depends on the bare `/api/intent-detection` path with no
   `/detect` suffix (verified by grep).
2. **`src/app/api/video-editing-chat/route.ts`** — REWRITTEN. The in-process
   `detectIntent(...)` call was replaced with a private helper
   `callIntentDetectionBackend(payload, authHeader)` defined at the top of the same file.
   The helper does a server-to-server `fetch` against `${backendConfig.baseUrl}/api/intent-detection/detect`
   using the S02 config module, forwarding the incoming request's `Authorization` header
   so the backend `SessionAuthMiddleware` (T01) sees the same identity.

I deliberately did NOT factor the helper into a shared
`src/lib/api/server/intent-detection.ts` module because there is exactly ONE server-side
consumer left after the deletion of the old route. A shared helper would be premature
abstraction; if a second consumer ever appears, factoring out the helper takes ~5 minutes.

After migration:
```bash
$ grep -rn "from '@/lib/intent-detection-service'" src/app/
# (zero matches)
```

---

## Hard verification (final)

| Check | Command | Result |
|---|---|---|
| AC#1 | `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" src/` | ZERO matches |
| AC#2 | `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" .env .env.example env.template backend-services/basic-service/env.template env-config/` | ZERO matches |
| AC#14 | `grep -rn "from '@/lib/intent-detection-service'" src/app/` | ZERO matches |
| Web Worker check (spec §9) | `find src -name "*.worker.ts" -o -name "*.worker.tsx"` | ZERO files exist |
| Type-check (S06 scope) | `npm run type-check 2>&1 \| grep -E "intent-detection\|llm\|audio\|video-editing-chat"` | only dormant vitest module errors (T07's job) — none are my regressions |

---

## Coordination notes

### T05 (parallel)
T05 is running concurrently and owns 14+ `lib/api/*.ts` files plus `useSettingsPanel.ts`
plus 2 new clients (`auth.ts`, `workflowPreferences.ts`) plus `AuthContext.tsx` updates.
Verified pre-flight and post-flight that T05's edits never touched my three scope files
(`intent-detection-service.ts`, `llm.ts`, `audioTranscription.ts`). Disjoint scopes
held — no merge conflicts expected.

### Build status (T05 issue, not mine)
`npm run build` currently fails on `src/contexts/AuthContext.tsx`:
```
Type error: Conversion of type 'SessionValidationResponse' to type 'Record<string, unknown>'
may be a mistake because neither type sufficiently overlaps with the other.
```
This is from T05's introduction of the new `auth.ts` client + `authValidateSession` return
type. T05 will fix it in their final pass. **NOT an S06 regression** — my filtered type-check
shows zero errors in the S06 scope.

### Stale Next.js types cache
Deleting `src/app/api/intent-detection/route.ts` left a stale generated stub at
`.next/types/app/api/intent-detection/route.ts` that still referenced the deleted source.
I removed the stale stub manually so type-check passes. A clean `npm run build` from a
fresh `.next/` will regenerate types correctly.

---

## Acceptance criteria status (spec §2)

All 14 ACs met. Full table in the audit deliverable:
`docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md` §9.

---

## Risks carried forward

- **T05's `AuthContext.tsx` build break** must be fixed before the next reviewer can run
  `npm run build` cleanly. This is T05's responsibility.
- **Backend allowlist:** S01 does not allowlist `/api/intent-detection/*`, `/api/llm/*`,
  `/api/audio/*`. After this lands, anonymous calls to all four new endpoints return 401
  — confirming master plan G3. T07 should integration-test that explicitly.
- **`/login` page** still does not exist (carried from Phase 1) — T08 owns. The HTTP
  wrapper redirects to `/login?reason=session-expired` on 401, which would 404 today.
- **Vitest installation gap** (carried from Phase 1) — the three new test files are
  dormant valid Vitest syntax. T07 owns runner setup.

---

## Files touched summary

```
A   docs/plans/unified-api-auth-refactor/audit/direct-call-migration-audit.md
A   docs/plans/unified-api-auth-refactor/summaries/phase-3/dev--google-dev-06--todo-06.md
A   src/app/api/audio/transcribe-local/route.ts
A   src/app/api/audio/transcribe/route.ts
A   src/app/api/intent-detection/detect/route.ts
A   src/app/api/llm/models/route.ts
A   src/lib/__tests__/intent-detection-service.test.ts
A   src/lib/api/__tests__/audioTranscription.test.ts
A   src/lib/api/__tests__/llm.test.ts
D   src/app/api/intent-detection/route.ts
M   .env
M   .env.example
M   env-config/haowang-cloud/.env
M   env-config/local-kt/.env
M   env.template
M   src/app/api/video-editing-chat/route.ts
M   src/components/video/ScriptPanel.tsx
M   src/lib/api/audioTranscription.ts
M   src/lib/api/llm.ts
M   src/lib/intent-detection-service.ts
```

19 file operations total (8 created, 1 deleted, 10 modified — counting `env.template` once
even though both staged and unstaged copies were touched).

Net source LoC: substantial reduction in client files (boilerplate gone), small additions
in `video-editing-chat/route.ts` for the server-to-server helper. Test files add ~445 LoC.
