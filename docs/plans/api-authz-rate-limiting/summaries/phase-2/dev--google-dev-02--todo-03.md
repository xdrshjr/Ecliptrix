# Execution Summary — TODO 03 (Config & Admin API)

## Meta
- **Role:** DEV (`google-dev-02`)
- **Task:** TODO 03 — 配置与后台 API (Config & Admin API)
- **Phase:** 2 (parallel group B, alongside TODO 05)
- **Verdict:** COMPLETED
- **Spec:** `specs/03-config-and-admin-api.md`
- **Builds on:** my own TODO 02 config-provider seam (`rate_limit_config.py`).
- **Scope:** local only, no remote sync.

## Key Decisions
- **Seam preserved (CRITICAL).** Replaced only the BODY of `rate_limit_config.py`: the singleton name `rate_limit_config_provider`, `async get_config() -> RateLimitConfig`, `invalidate()`, and the `RateLimitConfig`/`RateLimitLimits` dataclass shapes are all unchanged. `rate_limit_middleware.py` needed **zero** edits — verified by importing the middleware against the new provider.
- **Defaults live in `app/config.py`** as `RATE_LIMIT_DEFAULTS` (7 keys) + `RATE_LIMIT_META` (type/min/max/description per key). This is the **single source of truth** for: provider degrade fallback, the `POST /reset` target, the `PUT` range validation, and the `GET /config` meta block. The provider's `_default_values()` imports `RATE_LIMIT_DEFAULTS` (falling back to module literals only if that import ever fails), so config.py and the provider can never silently diverge — verified equal at runtime.
- **TTL = 5.0s** (within spec's 5–10s band). Chosen low so backend edits take effect "数秒内" even without an explicit invalidate; the admin `PUT`/`reset` additionally call `invalidate()` for near-immediate effect.
- **Provider resilience:** cache-hit returns with no DB I/O; refresh is `asyncio.Lock` double-checked so a hot path triggers at most one DB read per TTL; any DB error degrades to the last good cache (or all-defaults) and **never raises** — a config-store outage cannot hard-fail the API (spec §4).
- **Defensive value coercion** in `build_config_from_values` (shared by provider DB-read and router echo-back): a stray string/None in the JSON column coerces to the typed default rather than crashing the middleware.
- **Dedicated router, shared persistence** (spec §2.5): new `rate_limit_settings_router` (its own `/config` + `/status` semantics) but persists to the existing `SystemSetting` table and writes `SettingsAuditLog` with the **exact same shape** as `system_settings_service` (`setting_type='system_setting'`, `category='rate_limiting'`, `action='update'|'reset'`, `changed_by=username`) so the existing `GET /api/system-settings/audit-log?category=rate_limiting` surfaces these changes (acceptance pt 5).
- **PUT/reset UPSERT, not 404.** Rows are normally seeded by migration 012, but on the create_all-only path (SQLite tests, fresh DBs) they may be absent. The handlers create a missing row from the config.py default rather than 404 — keeps the API robust under the project's alembic+create_all hybrid (acceptance pt 1 holds even pre-migration).
- **Validate-all-before-write-any** in PUT: every provided key is range/type-checked first; one out-of-range value → 422 and not a single row is written (acceptance pt 4). 422 detail serializes via main.py's existing StarletteHTTPException handler into the standard `ErrorResponse`.
- **`extra="forbid"` on the PUT request model** so an unknown/misspelled key is a validation error rather than a silent no-op.
- **Router-level `require_admin`** (`dependencies=[Depends(require_admin)]`) gates every endpoint (non-admin → 403); mutating handlers additionally inject the admin user for the audit username.
- **Migration 012 `downgrade` deletes ONLY `WHERE category='rate_limiting'`** — deliberately NOT the whole-table wipe that migration 004's downgrade does, so rolling back 012 cannot clobber other categories' settings (spec §2.2).

## Execution Flow
1. Read spec 03, todo 03, global-context Phase-1 digest, and re-read my TODO 02 `rate_limit_config.py`.
2. Studied migration `004` (idempotent seed pattern), `SystemSetting`/`SettingsAuditLog` models, `system_settings_service` (audit shape, session usage), `system_settings_router` (`require_admin` + audit-log endpoint), `app/config.py` style (`per_ip_rate_limit_per_min`), `get_db_session`, `require_admin`.
3. Added `RATE_LIMIT_DEFAULTS` + `RATE_LIMIT_META` to `app/config.py`.
4. Wrote migration `012` (rev 012, down_revision 011, 7 keys, ON CONFLICT DO NOTHING, category-scoped downgrade).
5. Replaced `rate_limit_config.py` body with the DB-backed TTL provider (+ `prewarm()`, `build_config_from_values`, coercion helpers) — seam intact.
6. Wrote `rate_limit_settings_router.py` (GET/PUT/POST/GET config·reset·status).
7. Registered router in `main.py` (`prefix="/api"` → `/api/rate-limit/*`) + added a lifespan `prewarm()` call after system-settings load.
8. Verified (isolated, file-path imports to dodge the cv2-eager `app.services.__init__`, UUID→CHAR(36) shim for SQLite):
   - provider: DB load, missing-key→default, TTL cache hit, invalidate immediate, TTL auto-refresh, degrade-on-error→defaults;
   - router via real FastAPI+SQLite+SessionAuth: GET /config (meta+defaults), non-admin 403, PUT 422 on 5 bad cases (writes nothing), PUT valid → provider immediate new value, GET /status (enabled+stats), POST /reset → defaults, reset non-admin 403, audit rows queryable (`update`+`reset`, by `admin`, `system_setting`);
   - seam preservation (middleware imports clean), migration module sanity, config.py import + provider reads config defaults.
   - `py_compile` clean on all 6 touched files.

## Artifacts
**Created:**
- `backend-services/basic-service/alembic/versions/012_seed_rate_limiting_settings.py`
- `backend-services/basic-service/app/routers/rate_limit_settings_router.py`

**Modified:**
- `backend-services/basic-service/app/config.py` (added `RATE_LIMIT_DEFAULTS` + `RATE_LIMIT_META`)
- `backend-services/basic-service/app/services/rate_limit_config.py` (provider body → DB-backed TTL; seam preserved; added `build_config_from_values`, `prewarm`, `RATE_LIMIT_KEYS`, `RATE_LIMIT_CATEGORY`)
- `backend-services/basic-service/app/main.py` (register `rate_limit_settings_router` under `/api`; lifespan `prewarm()`)

## Interfaces Touched
**Produces:**
- `rate_limit_config_provider` — now DB-backed TTL provider; same public surface (`get_config`/`invalidate`) + new `prewarm()`. Consumed by TODO 02 middleware (unchanged).
- `rate_limit_settings_router` — `/api/rate-limit/{config,reset,status}`, admin-gated. Consumed by `main.py` and frontend TODO 04.
- `build_config_from_values(values: dict) -> RateLimitConfig`, `RATE_LIMIT_KEYS`, `RATE_LIMIT_CATEGORY` (helpers for router/tests).
- `app.config.RATE_LIMIT_DEFAULTS`, `app.config.RATE_LIMIT_META`.

**Consumes:**
- `rate_limiter.stats()` (TODO 02) for `GET /status`.
- Existing `SystemSetting` / `SettingsAuditLog` models + `get_db_session`, `require_admin`.

## Exact `GET /config` JSON shape (for TODO 04 form)
```jsonc
{
  "success": true,
  "message": "OK",
  "timestamp": "2026-06-01T...",      // BaseResponse fields
  "data": null,
  "config": {
    "enabled": true,
    "window_seconds": 60,
    "limits": {
      "default_per_user_per_min": 300,
      "default_per_ip_per_min": 300,
      "ai_generation_per_min": 30,
      "auth_per_ip_per_min": 10,
      "media_serving_per_min": 6000
    },
    "meta": {
      "enabled":                  { "default": true,  "type": "boolean", "min": null, "max": null,    "description": "..." },
      "window_seconds":           { "default": 60,    "type": "number",  "min": 10,   "max": 3600,    "description": "..." },
      "default_per_user_per_min": { "default": 300,   "type": "number",  "min": 1,    "max": 100000,  "description": "..." },
      "default_per_ip_per_min":   { "default": 300,   "type": "number",  "min": 1,    "max": 100000,  "description": "..." },
      "ai_generation_per_min":    { "default": 30,    "type": "number",  "min": 1,    "max": 100000,  "description": "..." },
      "auth_per_ip_per_min":      { "default": 10,    "type": "number",  "min": 1,    "max": 100000,  "description": "..." },
      "media_serving_per_min":    { "default": 6000,  "type": "number",  "min": 1,    "max": 1000000, "description": "..." }
    }
  }
}
```
- **`limits` keys are the SystemSetting key names** (NOT the internal `normal_user` etc.) — the form binds 1:1 to these.
- **PUT** `/api/rate-limit/config`: body is any subset of the 7 keys at top level (NOT nested under `limits`), e.g. `{"ai_generation_per_min": 50, "enabled": false}`. Unknown keys → 422. Out-of-range → 422 (nothing written). Response = same envelope as GET (returns the new effective config).
- **POST** `/api/rate-limit/reset`: no body → resets all 7 → returns same envelope.
- **GET** `/api/rate-limit/status`: `{ success, message, ..., status: { enabled, active_keys, total_checked, total_blocked } }`.
- All four require admin; non-admin → 403 with standard `ErrorResponse`.

## Issues & Risks
- **R7 (TTL delay):** non-invalidated edits take up to ~5s to propagate; the admin PUT/reset call `invalidate()` so the change is immediate via this API. Frontend (TODO 04) should still show "数秒内生效" copy.
- **R3 (multi-worker):** `invalidate()` only drops THIS process's cache; other workers honour their own TTL (≤5s). `/status` is single-process. Documented; production is single-worker.
- **Migration is PostgreSQL-flavoured** (`gen_random_uuid()`, `::jsonb`, ON CONFLICT ON CONSTRAINT) — same as migration 004. It runs on prod Postgres; SQLite tests use `create_all` and never execute alembic, and the router UPSERT covers the seeded-rows-absent case so tests pass without the migration.
- **`window_seconds` is global across categories** (one knob) — matches spec; not per-category.

## Context for Downstream
**TODO 04 (frontend UI + form):**
- Render the form from `config.meta` (type/min/max/description) and bind values from `config.limits` + top-level `enabled`/`window_seconds`. Submit a subset PUT with the SAME flat key names. Expect 422 (validation), 403 (non-admin), and the standard `ErrorResponse` shape on errors. Read `/status` for the read-only observability panel.
- 429 contract (from TODO 02, unchanged): `Retry-After` header + `ErrorResponse(error_code="rate_limit.exceeded", error_details={retry_after, limit})`.

**TODO 06 (tester):**
- Apply the UUID→CHAR(36) `@compiles` shim before `create_all` (env note ①); import target modules by file path to dodge the cv2-eager `app.services.__init__` (env note ②). The `tests/security/conftest.py` harness (in-memory SQLite, `patched_auth_factories`, `create_user`) is the model to follow.
- Acceptance pts 1–6 are individually exercisable; the provider's TTL/invalidate/degrade and the router's validate-before-write and audit-row writes all have isolated repros in this task's verification (reproduce with a fresh `RateLimitConfigProvider(ttl_seconds=…)` + a real SQLite `SystemSetting` table).
- For "PUT then middleware uses new value" (acceptance pt 3): call the router PUT, then assert `await rate_limit_config_provider.get_config()` reflects it immediately (invalidate fired).
