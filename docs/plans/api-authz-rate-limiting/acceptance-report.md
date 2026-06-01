# Acceptance Report — api-authz-rate-limiting

> Phase 4 / TODO 06 — Testing & Acceptance
> Author: google-dev-04 (DEV)
> Date: 2026-06-01
> Verdict: **ACCEPTED (backend automated criteria green; FE smoke items = manual)**

This report fills the master-plan §8 acceptance traceability. Each criterion is
mapped to the permanent pytest test(s) that exercise it and the real result.
Known limitations (R3 single-worker, R7 TTL) and deferred / manual items are
listed at the end.

---

## 1. Test suite — real results

Command (the TODO-06 acceptance command):

```
python -m pytest tests/test_rate_limiter_core.py tests/test_category_resolver.py \
  tests/test_client_ip.py tests/test_rate_limit_config_provider.py \
  tests/test_rate_limit_admin_api.py tests/test_rate_limit_integration.py \
  tests/test_authz_integration.py tests/test_auth_middleware.py -v
```

Result: **137 passed, 0 failed, 0 skipped** (≈10s).

| Test file | Count | Layer |
|---|---|---|
| `tests/test_rate_limiter_core.py` | 20 passed | unit — sliding-window kernel |
| `tests/test_category_resolver.py` | 37 passed | unit — `resolve_category` ordering |
| `tests/test_client_ip.py` | 8 passed | unit — `get_client_ip` |
| `tests/test_rate_limit_config_provider.py` | 13 passed | unit — TTL/invalidate/degrade provider |
| `tests/test_rate_limit_admin_api.py` | 14 passed | integration — admin API (router + DB + auth) |
| `tests/test_rate_limit_integration.py` | 9 passed | integration — RateLimitMiddleware end-to-end |
| `tests/test_authz_integration.py` | 9 passed | integration — authz (SessionAuth + require_admin + R8 router) |
| `tests/test_auth_middleware.py` | 27 passed | unit/integration — SessionAuthMiddleware (pre-existing, verified) |
| **Total** | **137 passed** | |

### Runnability fix (critical, in `tests/conftest.py`)

Two pre-existing environment blockers stopped a bare `pytest tests/` from
collecting. Both are now neutralised in the root `tests/conftest.py` **without
touching production code**:

1. **PostgreSQL `UUID` / `JSONB` on SQLite** — registered a dialect-scoped
   `@compiles(postgresql.UUID, "sqlite") → CHAR(36)` and
   `@compiles(postgresql.JSONB, "sqlite") → JSON` shim. Only the SQLite dialect
   compiler is affected; PostgreSQL renders natively, unchanged.
2. **Broken `cv2` binary** — a `sys.modules["cv2"]` stub installed **only if the
   real `import cv2` fails** (guarded: real import tried first), so importing
   `app.services.*` (whose `__init__` eagerly imports the OpenCV-using
   `video_composition_service`) works on this box.

Impact verification (before → after this conftest):
- Whole `tests/` collection: **666 collected / 23 collection errors → 965
  collected / 2 collection errors** (the remaining 2 — `test_content_polish_api.py`
  `SyntaxError`, `test_tts_api.py` `pytest.config` removed-API — are pre-existing
  bugs **in those test files**, not caused by and not in scope of this work).
- `tests/test_auth_middleware.py`: previously failed to even set up (UUID render
  error) → **27 passed**.
- `tests/test_settings_services.py`: previously failed collection (cv2) →
  **58 passed**.
- `tests/security/`: previously **1 collection error (could not run at all)** →
  now collects and runs **122 passed / 4 failed / 2 skipped**; the 4 failures are
  pre-existing environment issues (`No module named 'oss2'` for OSS upload tests;
  one flag-state-dependent error-shape assertion) — none caused by this work.

---

## 2. master-plan §8 traceability

| # | Acceptance criterion | Test(s) | Result |
|---|---|---|---|
| §8.1 | Except the public allowlist, anonymous requests to protected endpoints → 401; management (admin) endpoints for non-admin/root → 403. | `test_authz_integration.py::test_protected_anonymous_returns_401` (401 `UNAUTHORIZED`), `::test_management_non_admin_returns_403` (403 `FORBIDDEN`), `::test_management_admin_returns_200`, `::test_management_root_returns_200`, `::test_management_anonymous_returns_401`; `test_auth_middleware.py` T3/T11/T12 + R8 router. | **PASS** |
| §8.2 | Rate limiting works: over-quota → 429 + `Retry-After`; normal/AI/auth/media categories count independently. | `test_rate_limit_integration.py::test_normal_user_over_limit_returns_429`, `::test_ai_trips_earlier_and_independent_bucket`, `::test_auth_is_per_ip`, `::test_distinct_users_have_independent_buckets`, `::test_media_serving_high_quota_not_interrupted`; `test_category_resolver.py` (ordering); `test_rate_limiter_core.py` (window/recovery/retry_after). | **PASS** |
| §8.3 | Admin can change category quotas + global switch; change is hot-applied within seconds and written to the audit log. | `test_rate_limit_admin_api.py::test_put_valid_updates_persists_and_invalidates` (provider reflects immediately via `invalidate()`), `::test_reset_restores_defaults`, `::test_audit_rows_written_for_update_and_reset`; `test_rate_limit_config_provider.py::test_invalidate_forces_reread`, `::test_ttl_expiry_refreshes`. | **PASS** |
| §8.4 | Defaults are generous; normal human operation is never falsely limited; video/audio playback is not interrupted by rate limiting. | `test_rate_limit_integration.py::test_media_serving_high_quota_not_interrupted` (30 rapid media reqs all 200); defaults asserted in `test_rate_limit_admin_api.py::test_get_config_returns_defaults_and_meta` (media=6000) and `test_rate_limit_config_provider.py::test_empty_db_is_all_defaults`. | **PASS** |
| §8.5 | Frontend shows a friendly toast on 429; the new admin menu can read/write the rate-limit config. | Backend half (429 wire contract + admin read/write) verified by `test_rate_limit_integration.py` (429 `error_code="rate_limit.exceeded"` + `Retry-After`) and `test_rate_limit_admin_api.py`. **FE toast + menu render = manual smoke** (see §4). | **PASS (backend) / MANUAL (FE)** |
| §8.6 | Existing FE features do not regress once default-deny is enabled (token audit complete). | Backend invariant verified: logged-in path is flag-independent (`test_auth_middleware.py::test_flag_off_valid_token_still_injects_user`); allowlist anon passes (`test_authz_integration.py::test_allowlisted_config_anonymous_returns_200`). The FE token-carry audit was completed in TODO 05. **Full flag-on E2E of the 5 core flows = manual** (see §4). | **PASS (backend) / MANUAL (FE E2E)** |
| §8.7 | Middleware unit tests + key integration tests + 429 behaviour tests pass. | The full 8-file suite: **137 passed** (see §1). | **PASS** |

---

## 3. 429 contract (explicitly asserted)

Verified over the wire by `test_rate_limit_integration.py::test_normal_user_over_limit_returns_429`:

- HTTP status `429`.
- `Retry-After` header present, an integer `>= 1`.
- `X-RateLimit-Limit` + `X-RateLimit-Remaining` headers (`-Remaining == "0"` on deny).
- Body is the standard `ErrorResponse`: `success=false`, `message` (non-empty,
  user-facing zh string), `timestamp`, `error_code="rate_limit.exceeded"`,
  `error_details={retry_after, limit}` (matching the header values).

---

## 4. Known limitations, deferred items, and manual smoke

### Known limitations (documented, accepted)
- **R3 — single-worker counting.** The limiter is process-local (in-memory).
  Under `--workers>1` counts are not shared and the effective limit multiplies by
  the worker count. Production is documented as single-worker; the `RateLimiter`
  / config-provider seam is decoupled so a Redis backend can be dropped in later
  without middleware changes. Not exercised in tests (the test process is
  single-process by construction).
- **R7 — TTL propagation delay.** Non-invalidated DB edits take up to the TTL
  (5s) to propagate. The admin `PUT`/`reset` endpoints call `invalidate()` so
  changes through the API are near-immediate (verified). The UI should keep its
  "数秒内生效" copy. Covered: `test_rate_limit_config_provider.py::test_ttl_expiry_refreshes`.

### Deferred recommendation
- **`/api/user/health`** is NOT in the public allowlist. With
  `AUTH_ENFORCE_DEFAULT_DENY=true` an anonymous probe to it returns 401. Spec/01
  §3.2 lists only `/api/health`. Recommendation (carried from dev-01/dev-03,
  re-affirmed here): if ops uses `/api/user/health` as an unauthenticated probe,
  add it to `ALLOWLIST_EXACT`; otherwise the 401 is expected. **Not changed in
  this phase** — widening the public surface needs sign-off. No test asserts a
  200 for it (correctly).

### Frontend smoke checklist (MANUAL — from dev-03 phase-3 summary; cannot be a unit assertion)
Run on a live stack before/after flipping `AUTH_ENFORCE_DEFAULT_DENY=true`:
1. Login flow works; session validates on load + every 5 min.
2. Video editor: load project, preview/scrub, AI agent + workflow node tests
   (incl. `test-node` Pexels/Tavily/Volcano-TTS fan-out — the TODO-05 token fix).
3. TTS generation + playback (`<audio src="/api/audio/generated/...">` via the
   media allowlist, not a Bearer header).
4. Workflows: build/run a node graph.
5. Media playback (video Range chunking) is not interrupted under the
   `media_serving` high quota.
6. Admin → "接口安全 / 限流" page: GET config renders the form from `meta`; PUT a
   value persists; reset restores defaults; `/status` panel populates.
7. Trigger a 429 (lower a quota, spam an endpoint) → friendly throttled toast
   appears (time-window debounce, not a permanent latch), reads `Retry-After`.

> These are deployment-time steps. Everything verifiable at unit/integration
> level without a live full stack is automated and green (§1/§2).

---

## 5. Product bugs found

**None.** Two test-authoring corrections were made during this phase (both test
bugs, not product bugs):
- The "DB-error degrades to last-good cache" case is only the **TTL-expiry**
  path; `invalidate()` deliberately drops the cache to `None` so a forced re-read
  on a broken DB degrades to all-defaults. The test was rewritten to drive the
  TTL path for last-good-cache and the invalidate path for defaults — both now
  assert the real (correct) provider behaviour.
- A `root` user in `test_authz_integration.py` was created with `is_admin=False`;
  production seeding (`app/database.py`) always sets `is_admin=True` for root, and
  `require_admin` checks `is_admin`. The fixture was corrected to mirror real
  root-user state (`is_root=True, is_admin=True`).
