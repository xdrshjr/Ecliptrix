# TESTER Summary — Phase 1 (TODO 01 Authorization + TODO 02 Rate Limiter Core)

## Meta
- **Agent**: google-tester-01
- **Role**: TESTER
- **Phase**: 1
- **Verdict (Task A — TODO 01, google-dev-01)**: **ALL PASS**
- **Verdict (Task B — TODO 02, google-dev-02)**: **ALL PASS**
- **Method**: Read every spec/acceptance point + the live code under test; ran dev-01's
  `tests/test_auth_middleware.py` (with the documented UUID→CHAR(36) SQLite compile shim) and
  three standalone harnesses I authored in the system temp dir (rate-limiter kernel, the REAL
  `RateLimitMiddleware` over a TestClient, and an R8 `model_settings_router` integration). All
  harness files were deleted after the run; nothing was added to the repo.
- **Information boundary**: read only the reviewer's `## Meta` (verdict: A=PASS, B=PASS). Did
  NOT read the reviewer's detailed comments. My verdicts are derived independently.

## Environment
- Ambient Python 3.11.7; SQLAlchemy 2.0.25, starlette **1.0.0**, fastapi 0.136.1, pytest 7.4.4,
  pytest-asyncio 0.23.3, aiosqlite present. No project venv exists on this box.
- Reproduced both documented env caveats: (a) `db_models.py` uses `postgresql.UUID` → bare SQLite
  collection of User-creating tests fails; worked around with a `@compiles(UUID,"sqlite")→CHAR(36)`
  pytest plugin. (b) `app/services/__init__.py` / `app/routers/__init__.py` eagerly import cv2
  (recursion crash); worked around by stubbing those packages and loading target module files via
  importlib. Neither is a defect in the work under test.
- NOTE for downstream: the reviewer's summary states starlette `0.27.0`; the actual box has
  `1.0.0`. The `scope["state"]` propagation across the two `BaseHTTPMiddleware` layers that the
  reviewer relied on is present in 1.0.0 and I verified it empirically (the user identity set by
  the auth-substitute middleware reached `RateLimitMiddleware` and selected the per-user limit).
  No impact on either verdict; flagged only for accuracy.

## Key Decisions
1. Treated the reviewer's PASS/PASS as unconfirmed until I re-derived each acceptance point myself
   from code + execution. Both tasks independently reproduce as PASS.
2. Where the pre-existing cv2/UUID faults blocked a normal `pytest` run, I used the exact
   work-arounds the task brief sanctioned (importlib-from-path + UUID compile shim) rather than
   declaring "blocked". Dev-01's real test file therefore ran in full (27/27 green).
3. Exercised the REAL `RateLimitMiddleware.dispatch` end-to-end (not just the kernel) so the
   identity selection, auth-forced-per-IP, category bucketing, `enabled=false` passthrough, and the
   429 wire contract are verified through the actual middleware, not a reimplementation.

## Execution Flow (what I ran + results)

### 1. dev-01 `tests/test_auth_middleware.py` (real test suite)
`PYTHONPATH=<tmp>;. python -m pytest tests/test_auth_middleware.py -p uuid_shim -v`
→ **27 passed, 0 failed** (4.2s). Includes: allowlist drift-guard (8 exact / 5 prefix incl
`/api/config/`), T1–T18 (health/login allowlist, 401 missing/invalid token, 200 valid, 403
disabled, legacy `X-Session-Token` + raw `Authorization`, OPTIONS preflight, static/storage/audio
prefix passthrough, trailing-slash discipline `files-other`→401 & `/api/audio/transcribe`→401,
admin 200 / non-admin 403), fast-path no-double-DB-query, constant-time mismatch branch, and the 5
flag-behaviour tests (flag-off passthrough no-token/invalid-token, flag-off valid-token still
injects user, flag-off HARD_PROTECT still 401, `/api/config/` allowlist).

### 2. Rate-limiter kernel + config provider + 429 builder (standalone harness)
`python rl_harness.py` → **73/73 PASS**. Covered:
- `resolve_category` 25 cases incl. the load-bearing ordering: `/api/audio/generated/` and
  `/api/audio/subtitles/` → `media_serving` (NOT swallowed by ai_generation `/api/audio/`);
  `/api/audio/transcribe` → `ai_generation`; `/api/auth/validate-session` → `normal` (not auth);
  `/api/ai-mixed-editing` → `normal` (as dev flagged).
- `get_client_ip`: XFF first-segment, strip, empty-XFF fallback to `client.host`, no-client →
  `"unknown"`.
- Sliding window: allow first N / deny N+1, `remaining` accounting, `retry_after >= 1` and `<=
  window`, exact `retry_after == window - elapsed` (50s) via monotonic-clock injection, window
  recovery after roll, independent per-key buckets.
- `stats()` snapshot `{total_checked,total_blocked,active_keys}`, `reset()` clears all.
- GC: 50-distinct-key flood with `max_keys=4` → `active_keys <= 4` (hard memory bound holds).
- Fail-open: `limit<=0` and `limit<0` → allowed (logged); `window<=0` defaults to 60.
- Config defaults: enabled=True, window=60, normal_user/ip=300, ai=30, auth_ip=10, media=6000;
  `SYSTEM_SETTING_KEY_MAP` has the 7 expected entries.
- 429 builder (`_rate_limited_response`): status 429, `Retry-After`/`X-RateLimit-Limit`/
  `X-RateLimit-Remaining` headers, body `error_code="rate_limit.exceeded"`, `success=False`,
  `error_details={retry_after,limit}`, full ErrorResponse shape (`success/message/timestamp/
  error_code/error_details`).

### 3. REAL `RateLimitMiddleware` end-to-end over TestClient (standalone harness)
`python rl_mw_e2e.py` → **18/18 PASS**. Auth-substitute middleware registered AFTER RateLimit
(LIFO → runs first) to mirror production `Auth→RateLimit`. Covered:
- normal anon per-IP (limit 2 → 3rd = 429); allowed responses carry `X-RateLimit-*`.
- 429 over the wire: status, integer `Retry-After>=1` header, body error_code + ErrorResponse shape.
- per-user vs per-IP: logged-in uses `normal_user`, anon uses `normal_ip` (verified divergent
  behaviour with normal_user=100/normal_ip=1) → **proves Auth→RateLimit order works (R5)**.
- `auth` category forced per-IP: 2nd `/api/auth/login` from same IP → 429 even with a *different*
  user header.
- independent buckets: `ai_generation` exhaustion (limit 1) does not affect `normal`.
- `media_serving` high quota (6000): 10 rapid `/api/audio/generated/` requests all 200.
- `enabled=false`: full passthrough, no 429, no `X-RateLimit-*` headers added.
- window recovery over the wire (window=1s, real sleep): allow → 429 → recover → 200.

### 4. R8 `model_settings_router` integration (standalone harness)
`python r8_harness.py` → **10/10 PASS**. Real router mounted behind real `SessionAuthMiddleware`,
in-memory SQLite users. For BOTH flag states:
- anon → 401; non-admin → 403 (`error_code="FORBIDDEN"`); admin → 200; root → 200.
- Confirmed the router-level `Depends(require_admin)` is exactly `app.dependencies.auth.require_admin`,
  and that protection holds with `AUTH_ENFORCE_DEFAULT_DENY=False` — anon 401 then comes from
  `get_current_user`'s slow path, independent of the middleware flag.

## Spec Traceability Matrix

### Spec 01 — Authorization (acceptance §6 + design §3)
| # | Requirement | Implemented (file:line) | Tested | Verified by me |
|---|---|---|---|---|
| 6.1 | Anon → 401 on protected (workflow/tts/model-settings) | `auth_middleware.py:246-261` (+ dep slow path) | T3, flag-tests | YES (pytest T3; R8 anon→401) |
| 6.2 | Allowlist anon-reachable (login/register/health/config/media) | `ALLOWLIST_EXACT/PREFIX` `auth_middleware.py:58-100` | T1,T2,T9,T10,T16,T17, config test | YES (pytest) |
| 6.3 | Non-admin admin-route → 403; admin/root → pass | `require_admin` `dependencies/auth.py`; `model_settings_router.py:36-40` | T11,T12 | YES (pytest + R8 harness 403/200) |
| 6.4 | `model_settings_router` admin-gated (R8) | `model_settings_router.py:36-40` router-level dep | (no repo test) | YES (R8 harness: anon401/nonadm403/adm200/root200, both flags) |
| 6.5 | Valid-token request unchanged (no regression) | `auth_middleware.py:272-343` (unconditional resolve+inject) | T5,T7,T7b, flag-off-valid | YES (pytest) |
| §3.1 | Default-deny gated by `AUTH_ENFORCE_DEFAULT_DENY` | `config.py:601-611,1042-1046`; `auth_middleware.py:241-242` | flag on/off tests | YES (pytest both states) |
| §3.2 | `/api/config/` added; bare `/api/config` & `/api/` NOT public | `auth_middleware.py:94-100` (trailing slash) | drift-guard, config test | YES (pytest) |
| §3.2/§5 | HARD_PROTECT always enforced (incl flag-off) | `auth_middleware.py:116-128,241-242` | flag-off-hard test | YES (pytest 401) |
| §4 | error_codes UNAUTHORIZED/FORBIDDEN/ACCOUNT_DISABLED preserved | `auth_middleware.py` + `dependencies/auth.py` | T3/T4/T6/T12 | YES |
| §5 | OPTIONS preflight passes | `auth_middleware.py:220-221` | T8 | YES |
| §3.3 | system_settings / admin_playback / user_router unchanged-compliant | (left as-is) | (dev-verified) | Static-read confirmed dev claim; not re-run (out of changed surface) |

### Spec 02 — Rate Limiter Core (acceptance §5 + design §2)
| # | Requirement | Implemented (file:line) | Tested | Verified by me |
|---|---|---|---|---|
| 5.1 | `normal` over quota → 429 + Retry-After; window recovers | `rate_limiter.py:114-196`; `rate_limit_middleware.py:160-177` | harness | YES (kernel + e2e + wire recovery) |
| 5.2 | `ai_generation` lower quota, independent bucket | `rate_limiter.py:351-366`; mw `:151-152` | harness | YES (e2e: ai exhausted, normal unaffected) |
| 5.3 | `auth` per-IP (same IP multi-account shares quota) | mw `:139-141` | harness | YES (e2e: diff user same IP → 429) |
| 5.4 | `enabled=false` full passthrough | mw `:123-125` | harness | YES (e2e: 5 reqs no 429, no headers) |
| 5.5 | `media_serving` high quota, playback not interrupted | `rate_limiter.py:322-327` order; default 6000 `rate_limit_config.py:57` | harness | YES (e2e 10 reqs 200; ordering 73-case) |
| 5.6 | Exec order Auth→RateLimit; limiter gets user identity | `main.py:222-223` (+comment) | harness | YES (e2e per-user vs per-IP divergence) |
| §2.1 | Sliding window kernel, monotonic, GC, reset, retry_after ceil≥1 | `rate_limiter.py:85-256` | harness | YES (73 assertions) |
| §2.2 | `get_client_ip` XFF-first then client.host | `rate_limiter.py:266-292` | harness | YES |
| §2.3 | Category order auth→media→ai→normal; audio/generated→media | `rate_limiter.py:369-400` | harness | YES (25 cases) |
| §3 | 429 = ErrorResponse, `error_code="rate_limit.exceeded"`, `Retry-After` + `X-RateLimit-*` | `rate_limit_middleware.py:69-90` | harness | YES |
| §3 | Config-provider seam (`get_config`, `invalidate`, dataclasses, keymap) | `rate_limit_config.py` | harness | YES (defaults + keymap) |

### Master-plan §8 (Phase-1-relevant)
- §8.1 (anon→401 / non-admin→403): **verified** (pytest + R8). §8.2 (429 + Retry-After, per-category
  independent counting): **verified** (harnesses). §8.7 (middleware unit tests pass): **verified**
  (27/27). §8.3/§8.4-frontend/§8.5/§8.6 belong to later phases (config hot-reload, FE 429 toast,
  token audit) — out of Phase-1 scope.

## 429 Contract (explicitly confirmed)
Status `429`; header `Retry-After: <int seconds>` (always ≥1); headers `X-RateLimit-Limit` +
`X-RateLimit-Remaining`; body is the standard `ErrorResponse`
(`success=false`, `message`, `timestamp`, `error_code="rate_limit.exceeded"`,
`error_details={retry_after, limit}`). Verified both via the builder unit and over the wire.

## Artifacts
- Ran (then deleted) under `%TEMP%\claude\`: `uuid_shim.py` (pytest plugin), `rl_harness.py`,
  `rl_mw_e2e.py`, `r8_harness.py`. No files added to the repo (git status clean of harness files).
- Code under test unchanged by me.

## Issues & Risks
- **No defects found.** Both tasks meet every Phase-1 acceptance point I could execute.
- **Non-blocking observations (NOT defects; reviewer not expected to "catch" these):**
  - `/api/user/health` (dev-01 already flagged): not in the allowlist; with the flag ON it would
    401 if it has no auth dep. Deliberately left to TODO 05/06 to decide. Correct conservative call.
  - `/api/ai-mixed-editing` resolves to `normal` not `ai_generation` (dev-02 flagged). It is a
    single root-mounted endpoint and was not in the spec's enumerated AI set; classification is a
    one-line change if reviewers want it stricter. Acceptable for Phase 1.
  - Reviewer summary cites starlette 0.27.0; actual box is 1.0.0. `request.state.user` cross-layer
    propagation still works (empirically verified). Cosmetic doc inaccuracy only.
  - Multi-worker (R3) and XFF-trust (R4) are documented limitations, correctly deferred.

## Context for Downstream
- **TODO 03 (config provider)**: must preserve the exact seam (`rate_limit_config_provider` singleton,
  `async get_config()->RateLimitConfig`, `invalidate()`, `RateLimitConfig{enabled,window_seconds,
  limits}`, `RateLimitLimits{normal_user,normal_ip,ai_generation,auth_ip,media_serving}`,
  `SYSTEM_SETTING_KEY_MAP` 7 keys). Defaults verified: 300/300/30/10/6000, window 60, enabled True.
- **TODO 04 (FE 429)**: contract confirmed exactly as dev-02 documented — read `Retry-After` header
  (or `error_details.retry_after`) for the toast.
- **TODO 05 (rollout)**: single switch `AUTH_ENFORCE_DEFAULT_DENY` (truthy `{1,true,yes,on}`,
  default off). Logged-in behaviour is flag-independent (verified). R8 + HARD_PROTECT hold even
  flag-off. Watch `/api/user/health` when flipping.
- **For running the suite cleanly**: `tests/test_auth_middleware.py` needs either the project venv
  (UUID-capable) or a `@compiles(postgresql.UUID,"sqlite")→CHAR(36)` plugin; bare `pytest` collection
  still fails on the pre-existing `db_models` UUID issue (unrelated to this work).
