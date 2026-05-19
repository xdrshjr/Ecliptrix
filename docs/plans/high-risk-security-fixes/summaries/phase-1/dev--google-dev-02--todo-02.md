# DEV Summary — google-dev-02 — TODO 02 (CORS + Security Headers)

## Meta

- **agent-id:** google-dev-02
- **role:** DEV
- **spec:** [`specs/02-cors-and-secure-headers.md`](../../specs/02-cors-and-secure-headers.md)
- **todo:** [`todos/02-cors-and-secure-headers.md`](../../todos/02-cors-and-secure-headers.md)
- **threat points addressed:** V02-A (CORS wildcard + credentials), V02-B (missing security headers)
- **date:** 2026-05-20
- **branch:** main
- **status:** PASS

## Key Decisions

1. **No direct edit of `app/main.py`** — per task constraint, the two patches the
   downstream coordinator needs to apply to `main.py` are documented in the
   "main.py patches" section below with exact `old_string` / `new_string` pairs.
   All other file changes (config, middleware, env.template, tests) were
   applied normally.

2. **Env-driven CORS allowlist with dev-localhost fallback.** `cors_allowed_origins`
   is parsed from the `CORS_ALLOWED_ORIGINS` env var (comma-separated). When
   `ENV` is `development` or `dev`, four localhost origins
   (`http://localhost:3000`, `:3010`, `http://127.0.0.1:3000`, `:3010`) are
   merged in automatically. Production with an empty allowlist = **deny all
   cross-origin** (safe-by-default), which matches the spec.

3. **`CORS_LEGACY_WILDCARD=1` rollback switch is wired through config but
   the actual branch lives in the `main.py` patch.** When set, it restores
   the pre-fix `allow_origins=['*']` + `allow_credentials=True` behavior so
   ops can rollback in <60s without redeploying. Documented as
   "EMERGENCY ROLLBACK ONLY" in `env.template` and as a noisy startup log
   warning in the main.py patch.

4. **SecurityHeadersMiddleware registered AFTER CORSMiddleware** so it sits
   OUTSIDE the CORS layer (Starlette `add_middleware` is LIFO: last-added is
   outermost). This means the security wrapper observes the final response
   *after* CORS has attached `Access-Control-*` headers, and uses
   `headers.setdefault(...)` so it never overwrites a header any downstream
   handler may have set explicitly.

5. **`/docs`, `/redoc`, `/openapi.json` exempt from `X-Frame-Options`** so
   Swagger UI in dev can render its assets in iframes. They still receive
   `nosniff`, `Referrer-Policy`, and `Permissions-Policy`.

6. **HSTS is prod-only.** Driven by `settings.env == "production"` to avoid
   strict-transport-pinning users on `http://localhost` / staging certs.

7. **Test isolation strategy mirrors `test_auth_middleware.py`** — each test
   builds a minimal `FastAPI` app via a local `_build_app` helper instead of
   importing `app.main` (which pulls cv2 / ffmpeg / heavy router deps).
   `settings.env` is patched per test via `monkeypatch`.

## Execution Flow (per todo phases)

- **Phase A — Inventory:** Read `app/main.py` lines around 190-220 (confirmed
  `allow_origins=["*"]` + `allow_credentials=True`). Read `app/config.py` —
  no existing `env` or `cors_*` field. Grepped repo for `CORS_ALLOWED_ORIGINS`
  / `allow_origins` — only two hits (`main.py:197` production wildcard,
  `tests/test_auth_middleware.py:104` test-local wildcard, intentionally
  preserved since it's testing auth middleware not CORS).

- **Phase B — V02-A (CORS allowlist):**
  - Added `env`, `cors_allowed_origins`, `cors_allow_credentials`,
    `cors_legacy_wildcard` fields to `Settings` in `app/config.py`.
  - Added the parse/populate logic in `get_settings()` (reads `ENV` /
    `APP_ENV`, `CORS_ALLOWED_ORIGINS` comma-split, `CORS_ALLOW_CREDENTIALS`,
    `CORS_LEGACY_WILDCARD`).
  - Updated `env.template` with a full block explaining ENV / allowlist /
    rollback switch and deployment guidance.
  - Documented the `main.py` CORSMiddleware replacement patch below.

- **Phase C — V02-B (security headers):**
  - Created `app/middleware/security_headers.py` with
    `SecurityHeadersMiddleware(BaseHTTPMiddleware)` — uses `setdefault` for
    every header, exempts `/docs|/redoc|/openapi.json` from `X-Frame-Options`,
    emits HSTS only when `settings.env == "production"`.
  - Documented the `main.py` `app.add_middleware(SecurityHeadersMiddleware)`
    registration patch below.

- **Phase D — Tests:** Created
  `tests/security/__init__.py` and `tests/security/test_02_cors_headers.py`
  with 12 tests covering all spec verification scenarios. Ran the suite
  via `python -m pytest tests/security/test_02_cors_headers.py -v` →
  **12 passed, 23 warnings (all pre-existing Pydantic V1→V2 deprecations,
  unrelated to this change), 0.92s**. Full output below.

- **Phase E — Frontend liaison (out-of-scope for backend DEV):** Did not
  modify frontend; the frontend already uses `Authorization` header
  (set by the HTTP wrapper per S03), so the new `allow_headers` whitelist
  (`Authorization`, `Content-Type`, `X-Requested-With`) covers existing usage.

- **Phase F — Regression:** Only ran the new test module (full backend
  pytest run requires a working DB / network and is the coordinator's
  Phase-5 step). New tests pass cleanly without touching any production
  code path other than via dependency injection.

## Artifacts

| Action | File |
|---|---|
| **Created** | `backend-services/basic-service/app/middleware/security_headers.py` |
| **Created** | `backend-services/basic-service/tests/security/__init__.py` |
| **Created** | `backend-services/basic-service/tests/security/test_02_cors_headers.py` |
| **Edited** | `backend-services/basic-service/app/config.py` — added `env`, `cors_allowed_origins`, `cors_allow_credentials`, `cors_legacy_wildcard` fields + populate logic in `get_settings()` |
| **Edited** | `backend-services/basic-service/env.template` — added ENV / CORS_ALLOWED_ORIGINS / rollback documentation block |
| **Pending (patches documented below)** | `backend-services/basic-service/app/main.py` — CORS replacement + SecurityHeadersMiddleware registration |

## Tests Added

`backend-services/basic-service/tests/security/test_02_cors_headers.py` — 12 tests:

**V02-A (CORS allowlist):**
1. `test_dev_localhost_origin_preflight_succeeds` — dev env OPTIONS preflight from `http://localhost:3000` returns 200 with correct ACAO + ACAC.
2. `test_dev_localhost_simple_get_includes_acao` — dev env GET from `localhost:3010` echoes the origin.
3. `test_prod_configured_origin_allowed` — prod env with `https://app.example.com` in allowlist → correct ACAO echoed.
4. `test_prod_unauthorized_origin_blocked` — prod env, `evil.example.com` Origin → **no ACAO header** in response (browser will block cross-origin read).
5. `test_prod_empty_allowlist_denies_cross_origin` — prod env with empty allowlist → no ACAO header.
6. `test_same_origin_request_works` — request with no Origin header still works (regression safety).
7. `test_legacy_wildcard_rollback_still_works` — `CORS_LEGACY_WILDCARD` rollback path still echoes any Origin.

**V02-B (security headers):**
8. `test_security_headers_present_on_every_response` — all four always-on headers (nosniff / DENY / Referrer-Policy / Permissions-Policy) on a normal response.
9. `test_hsts_only_in_production` — HSTS shipped in prod env.
10. `test_hsts_absent_in_development` — HSTS NOT shipped in dev env.
11. `test_docs_path_skips_x_frame_options` — `/docs` keeps nosniff but no `X-Frame-Options`.

**Cross-cutting:**
12. `test_cors_and_security_headers_coexist` — single response carries both CORS + security headers cleanly.

### Test Run Output (PASS)

```
============================= test session starts =============================
platform win32 -- Python 3.12.7, pytest-9.0.2, pluggy-1.6.0
rootdir: G:\projects\takoAI\Ecliptrix\backend-services\basic-service
plugins: anyio-4.13.0, asyncio-1.3.0, cov-6.2.1, mock-3.14.1
asyncio: mode=Mode.STRICT
collecting ... collected 12 items

tests/security/test_02_cors_headers.py::test_dev_localhost_origin_preflight_succeeds PASSED [  8%]
tests/security/test_02_cors_headers.py::test_dev_localhost_simple_get_includes_acao PASSED [ 16%]
tests/security/test_02_cors_headers.py::test_prod_configured_origin_allowed PASSED [ 25%]
tests/security/test_02_cors_headers.py::test_prod_unauthorized_origin_blocked PASSED [ 33%]
tests/security/test_02_cors_headers.py::test_prod_empty_allowlist_denies_cross_origin PASSED [ 41%]
tests/security/test_02_cors_headers.py::test_same_origin_request_works PASSED [ 50%]
tests/security/test_02_cors_headers.py::test_legacy_wildcard_rollback_still_works PASSED [ 58%]
tests/security/test_02_cors_headers.py::test_security_headers_present_on_every_response PASSED [ 66%]
tests/security/test_02_cors_headers.py::test_hsts_only_in_production PASSED [ 75%]
tests/security/test_02_cors_headers.py::test_hsts_absent_in_development PASSED [ 83%]
tests/security/test_02_cors_headers.py::test_docs_path_skips_x_frame_options PASSED [ 91%]
tests/security/test_02_cors_headers.py::test_cors_and_security_headers_coexist PASSED [100%]

======================= 12 passed, 23 warnings in 0.92s =======================
```

(NOTE: 23 warnings are all pre-existing Pydantic V1→V2 deprecation warnings from `app/models/*.py`, unrelated to this change. The venv referenced in the task brief does not exist at `backend-services/basic-service/venv/Scripts/activate` on this machine; tests were run via the system `python -m pytest` which uses the same interpreter the backend would use.)

## main.py patches

**Two patches required — apply to `backend-services/basic-service/app/main.py`.**

### Patch 1: Replace the wildcard CORSMiddleware block (V02-A)

`old_string` (matches exactly the current `main.py:194-201` plus the leading comment):

```python
# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`new_string`:

```python
# Add CORS middleware (spec 02 §3 V02-A — env-driven allowlist).
#
# Production: only origins listed in CORS_ALLOWED_ORIGINS are allowed.
# Empty list + ENV=production = deny all cross-origin (safe default).
# Development: localhost:3000 / :3010 / 127.0.0.1:3000 / :3010 are merged in
# automatically so `npm run dev` against a separately-running backend keeps
# working without touching .env.
#
# CORS_LEGACY_WILDCARD=1 restores the pre-fix wildcard. EMERGENCY ROLLBACK
# ONLY — known-vulnerable configuration.
_dev_localhost_origins = [
    "http://localhost:3000",
    "http://localhost:3010",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3010",
]
_env_marker = (getattr(settings, "env", "production") or "production").lower()
_configured_origins = list(getattr(settings, "cors_allowed_origins", []) or [])
if _env_marker in ("development", "dev"):
    _cors_origins = list(dict.fromkeys(_configured_origins + _dev_localhost_origins))
else:
    _cors_origins = _configured_origins

if getattr(settings, "cors_legacy_wildcard", False):
    logger.warning(
        "CORS_LEGACY_WILDCARD=1 — restoring wildcard CORS. This is a "
        "KNOWN VULNERABILITY (V02-A). Disable as soon as the rollback "
        "window closes."
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    if _env_marker == "production" and not _cors_origins:
        logger.warning(
            "CORS_ALLOWED_ORIGINS is empty in production — all cross-origin "
            "requests will be blocked. Set CORS_ALLOWED_ORIGINS in .env to "
            "your frontend hostname(s)."
        )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=bool(getattr(settings, "cors_allow_credentials", True)),
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    )
```

### Patch 2: Register SecurityHeadersMiddleware (V02-B)

Add the import near the existing middleware import (around `main.py:24`):

`old_string`:

```python
from app.middleware.auth_middleware import SessionAuthMiddleware
```

`new_string`:

```python
from app.middleware.auth_middleware import SessionAuthMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
```

Then register the new middleware AFTER the CORS block (so it becomes the
OUTERMOST wrapper among the explicit `add_middleware` calls — see the long
comment above `app.add_middleware(SessionAuthMiddleware)`). Append immediately
after the CORS `app.add_middleware(...)` block introduced in Patch 1:

`old_string` (the blank line + `@app.middleware("http")` decorator that
currently follows the CORS block at `main.py:203-204`):

```python
)


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
```

`new_string`:

```python
)

# Add security response headers middleware (spec 02 §3 V02-B).
# Registered AFTER CORS so it ends up OUTSIDE the CORS layer (Starlette LIFO).
# Uses setdefault so it never overwrites a header explicitly set by a handler.
app.add_middleware(SecurityHeadersMiddleware)


@app.middleware("http")
async def logging_middleware(request: Request, call_next):
```

**Note on ordering rationale:** `SessionAuthMiddleware` is registered first
(innermost), `CORSMiddleware` second, `SecurityHeadersMiddleware` third
(outermost of the explicit registrations). The `@app.middleware("http")`
logging decorator below is added at module load time AFTER all three
`add_middleware` calls, so it ends up as the *true* outermost wrapper —
this is fine because the logger does not mutate headers other than
`X-Process-Time`.

## Issues & Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Prod deploy forgets to set `CORS_ALLOWED_ORIGINS` → all cross-origin requests blocked, frontend shows fetch errors | **High** (project memory: `.env` is git-tracked and the tarball deploy can revert it) | Startup warning logged when prod + empty allowlist. `CORS_LEGACY_WILDCARD=1` provides a <60s emergency rollback. `env.template` documents the variable prominently. |
| Frontend sends custom headers not in the new allow_headers whitelist (`Authorization`, `Content-Type`, `X-Requested-With`) | Low | Searched the codebase — no other custom request headers found. If a future endpoint needs e.g. `X-Trace-Id`, add it to the list. |
| `SecurityHeadersMiddleware` is OUTSIDE CORS, so the headers ship even on error responses including 401/403 from `SessionAuthMiddleware`. | Intentional / desirable — security headers should be on every response, including auth-failure ones. |
| `setdefault` means a handler that explicitly sets `X-Frame-Options: SAMEORIGIN` would win. | Acceptable per spec — `/docs`/`/redoc` are the only known cases and they are exempted at the middleware level. |
| Tests patch `settings.env` via `monkeypatch.setattr(_settings, "env", ...)`. If a future test runs concurrently and depends on `settings.env`, it could see the wrong value. | Low (pytest-asyncio runs tests serially by default in STRICT mode). |
| `requirements.txt` UTF-16 issue mentioned in user memory does not apply — we did not touch requirements. | n/a |

## Context for Downstream

- **REVIEWER:** Verify the two `main.py` patches in this doc apply cleanly
  to the current `main.py` (lines 194-204). The patches use exact string
  matching — if anyone else lands a change in that block between phase-1
  and patch application, the `old_string` may need a refresh.
- **TESTER:** The 12 new tests already cover the spec verification matrix.
  When the coordinator applies the `main.py` patches, the existing
  `tests/test_auth_middleware.py` should still pass — that test builds its
  own minimal app with its own CORS config and never touches `app.main` or
  the new middleware.
- **OPS playbook for rollout:** Before deploying, set
  `CORS_ALLOWED_ORIGINS=https://ecliptrix.example.com` (or the real prod
  frontend host) in `.env`. After deploy, smoke-test:
  `curl -i -H "Origin: https://ecliptrix.example.com" https://prod/api/health`
  → expect `Access-Control-Allow-Origin: https://ecliptrix.example.com`
  AND `X-Frame-Options: DENY` AND `Strict-Transport-Security: ...`.
- **No parallel-task conflicts:** TODO 02 only touches `app/config.py`,
  `app/middleware/security_headers.py` (new), `env.template`, and
  `app/main.py` (via documented patches). TODO 01 (auth middleware) touches
  `app/middleware/auth_middleware.py` and dependencies; TODO 03 (process
  injection) touches `app/services/*` and `app/security/url_guard.py`;
  TODO 04 (path traversal) touches `app/services/storage_service.py`;
  TODO 05 (secrets) touches `.env`/`.gitignore`/logging. No overlap.

---

PASS
