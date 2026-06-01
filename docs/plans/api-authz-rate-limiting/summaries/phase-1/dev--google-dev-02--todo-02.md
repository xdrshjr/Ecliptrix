# Execution Summary — TODO 02 (Rate Limiter Core)

## Meta
- **Role:** DEV (`google-dev-02`)
- **Task:** TODO 02 — 限流内核 (Rate Limiter Core)
- **Phase:** 1 (parallel group A, alongside TODO 01)
- **Verdict:** COMPLETED
- **Spec:** `specs/02-rate-limiter-core.md`
- **Scope:** local only, no remote sync.

## Key Decisions
- **Mirrored the `media_proxy_service` precedent** (`media_proxy_service.py:276-304`): single `asyncio.Lock`, `Dict[key, Deque[float]]` of **monotonic** timestamps, left-eviction of expired stamps, cheap GC on a key-count threshold. Generalised into a reusable `RateLimiter` kernel.
- **`Decision` is a frozen dataclass** `{allowed, retry_after, limit, remaining}` so the middleware can populate `Retry-After` / `X-RateLimit-*` without re-reading config.
- **Fail-open on misconfiguration:** a non-positive `limit` is treated as *unlimited* (logged once) rather than "deny all", so a single bad config row can never hard-lock the whole API. Same philosophy applied in the middleware: if the config provider raises, we pass the request through.
- **`retry_after` is `ceil`'d and floored at 1s** — a denied caller always gets a sane `Retry-After >= 1`.
- **GC strategy:** when keys exceed `max_keys` (default **4096**), drop empty/stale windows (newest stamp already outside the window); a last-resort oldest-first eviction enforces a hard memory bound under pathological key churn. Verified bounded under a 50-distinct-key flood with `max_keys=4`.
- **Category resolution order is load-bearing** (`auth → media_serving → ai_generation → normal`). `media_serving` is checked **before** `ai_generation` specifically so `/api/audio/generated/` and `/api/audio/subtitles/` resolve to `media_serving` and are NOT swallowed by the `ai_generation` `/api/audio/` prefix. Verified by test.
- **`/api/auth/validate-session` is intentionally NOT in the `auth` bucket** — it is polled by every logged-in client and must not share the strict anti-brute-force per-IP quota; it falls through to `normal`.
- **`ai_generation` prefix set finalised against real router prefixes in `main.py`** (not the spec's illustrative names): `/api/tts/`, `/api/llm/`, `/api/audio/` (transcribe/Freesound search — media subpaths split off first), `/api/ark-video`, `/api/ark-image`, `/api/storyboard`, `/api/voice-clone`, `/api/image`, `/api/image-pack`, `/api/workflow/ai-video-generate`, `/api/workflow/video-export`, `/api/ai-mixed-editing`(see note), `/api/video-editing-chat` (real chat path; spec said `/api/chat`), `/api/video-understanding-script` + `/api/convert-to-script` (real understanding paths; spec said `/api/video/understanding`).
  - Note: `/api/ai-mixed-editing` is covered transitively — it is a single root-mounted endpoint; it currently resolves to `normal`. If reviewers want it strictly limited, add `"/api/ai-mixed-editing"` to `_AI_GENERATION_PREFIXES` (one-line change). Flagged in Issues.
- **Middleware registration order (R5):** registered `RateLimitMiddleware` **before** `SessionAuthMiddleware` in `main.py`. Under Starlette LIFO this yields execution order `CORS → SessionAuth → RateLimit → router`, so auth populates `request.state.user` before rate limiting reads it. Loud "DO NOT swap" comment added.

## Execution Flow
1. Read all four planning docs + spec 03 (to lock the config-provider contract).
2. Studied `media_proxy_service.py` (sliding window), `queue_manager.py` (singleton), `auth_middleware.py` (`request.state.user`, `ErrorResponse` shape, OPTIONS short-circuit), `main.py` (middleware LIFO block + all router prefixes), `base_models.ErrorResponse`, `User` model (`id`).
3. Implemented `rate_limiter.py` (kernel + `Decision` + `get_client_ip` + `resolve_category` + singleton + `reset()` + `stats()`).
4. Implemented `rate_limit_config.py` (the config-provider **seam**: `RateLimitConfig`/`RateLimitLimits` dataclasses + `_FallbackConfigProvider` + `rate_limit_config_provider` singleton + `invalidate()`).
5. Implemented `rate_limit_middleware.py` (`RateLimitMiddleware`).
6. Wired registration in `main.py` (import + ordered `add_middleware` + comment).
7. Verified: category resolution (20 cases), `get_client_ip` (XFF + fallback), sliding-window allow/deny/recovery, independent category buckets, stats snapshot, GC bound, 429 body/headers shape, fail-open. `py_compile` clean on all 4 files.

## Artifacts
**Created:**
- `backend-services/basic-service/app/services/rate_limiter.py`
- `backend-services/basic-service/app/services/rate_limit_config.py`
- `backend-services/basic-service/app/middleware/rate_limit_middleware.py`

**Modified:**
- `backend-services/basic-service/app/main.py` (import + middleware registration block, ~lines 24-26 import, ~197-223 registration).

## Interfaces Touched
**Produces (consumed downstream):**
- `rate_limiter` (singleton) + `RateLimiter` class + `Decision` dataclass + `rate_limiter.stats()` (`{total_checked, total_blocked, active_keys}`) + `await rate_limiter.reset()`.
- `resolve_category(path) -> str` (+ `CATEGORY_*` constants).
- `get_client_ip(request) -> str`.
- `RateLimitMiddleware`.
- **Config-provider consumption interface** (`app/services/rate_limit_config.py`):
  - singleton **`rate_limit_config_provider`**
  - `async get_config() -> RateLimitConfig` (cache-hit ⇒ **no DB I/O**)
  - `invalidate() -> None`
  - `RateLimitConfig{enabled: bool, window_seconds: int, limits: RateLimitLimits}`
  - `RateLimitLimits{normal_user, normal_ip, ai_generation, auth_ip, media_serving}`

**Exact config keys (SystemSetting `rate_limiting` category → RateLimitConfig path)** — `SYSTEM_SETTING_KEY_MAP` in code:
| SystemSetting key | RateLimitConfig path | default |
|---|---|---|
| `enabled` | `enabled` | `true` |
| `window_seconds` | `window_seconds` | `60` |
| `default_per_user_per_min` | `limits.normal_user` | `300` |
| `default_per_ip_per_min` | `limits.normal_ip` | `300` |
| `ai_generation_per_min` | `limits.ai_generation` | `30` |
| `auth_per_ip_per_min` | `limits.auth_ip` | `10` |
| `media_serving_per_min` | `limits.media_serving` | `6000` |

**Consumers:** TODO 03 (DB provider must keep this exact surface), TODO 04 (frontend 429 shape), TODO 06 (tester).

## Issues & Risks
- **R3 (multi-worker):** counts are process-local; documented in module docstrings. Production must stay single-worker, or swap in a Redis-backed `check()` (interface is decoupled for exactly this).
- **R4 (XFF trust):** `get_client_ip` trusts `X-Forwarded-For` first segment; deployment must ensure only the trusted nginx can set it. Centralised so a trusted-proxy allowlist can be added in one place.
- **R2 (media误伤):** `media_serving` default `6000/min` per the spec/master-plan; **reviewer should confirm** this is high enough for video Range chunking. Single high-quota key per identity per category.
- **`/api/ai-mixed-editing` classification:** currently `normal`. If it should be `ai_generation`, add the prefix to `_AI_GENERATION_PREFIXES` (flagged above). Left as `normal` because it was not in the spec's enumerated set and I avoided over-reaching.
- **Local env caveat:** `app/services/__init__.py` eagerly imports `video_composition_service` → `cv2`, which is broken in *this* dev box (OpenCV recursion). This is a **pre-existing, unrelated** environment fault, not caused by my code; I verified all new modules via isolated importlib loading + `py_compile`. The app boots `app.services.__init__` once at startup regardless, so the top-level import in the middleware is fine on a healthy install.

## Context for Downstream
**TODO 03 (dev-02 Phase 2 — me next) MUST:**
- Replace `_FallbackConfigProvider`'s body with a `SystemSetting`-backed provider that has a 5–10s TTL cache + working `invalidate()`. Keep the singleton name `rate_limit_config_provider`, the `async get_config() -> RateLimitConfig` signature, and the `RateLimitConfig`/`RateLimitLimits` shape **unchanged** — the middleware imports these and must not need edits.
- Use the 7 config keys + defaults in the table above (also mirrored as constants `DEFAULT_*` in `rate_limit_config.py` and as `SYSTEM_SETTING_KEY_MAP`). Mirror the same defaults in `app/config.py` (TODO 03's module boundary) as the DB-missing fallback; keep them in sync with `rate_limit_config.py`.
- `GET /status` should read `rate_limiter.stats()` for `active_keys`/`total_checked`/`total_blocked` and `enabled` from the resolved config.
- Pre-warm `get_config()` in the FastAPI `startup`/lifespan to avoid a first-request cold read (optional, recommended).

**TODO 04 (frontend) needs about the 429:**
- Status `429`; header `Retry-After: <integer seconds>`; also `X-RateLimit-Limit` / `X-RateLimit-Remaining`.
- Body is the standard `ErrorResponse`: `success=false`, `error_code="rate_limit.exceeded"`, `message` (zh user-facing string), `error_details={retry_after, limit}`. Read `Retry-After` (or `error_details.retry_after`) for the "retry in N seconds" toast.

**TODO 06 (tester):**
- Use `await rate_limiter.reset()` between cases for isolation.
- Construct a fresh `RateLimiter(max_keys=...)` to unit-test GC without touching the global singleton.
- Auth category is per-IP regardless of logged-in user; `normal` switches per-user/per-IP on `request.state.user` presence; `enabled=false` ⇒ full pass-through.
