# REVIEWER Summary — Phase 1 (TODO 01 + TODO 02)

## Meta
- **Agent**: google-reviewer-01
- **Role**: REVIEWER
- **Phase**: 1
- **Verdict (Task A — TODO 01, google-dev-01)**: PASS
- **Verdict (Task B — TODO 02, google-dev-02)**: PASS
- **Method**: Static correctness review against `specs/01`, `specs/02`, `master-plan.md`. No test runs (information boundary respected). Read the live code, not just the dev summaries; cross-checked every claimed router path and prefix against the actual source.

## Key Decisions (review-level)
1. **Both tasks PASS with zero fixes applied.** I traced every spec acceptance point to concrete code and verified the load-bearing edge cases (auth gating flag semantics, sliding-window `retry_after` math, category ordering for `/api/audio/generated/`, middleware execution order, `scope["state"]` propagation across the two `BaseHTTPMiddleware` layers). No correctness, completeness, or security defect found that warrants a fix or rework.
2. I independently re-derived the dev claims that are easy to get wrong (HARD_PROTECT path shapes, AI-generation router prefixes, intent-detection real path) rather than trusting the summaries.

## Execution Flow (what I verified)
1. Read master-plan + spec 01 + spec 02 + both dev summaries.
2. **Task A code**: `auth_middleware.py` (allowlist, hard-protect, enforcement gate), `config.py` (`auth_enforce_default_deny` Field + `get_settings()` env wiring), `model_settings_router.py` (router-level `require_admin`), `dependencies/auth.py` (fast/slow path, `require_admin`/`require_root`), `env.template`, `test_auth_middleware.py`.
3. **Task B code**: `rate_limiter.py` (kernel + `Decision` + `get_client_ip` + `resolve_category` + singleton + stats/reset), `rate_limit_config.py` (provider seam + dataclasses + key map), `rate_limit_middleware.py`, `main.py` middleware registration block.
4. **Cross-checks against real source**: confirmed `ai_video_generate`→`/api/workflow/ai-video-generate`, `video_export`→`/api/workflow/video-export` (both inline paths, both have router-level `Depends(get_current_user)`); `intent_detection_router` declares its own `prefix="/api/intent-detection"` and is root-mounted with its own `Depends(get_current_user)` → HARD_PROTECT entry `/api/intent-detection` + `startswith(p+"/")` correctly covers `/api/intent-detection/detect`; chat path `/api/video-editing-chat`, understanding `/api/video-understanding-script` + `/api/convert-to-script`; `system_settings_router` + `admin_playback_router` already per-endpoint `require_admin` (correctly left unchanged).
5. Confirmed `ErrorResponse` shape (`success/message/timestamp/error_code/error_details`) matches both the 401 and 429 payloads.
6. Confirmed Starlette `0.27.0` (≥0.21) so `scope["state"]` propagates `request.state.user` from SessionAuth into RateLimit.

## Interfaces Verified
- **`AUTH_ENFORCE_DEFAULT_DENY`** (config + env, truthy `{1,true,yes,on}`, default False) — gates ONLY the rejection of missing/invalid/disabled credentials on non-allowlisted paths. Valid-token resolution + `request.state.user` injection is unconditional → logged-in behaviour identical flag on/off. HARD_PROTECT always enforced via `enforce = flag OR _is_hard_protected(path)`. Clean seam for TODO 05.
- **`PUBLIC_ALLOWLIST`** (`ALLOWLIST_EXACT` 8 + `ALLOWLIST_PREFIX` 5, now incl. `/api/config/`) — drift-guard test asserts the exact sets. Hard-protect wins over allowlist in `_is_allowlisted`.
- **Error codes** `UNAUTHORIZED` / `FORBIDDEN` / `ACCOUNT_DISABLED` — unchanged (FE contract preserved).
- **`require_admin` on `model_settings_router`** at router level — R8 closed; holds regardless of the flag (anon→401 via `get_current_user` slow path, non-admin→403, admin/root→200).
- **Config-provider seam** (`rate_limit_config_provider` singleton, `async get_config() -> RateLimitConfig`, `invalidate()`, `RateLimitConfig{enabled, window_seconds, limits}`, `RateLimitLimits{normal_user, normal_ip, ai_generation, auth_ip, media_serving}`, `SYSTEM_SETTING_KEY_MAP`) — clean for TODO 03 drop-in; middleware needs zero edits.
- **429 contract** — `ErrorResponse` `error_code="rate_limit.exceeded"`, `error_details={retry_after, limit}`, headers `Retry-After` + `X-RateLimit-Limit/-Remaining`.
- **Middleware exec order** — `main.py` registers `RateLimitMiddleware` then `SessionAuthMiddleware` then CORS then SecurityHeaders; LIFO yields exec `…→CORS→SessionAuth→RateLimit→router`. Correct; loud DO-NOT-SWAP comment present.

## Correctness notes (the load-bearing edges)
- **Sliding-window math** — eviction `while dq and dq[0] <= cutoff: popleft()`; deny path `retry_after = max(1, ceil(win - (now - dq[0])))`. Re-derived with limit=3/window=60: 4th request at t=2 → retry_after=58 (oldest at t=0 expires at t=60); 4th request exactly at t=60 → t=0 evicted, allowed. Both correct.
- **Category ordering** — `auth (exact) → media_serving (prefix) → ai_generation (prefix) → normal`. `_MEDIA_SERVING_PREFIXES` checked before `_AI_GENERATION_PREFIXES`, so `/api/audio/generated/` and `/api/audio/subtitles/` resolve to `media_serving` and are NOT swallowed by the `/api/audio/` ai_generation prefix. Verified.
- **Identity** — `auth` forced `ip:` regardless of user; `normal` switches `normal_user`/`normal_ip` on `request.state.user`; `ai_generation`/`media_serving` single key (user preferred else IP). Matches spec §2.4.
- **Fail-open philosophy** — non-positive limit ⇒ unlimited (logged once); provider exception ⇒ pass-through; `enabled=false` ⇒ pass-through. A bad config row can never hard-lock the API. Sound for production.
- **GC** — stale-key drop + last-resort oldest-first eviction; the just-counted key (newest `dq[-1]=now`) survives both passes under normal load. Bounded memory.

## Issues & Risks (none blocking; for downstream awareness)
- **`/api/ai-mixed-editing` classified `normal`, not `ai_generation`** (dev-flagged). It is a single root-mounted compute endpoint. Spec's `ai_generation` enumeration did not list it; dev conservatively left it `normal`. Recommend TODO 03/06 owners decide whether to add the one-line prefix — it IS a genuine AI/compute endpoint and arguably belongs in the stricter bucket. NOT a Phase-1 defect (spec-compliant as written).
- **`/api/user/health`** (dev-flagged) — not allowlisted; flag-off passes through, flag-on would 401. Decision deferred to TODO 05/06. Acceptable (don't widen public surface without sign-off).
- **R2 — `media_serving` default 6000/min**: spec/master-plan value. For per-identity per-minute video Range chunking this is generous; confirm during TODO 06 load behaviour. Not a code defect.
- **R3 — process-local counts** (multi-worker under-counts) and **R4 — XFF trust** are documented module-level; production must stay single-worker and ensure only nginx sets XFF. Centralised `get_client_ip` is the future trusted-proxy seam.
- **Multi-worker / DB-lookup-per-request in auth middleware** — every non-allowlisted authenticated request opens a fresh async session for the token lookup. This pre-dates this task (shipped in `5473c7a`) and the `get_current_user` fast-path correctly avoids a *second* query. Not introduced here; flagging only as a known throughput characteristic.

## Context for Downstream (Tester focus)
**Task A (TODO 01):**
- Test BOTH flag states by patching `auth_middleware.settings.auth_enforce_default_deny` (the existing test file's autouse fixture flips it True for legacy rejection cases; `test_flag_off_*` cover passthrough).
- Flag-ON matrix: anon→401 on protected; valid→200 + user injected; allowlist anon→pass; disabled→403 `ACCOUNT_DISABLED`; HARD paths→401 even flag-OFF.
- R8 integration on `/api/model-settings/*`: anon→401, non-admin→403, admin/root→200 — holds independent of the flag (dependency-layer guard).
- Drift-guard `test_allowlist_constants_match_spec` expects 8 exact + 5 prefixes (incl `/api/config/`).
- Run in the project venv (asyncpg + SQLite-UUID-capable SQLAlchemy); the dev noted the ambient env cannot collect User-creating SQLite tests (pre-existing `postgresql.UUID` shim issue, reproduced on unmodified `main`).

**Task B (TODO 02):**
- `await rate_limiter.reset()` between cases; construct a fresh `RateLimiter(max_keys=...)` to unit-test GC without touching the singleton.
- Verify: `normal` over-limit → 429 + `Retry-After`, recovers after window roll; `ai_generation` independent low-quota bucket; `auth` per-IP (same IP, multiple accounts share); `enabled=false` full pass-through; `/api/audio/generated/` → `media_serving` (NOT ai_generation); exec order lets RateLimit read `request.state.user`.
- Confirm 429 body/header contract for the TODO 04 FE: `error_code="rate_limit.exceeded"`, `error_details.retry_after`, `Retry-After` header integer ≥1.
- Decide `/api/ai-mixed-editing` bucket (see Issues).

## Excellence (D10) note
Task B's `rate_limiter.py` is exemplary: it generalises the `media_proxy` precedent (deque + monotonic clock + correct `retry_after` + bounded GC), cleanly decouples the kernel from the middleware for a future Redis swap, and ships a documented config-provider *seam* (`rate_limit_config.py`) that lets TODO 03 drop in a DB provider with zero middleware edits. Task A's surgical flag design — gating only the rejection, never the resolution, with HARD_PROTECT always enforced — is the right minimal-blast-radius approach to R1 and is matched by a precise drift-guard test. Both are well above bar.
