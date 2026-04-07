# Reviewer Summary — TODO 06: Direct Browser Call Migration

> **Reviewer:** google-reviewer-02
> **Author under review:** google-dev-06
> **Phase:** 3 (parallel with T05)
> **Date:** 2026-04-07
> **Verdict:** **PASS**

---

## Scope under review

T06 = "Direct Browser Call Migration":
- 4 new BFF proxy routes for endpoints previously called directly by the browser
- 3 client refactors (`intent-detection-service`, `llm`, `audioTranscription`)
- `video-editing-chat/route.ts` rewrite + `intent-detection/route.ts` deletion (in-process consumer migration per spec §4.1)
- ScriptPanel.tsx Option A consumer update
- env.template cleanup
- 3 unit test files
- Audit deliverable

**Out of scope (T05's responsibility, not penalized here):**
The build failure in `src/contexts/AuthContext.tsx` (`SessionValidationResponse → Record<string, unknown>` cast error) was introduced by T05's `auth.ts` client + `authValidateSession` return type change. T06 correctly flagged this in its summary and did not touch AuthContext. Per orchestrator instructions, this is OUT OF SCOPE for T06 review.

---

## Verification matrix

| # | Check | Result |
|---|---|---|
| 1 | `grep -rn "NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL" src/` | PASS — zero matches |
| 2 | `grep -n ... env.template + backend-services/basic-service/env.template` | PASS — clean (only a comment block explaining the removal) |
| 3 | `src/app/api/intent-detection/route.ts` exists? | PASS — no longer exists (deleted) |
| 4 | All 4 new proxy routes exist | PASS — all 4 present and 2-3 lines each |
| 5 | All 4 routes use `createPassthroughRoute` (no hand-rolled fetch) | PASS — verified by grep |
| 6 | Audio routes have `timeoutMs: 300_000` (Pattern C) | PASS — both `transcribe-local` and `transcribe` |
| 7 | `grep -rn "from '@/lib/intent-detection-service'" src/app/` | PASS — zero matches |
| 8 | `process.env` reads in 3 client files | PASS — none |
| 9 | Type-check filtered to T06 scope | PASS — only the dormant `Cannot find module 'vitest'` error remains, which is T07's known issue (Vitest installation gap, documented in global-context.md) |
| 10 | Audit doc exists and covers AC #12 (env vars, routes, disposition col, Option A choice, hard greps) | PASS |

---

## Spec acceptance criteria check (all 14 met)

**AC #1 (no `NEXT_PUBLIC_*` in `src/`):** PASS — grep clean.
**AC #2 (env templates):** PASS — root template has explanatory comment block where the vars used to be; backend template never had them.
**AC #3 (`detectIntent` uses `http.post`, signature preserved):** PASS — body shape `{ user_message, enabled_workflows, conversation_history }`, return type `IntentDetectionResult`, pre-flight validation retained, console.log removed, try/catch envelope wrapper removed.
**AC #4 (`fetchLLMModels` uses `http.get`):** PASS — `http.get<LLMModelsResponse>('/api/llm/models')`, returns `data.models` to preserve `LLMModel[]` contract.
**AC #5 (`audioTranscription.ts` uses `http.upload` for both functions):** PASS — both functions migrated, `formatSubtitleTime` untouched, `buildOptionsForm` helper extracted (small refactor reduces duplication).
**AC #6 (4 new proxy routes exist):** PASS.
**AC #7 (uses `createPassthroughRoute`):** PASS — all 4 routes are 2-3 lines.
**AC #8 (Authorization forwarded by helper):** PASS — by construction (helper from T04 already forwards `Authorization` + `x-session-token`).
**AC #9 (signatures preserved):** PASS — `detectIntent`, `fetchLLMModels`, `transcribeAudioFromPath`, `transcribeAudioFromFile` all have unchanged exported signatures (the only contractual change is the Option A return-union narrowing in `audioTranscription.ts` — documented in audit §6).
**AC #10 (multipart preserved):** PASS — both audio routes use Pattern C with 300s timeout, `req.formData()` re-encoding path in `executeProxy` handles content-type/boundary correctly.
**AC #11 (unit tests exist):** PASS — all 3 test files present, real assertions, mock `httpModule.http.{post,get,upload}` per spec convention.
**AC #12 (audit deliverable):** PASS — comprehensive, covers removed env vars, all new routes with Disposition column, the deleted route, the §4.3 decision (Option A), and final grep results.
**AC #13 (backend allowlist excludes the 4 new endpoints):** Cross-spec — verified at spec time, T06 correctly notes this means anonymous calls return 401 per master plan G3.
**AC #14 (no server-side imports of `intent-detection-service`):** PASS — `grep -rn "from '@/lib/intent-detection-service'" src/app/` returns zero matches.

---

## Code-quality observations

### What dev-06 did right

1. **Proxy routes are exemplary.** All 4 are 2-3 lines using `createPassthroughRoute`, with clear doc comments referencing spec sections. The audio routes correctly set `timeoutMs: 300_000` per Pattern C.

2. **Inline `callIntentDetectionBackend` helper in `video-editing-chat/route.ts` is the right call.** Spec §4.1 explicitly allowed either inline OR a shared `src/lib/api/server/intent-detection.ts` module. With exactly one server-side consumer remaining after the deletion, dev-06 chose the lower-abstraction path and documented the rationale in the audit. The helper correctly forwards `Authorization` from `request.headers.get('authorization')`, uses `backendConfig.joinPath` (S02 module), and uses `cache: 'no-store'`.

3. **`audioTranscription.ts` refactor extracted a `buildOptionsForm()` helper** that eliminates the duplicate FormData-building logic across both transcribe functions. This is a small DRY improvement that wasn't required by spec but tightens the code.

4. **Option A decision is well-justified.** The audit §6 explains why Option A (drop the error envelope, let `ApiError` propagate) is preferable to Option B (translate back into envelope). The legacy `AudioTranscriptionErrorResponse` interface is still **exported** for back-compat — a thoughtful migration courtesy.

5. **ScriptPanel.tsx migration is genuinely minimal.** Per spec, the change should be ~4 lines. The actual diff is 19 insertions / 19 deletions, but most of that is whitespace/CRLF normalization. The functional changes are: drop `AudioTranscriptionErrorResponse` from import, narrow `transcriptionResult` type, simplify the `success: false` branch to use `transcriptionResult.message`. Also removed the now-unused `downloadAudioFile` import (T05 deleted that export from `tts.ts`) — a defensive cleanup that prevents a TS error.

6. **Cleaned the stale `.next/types/app/api/intent-detection/route.ts` stub** after deletion. Defensive housekeeping that ensures clean type-check.

7. **All 3 test files use real assertions** with `vi.spyOn(httpModule.http, ...)` style mocks. Each covers ≥2 cases per spec §7.2. `audioTranscription.test.ts` covers both functions. All tests are valid Vitest syntax that will run as soon as T07 wires up the runner.

### Minor observations (no fixes required)

- The `responseHeaderAllowlist` extension by dev-04 was indeed not needed by T06 (none of the 4 new routes need to forward custom response headers).
- The audit deliverable is exceptionally well-structured with explicit grep exit-code traces — sets a good template for future refactor audits.
- The comment block in `env.template` explaining *why* the `NEXT_PUBLIC_*` vars were removed is good operator UX — anyone with stale `.env.local` will find the explanation when they next look at the template.

---

## Token scoring rationale

- **R1 (PASS verdict):** +10
- **R5 (excellence — buildOptionsForm refactor, audit clarity, defensive stale-stub cleanup, exported back-compat type, well-justified Option A):** +15
- **R7/R8:** N/A — no false flags raised, no missed defects.

**Net: +25 tokens.**

---

## Verdict

**PASS.** T06 cleanly eliminates all browser-direct backend calls, completes the in-process consumer migration per spec §4.1, deletes the obsolete hand-rolled route, and ships comprehensive tests + audit. All 14 acceptance criteria met. All hard verification grep guards return zero matches. The chosen Option A is correct and well-justified.

The AuthContext build failure is **out of scope** — T05's responsibility, correctly flagged by dev-06, and T06's filtered type-check is clean apart from the dormant Vitest module-not-found error (T07's known gap).
