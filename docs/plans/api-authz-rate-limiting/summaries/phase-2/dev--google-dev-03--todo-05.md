# DEV Execution Summary — TODO 05 前端 Token 审计与上线 (Frontend Token Audit & Rollout)

## Meta
- **Agent**: google-dev-03
- **Role**: DEV
- **Task**: todo-05 (Frontend Token Audit & Rollout gate)
- **Phase**: 2 (parallel group B, alongside dev-02 / TODO 03)
- **Verdict**: COMPLETED (provisional — pending Reviewer + Tester)

## Key Decisions

1. **Audit, not rewrite.** Per spec/05 §2.1 and dev-01's TODO 01 summary, the
   unified `backend-proxy` helper already forwards `Authorization` +
   `x-session-token` on every proxied call, and `http-client` injects `Bearer`
   by default. So R1's real risk is "verify helper coverage + enumerate the few
   escape hatches," not "patch 100+ routes." Confirmed exhaustively over all
   **118** `src/app/api/**/route.ts` files (no sampling).

2. **Helper coverage is 103/118.** The remaining 15 are escape hatches. **13**
   are third-party LLM/CDN direct calls (no FastAPI backend session) and **2**
   (`video-editing-chat`, `video-editing-agent/chat`) hit the backend but
   already self-enforce auth and forward the token. → 14 of 15 were already
   correct.

3. **Found exactly ONE real flag-on regression and fixed it.**
   `workflow/test-node` validates the caller's session via
   `verifySessionFromRequest`, but its node executors fan out to internal
   same-origin routes (`/api/video-search`, `/api/workflow/tavily-search`,
   `/api/tts/convert-sentences` — all backend-proxied) **without forwarding the
   caller's token**. With `AUTH_ENFORCE_DEFAULT_DENY=true` those internal calls
   would 401 → Pexels/Tavily/TTS node tests break. Fixed by threading the
   caller's token (`buildInternalAuthHeaders`) into every executor's fetch.

4. **Found & fixed a backend rate-category miss (deferred item #2).**
   `_AI_GENERATION_PREFIXES` in `rate_limiter.py` documented `/api/ai-mixed-editing`
   in its comment but omitted it from the tuple → it resolved to `normal`
   (≈300/min) instead of `ai_generation` (≈30/min). Added the one-line prefix
   (task explicitly authorised low-risk one-liners).

5. **Deferred item #1 (`/api/user/health`): flagged, not applied.** Not used by
   the FE; canonical `/api/health` is already allowlisted. Recommended dev-01
   add it to `ALLOWLIST_EXACT` only if an ops monitor pins to it; otherwise
   anon→401 under flag-on is acceptable/expected. Did not widen public surface
   unilaterally.

6. **Media playback correctness clarified.** `<video>`/`<audio>` tags carry
   neither `Authorization` nor a cookie (FE token is in localStorage, not a
   cookie). Media works purely via the PUBLIC_ALLOWLIST prefixes
   (`/api/storage/files/`, `/api/audio/generated/`, `/api/audio/subtitles/`,
   `/static/`). The middleware's cookie fallback is a latent, unused capability.
   So flag-on does NOT break media as long as the allowlist prefixes stay intact.

## Execution Flow
1. Read master-plan, spec/05, todo/05, task-orchestration, global-context, and
   dev-01's TODO 01 summary.
2. **Task A** — verified `backend-proxy.ts` (`buildForwardedHeaders` forwards
   `Authorization`+`x-session-token` on all verbs incl. streaming) and
   `http-client.ts` (`requireAuth` default true, Bearer injection, `http.stream`
   /`http.download` carry auth).
3. **Task B** — enumerated all 118 route files; computed the 103-via-helper /
   15-escape-hatch split via set difference.
4. **Task C** — read all 15 escape-hatch routes + the bare-fetch sweep
   (`fetch('/api/...')`, `EventSource`, `window.open`, `<a download>`, media
   `src`). Traced `test-node`'s internal targets to the backend, and the agent
   tools' `authToken` forwarding (`tools/apiHelper.ts`).
5. **Task D** — applied Fix 1 (`test-node` token forwarding) + Fix 2
   (`ai-mixed-editing` category). Type-checked (`tsc --noEmit`: no errors in
   `src/`; the only `tsc` errors are a pre-existing stale `.next/types/` cache
   referencing non-existent routes — reproduced as pre-existing, unrelated) and
   `py_compile` clean.
6. **Task E/F** — wrote the audit doc (coverage table + escape-hatch
   classification + bare-fetch list + rollout/灰度 checklist) and this summary.

## Artifacts
**Modified:**
- `src/app/api/workflow/test-node/route.ts` — added `buildInternalAuthHeaders()`
  (uses `extractSessionToken` from `sessionGuard`); threaded `authHeaders` into
  all 7 node executors so internal fan-out fetches forward the caller's session.
- `backend-services/basic-service/app/services/rate_limiter.py` — added
  `"/api/ai-mixed-editing"` to `_AI_GENERATION_PREFIXES`.

**Created:**
- `docs/plans/api-authz-rate-limiting/audit/frontend-token-audit.md` — the audit
  deliverable (coverage table, escape-hatch + bare-fetch classification, rollout
  checklist, deferred-item decisions).
- this summary.

## Interfaces Touched (Produces → Consumers)
- **Audit doc** `audit/frontend-token-audit.md` → consumed by **TODO 06**
  (regression acceptance) and **dev-01** (allowlist follow-up for `/api/user/health`).
- **`workflow/test-node` token forwarding** → consumed by TODO 06 integration
  (assert Pexels/Tavily/TTS node tests succeed under flag-on).
- **`/api/ai-mixed-editing` → `ai_generation`** category → consumed by TODO 06
  (assert `resolve_category("/api/ai-mixed-editing") == "ai_generation"`).
- No public API/contract changed; no new env var. The rollout switch remains
  dev-01's `AUTH_ENFORCE_DEFAULT_DENY` (unchanged).

## Issues & Risks
- **R1 (regression):** mitigated. The one real gap (`test-node` fan-out) is
  fixed; everything else verified compliant. Recommend the optional
  grace-logging dry run (§7 step 3 of the audit) before the prod flip as
  belt-and-suspenders.
- **Pre-existing dead path (not my scope):**
  `VideoCoverModal/.../ImageUploadInput.tsx:61` fetches `/api/storage/upload`,
  which does not exist (404 today, flag-agnostic). Should be
  `/api/storage/upload-file`. Flagged for a separate fix; does NOT block the
  rollout.
- **`/api/chat` user-model selection under flag-on:** `/api/chat` resolves creds
  without the caller token → flag-on makes resolve 401 → env-LLM fallback. Chat
  still works; only user-selected model isn't applied for this one route (the
  Agent route is unaffected). Not a functional regression; logged in audit §6.
- **Test env:** `tsc` shows stale `.next/types/` errors (non-existent routes
  like `flux`, `comfyui-health-check`); these are pre-existing build-cache
  artifacts, not from my change — `src/` is clean. Tester should `rm -rf .next`
  before a full build if they want a clean `tsc`.

## Context for Downstream

**For TODO 06 (testing/acceptance) — what to verify in the rollout:**
1. Flag-on matrix (reuse dev-01's): anon protected→401; valid→200; allowlist
   anon→200; `model_settings`/admin anon→401/non-admin→403/admin→200; HARD paths
   →401 even flag-off.
2. **Workflow `test-node` regression (Fix 1):** with flag-on + a valid session,
   the `pexels-video-search`, `tavily-search`, and `volcano-tts` node tests must
   succeed (the internal fan-out now forwards the token). A `chat-llm` node test
   should also still work (third-party LLM, no session needed).
3. **Rate category (Fix 2):** unit-assert
   `resolve_category("/api/ai-mixed-editing") == "ai_generation"`.
4. **Media playback:** flag-on, `<video>`/`<audio>` against `/api/storage/files/`
   + `/api/audio/generated/` + `/api/audio/subtitles/` must still serve (200 /
   206 Range). This depends on the allowlist, NOT on a token.
5. **`/api/user/health`:** anon→401 under flag-on is EXPECTED (see audit §6)
   unless dev-01 allowlists it. Don't treat it as a regression by default.
6. The rollout checklist lives in `audit/frontend-token-audit.md` §7 — including
   the optional grace-logging mode and the independence of
   `AUTH_ENFORCE_DEFAULT_DENY` from the rate-limit `RateLimitConfig.enabled`
   switch.

**For dev-01 (auth coverage follow-up):**
- Decide `/api/user/health` allowlist (audit §6). One-line add to
  `ALLOWLIST_EXACT` if an ops monitor needs it; otherwise leave behind auth.

**For dev-03-future / TODO 04 (FE UI + 429):**
- This audit did NOT touch 429 handling (TODO 04 scope). The new
  `/api/rate-limit/*` proxy routes TODO 04 adds MUST go through
  `createPassthroughRoute` (auto-forwards auth) — they will inherit auth
  forwarding for free, consistent with the 103 helper routes audited here.
