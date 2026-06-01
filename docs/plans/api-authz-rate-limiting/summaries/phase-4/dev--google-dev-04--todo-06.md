# DEV Execution Summary — TODO 06 (Testing & Acceptance)

## Meta
- **Agent:** google-dev-04
- **Role:** DEV
- **Task:** todo-06 — Testing & Acceptance (final consolidation)
- **Phase:** 4 (terminal; parallel_group D)
- **Verdict:** **COMPLETED** (provisional — pending Reviewer + Tester)
- **Spec:** `specs/06-testing-and-acceptance.md`
- **Scope:** local only, no remote sync.

## Key Decisions

1. **Made the bare suite runnable in the permanent `tests/conftest.py`, not via
   throwaway plugins.** The prior testers ran with a tmp-dir `-p uuid_shim`
   plugin + per-fixture JSONB→JSON metadata mutation. I consolidated both into
   the root conftest so `pytest tests/<file>` works with normal imports:
   - **Dialect-scoped `@compiles(postgresql.UUID, "sqlite") → CHAR(36)`** and
     `@compiles(postgresql.JSONB, "sqlite") → JSON`. ONLY the SQLite compiler is
     affected — PostgreSQL renders natively, so production is untouched. This is
     safer and broader than mutating `Base.metadata` column types in a fixture
     (which only the settings test did).
   - **Guarded `cv2` stub:** real `import cv2` is tried FIRST; the `sys.modules`
     stub is installed only when it raises (the broken-OpenCV box). A healthy
     install never shadows the real module. Installed at conftest import time so
     it is in place before pytest imports any `app.services.*` test module.

2. **Verified the conftest STRICTLY improves the suite, breaks nothing.** Whole
   `tests/` collection went **666/23-errors → 965/2-errors**; `test_auth_middleware`
   (was UUID-setup-error) → 27 passed; `test_settings_services` (was cv2-collection-
   error) → 58 passed; `tests/security/` (was 1 collection error, un-runnable) →
   122 passed / 4 pre-existing env failures. The 2 remaining collection errors
   (`test_content_polish_api.py` SyntaxError, `test_tts_api.py` `pytest.config`)
   are pre-existing bugs IN those test files, proven by stashing my conftest and
   re-collecting (the SyntaxError persists; `test_tts_api` only changed from a
   cv2 error to its own removed-API error). Not in scope, not regressions.

3. **Construct fresh `RateLimiter` instances in unit tests** (not the global
   singleton) for hermeticity, and **`await rate_limiter.reset()`** in autouse
   fixtures wherever the singleton is exercised (integration + admin API), so
   state never leaks between tests.

4. **Inject deterministic time** by monkeypatching `rate_limiter.time.monotonic`
   / `rate_limit_config.time.monotonic` with a fake clock for exact `retry_after`
   and TTL-expiry assertions; only two tests use a real short `asyncio.sleep` for
   genuine end-to-end window recovery.

5. **Integration tests drive the REAL middleware/router** — not reimplementations.
   `test_rate_limit_integration` registers the real `RateLimitMiddleware` with an
   auth-substitute middleware in production LIFO order (RateLimit registered
   first → inner; auth registered after → outer/runs-first ⇒ `Auth → RateLimit`),
   stubbing only the config provider's `get_config` to a low-limit `RateLimitConfig`
   so 429 trips in ≤4 requests. `test_rate_limit_admin_api` mounts the real
   `rate_limit_settings_router` behind real `require_admin` + a `SessionAuth`
   substitute + a `get_db_session` override that commits (mirrors production —
   the router `flush()`es and relies on the dependency commit). `test_authz_integration`
   mounts the real `SessionAuthMiddleware` + the real R8 `model_settings_router`.

6. **Did NOT rebuild `test_auth_middleware.py`** (dev-01's 27-case file). Verified
   it still passes under the new conftest and left it as-is per the spec ("核对/补充
   而非重建").

## Execution Flow

1. Read all four planning docs (spec/todo 06, master-plan §8, global-context) +
   every phase-1/2/3 dev & tester summary — the testers' harness descriptions
   were the blueprint for the permanent tests.
2. Read the code under test: `rate_limiter.py`, `rate_limit_config.py`,
   `rate_limit_middleware.py`, `rate_limit_settings_router.py`, `config.py`
   (`RATE_LIMIT_DEFAULTS`/`META`), `dependencies/auth.py`, existing
   `test_auth_middleware.py` / `test_settings_services.py` / `tests/security/conftest.py`.
3. Reproduced both env blockers (bare `pytest tests/test_auth_middleware.py` →
   UUID render error; `import app.services.rate_limiter` → cv2 recursion).
4. Updated `tests/conftest.py` with the guarded cv2 stub + dialect-scoped UUID/JSONB
   shims; verified existing tests still pass (auth 27 + settings 58).
5. Wrote the 7 new test files; iterated each to green.
6. Fixed two genuine TEST bugs found while iterating (both verified against real
   product behaviour — see Issues): provider last-good-cache is the TTL path not
   the invalidate path; a `root` user must carry `is_admin=True` (production
   seeding does this and `require_admin` checks `is_admin`).
7. Ran the full acceptance command — **137 passed, 0 failed**.
8. Re-ran the wider suite + security suite to confirm no regressions from the
   conftest; confirmed the only remaining failures are pre-existing env/test-file
   issues (oss2 missing, pre-existing SyntaxError, removed pytest API).
9. Wrote `acceptance-report.md` (§8 traceability) and this summary.

### Real pytest output (acceptance command)
```
tests/test_rate_limiter_core.py            20 passed
tests/test_category_resolver.py            37 passed
tests/test_client_ip.py                     8 passed
tests/test_rate_limit_config_provider.py   13 passed
tests/test_rate_limit_admin_api.py         14 passed
tests/test_rate_limit_integration.py        9 passed
tests/test_authz_integration.py             9 passed
tests/test_auth_middleware.py              27 passed
============================ 137 passed in ~10s ============================
```
Wider suite (informational): `tests/` now collects 965 tests (2 pre-existing
collection errors unrelated to this work, down from 23). `tests/security/`:
122 passed / 4 pre-existing env failures (`oss2` missing + 1 flag-state assertion)
— previously un-runnable (1 collection error) before the conftest fix.

## Artifacts

**Created (tests):**
- `backend-services/basic-service/tests/test_rate_limiter_core.py`
- `backend-services/basic-service/tests/test_category_resolver.py`
- `backend-services/basic-service/tests/test_client_ip.py`
- `backend-services/basic-service/tests/test_rate_limit_config_provider.py`
- `backend-services/basic-service/tests/test_rate_limit_admin_api.py`
- `backend-services/basic-service/tests/test_rate_limit_integration.py`
- `backend-services/basic-service/tests/test_authz_integration.py`

**Modified:**
- `backend-services/basic-service/tests/conftest.py` — added the guarded cv2
  stub + dialect-scoped `@compiles(UUID/JSONB, "sqlite")` shims (existing
  `db_session` / `storage_root` fixtures preserved).

**Docs:**
- `docs/plans/api-authz-rate-limiting/acceptance-report.md` (§8 traceability)
- `docs/plans/api-authz-rate-limiting/summaries/phase-4/dev--google-dev-04--todo-06.md` (this file)

**Unchanged:** all production code under `app/`; `test_auth_middleware.py` (verified, not edited).

## Interfaces Touched (Produces → Consumers)
- **Permanent pytest suite** covering spec 01-03 contracts (auth default-deny,
  rate-limit kernel/category/IP, config provider TTL/invalidate/degrade, admin
  API, 429 wire contract, authz 401/403). Consumed by the Reviewer + Tester.
- **`tests/conftest.py` runnability shims** — consumed by ALL backend tests; they
  unblocked the auth/settings/security suites as a side benefit. No production
  surface changes.

## Issues & Risks
- **No product bugs found.** Two TEST-only corrections made (documented in
  acceptance-report §5): (a) last-good-cache degrade is the TTL-expiry path,
  invalidate→defaults — split into two tests asserting the real behaviour;
  (b) root user fixture must set `is_admin=True` to mirror `app/database.py`
  seeding (`require_admin` checks `is_admin`).
- **R3 (single-worker)** and **R7 (TTL delay)** are documented limitations,
  correctly not "fixed" — accepted per master-plan. R3 is inherently single-process
  in tests; R7's invalidate-immediate path IS tested.
- **`/api/user/health`** anon→401 under flag-on remains a deferred ops decision
  (recommend allowlisting if used as an unauthenticated probe). Not changed —
  widening the public surface needs sign-off.
- **FE smoke (§8.5/§8.6 FE halves)** are inherently live-stack manual steps; the
  backend halves (429 contract, admin read/write, flag-independence of logged-in
  path, allowlist anon) are automated and green. Manual checklist captured in
  acceptance-report §4.
- **Pre-existing, out-of-scope:** `test_content_polish_api.py` (SyntaxError) and
  `test_tts_api.py` (`pytest.config` removed-API) still fail to collect — bugs in
  those files, not touched here.

## Context for Downstream (Reviewer + Tester)
- Run the acceptance command verbatim (it is the spec's command); expect
  **137 passed**. The suite is hermetic and needs no project venv — the conftest
  shims make it runnable on this box.
- The cv2 stub is **guarded** (real import first); on a healthy OpenCV box it is a
  no-op and the real module is used — verify by importing `cv2` before conftest if
  in doubt.
- The UUID/JSONB `@compiles` shims are **dialect-scoped to `"sqlite"`** — they
  CANNOT affect a PostgreSQL run. Safe to keep permanently.
- Reset discipline: integration/admin tests `await rate_limiter.reset()` +
  `rate_limit_config_provider.invalidate()` in autouse fixtures; unit kernel tests
  use fresh `RateLimiter()` instances.
- If the Tester wants the FULL `pytest tests/` green, note the 2 pre-existing
  collection errors are independent test-file bugs (SyntaxError / removed pytest
  API) and the 4 `tests/security` failures are env-only (`pip install oss2`
  resolves 3; the 4th is a flag-state error-shape assertion in that suite).
