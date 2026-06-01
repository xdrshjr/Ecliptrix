# REVIEWER Summary — Phase 4 (TODO 06)

## Meta
- **Agent**: google-reviewer-01
- **Role**: REVIEWER
- **Phase**: 4 (terminal)
- **Verdict (Task — TODO 06, google-dev-04)**: PASS
- **Method**: Static review of the test code for correctness/coverage/masking against `specs/06`, master-plan §8, and the live phase-1–3 contracts. Information boundary respected — I reasoned about results but did not run the suite. Read all 7 new test files + the conftest + the acceptance report; cross-checked claims against the real product code (`app/database.py` root seeding, the provider's degrade paths, the 429 wire contract).

## Key Decisions (review-level)
1. **PASS with zero fixes.** The suite genuinely asserts the phase-1–3 contracts, the runnability shims are correctly scoped and production-safe, there is no hidden-green, and both documented "test-authoring corrections" are honest reflections of real product behaviour (not masked bugs). Nothing warrants a fix or rework.
2. I verified the two corrections against source rather than trusting the summary: the provider degrade split (TTL-path keeps last-good-cache vs invalidate→defaults) matches the Phase-2 provider code I reviewed; the root fixture `is_admin=True` matches `app/database.py` seeding exactly.

## conftest safety (highest scrutiny) — SAFE
- **UUID/JSONB shims** — `@compiles(postgresql.UUID, "sqlite") → CHAR(36)` and `@compiles(postgresql.JSONB, "sqlite") → JSON` are **dialect-scoped to `"sqlite"`**. The compiler handler is registered ONLY for the SQLite dialect; PostgreSQL renders natively, unchanged. They affect test-time table creation only — production never runs pytest, and even if it did, the handlers are SQLite-only. Replaces the prior throwaway `-p uuid_shim` plugin / per-fixture metadata mutation with a clean permanent solution. SAFE.
- **cv2 stub** — `_install_cv2_stub_if_broken()` returns early if `cv2` is already imported, tries the REAL `import cv2` FIRST, and installs the `sys.modules` stub ONLY when that raises (the broken-OpenCV dev box). A healthy install / CI / production is never shadowed. The stub fails LOUDLY (`_unavailable` raises) on any real op, so it can never silently return wrong data. Installed at conftest import time so it precedes any `app.services.*` import. SAFE.
- Both shims alter only test collection, never app behaviour. The net collection improvement (666/23-errors → 965/2-errors; auth 27, settings 58, security 122 all unblocked) is a genuine side benefit; the 2 residual collection errors are pre-existing bugs in unrelated test files (`test_content_polish_api.py` SyntaxError, `test_tts_api.py` removed `pytest.config`) — out of scope, not regressions.

## No hidden green — CLEAN
- Scanned all 7 files for `@pytest.mark.skip`/`xfail`/`skipif`, early `return`, bare `except:`, `assert True`, `pass #`. **None.** Only two matches in a masking scan, both benign:
  - `test_rate_limit_admin_api.py:113` `except Exception:` in the `_override_get_db` fixture — standard transactional pattern that **re-raises** (`raise`), so it cannot mask a failure (mirrors production `get_db_session`).
  - `test_rate_limiter_core.py:254` `with pytest.raises(Exception):` — asserts the frozen `Decision` REJECTS mutation (a failure must occur); slightly broad but it is checking-for-error, not swallowing one.
- Every test makes real, specific assertions against the shipped contracts.

## Both documented "test-authoring corrections" — LEGITIMATE
1. **Provider degrade split** (`test_rate_limit_config_provider.py`): `test_db_error_after_ttl_expiry_keeps_last_good_cache` drives the TTL-expiry path (refresh fails → keep last-good 77); `test_db_error_degrades_to_defaults_without_raising` drives the no-prior-cache path → `DEFAULT_CONFIG`. This matches the real provider exactly (`_load_from_db` returns `self._cache if not None else DEFAULT_CONFIG`; `invalidate()` nulls `_cache`). Two DIFFERENT real code paths, correctly asserted — not a swept-under bug.
2. **Root fixture `is_admin=True`** (`test_authz_integration.py::test_management_root_returns_200`): the fixture creates root with `is_root=True, is_admin=True`. Verified against `app/database.py` — root is seeded with `is_admin=True` in all three branches (sync/promote/create), and `require_admin` checks `is_admin`. The correction mirrors production truth, not a workaround.

## Coverage vs spec 06 — COMPLETE
- **Kernel (`test_rate_limiter_core.py`, 20)** — allow/deny, window recovery (fake-clock + one real sleep), `retry_after` math (re-derived: 10s→50, 59.5s→1 floor, 10.2s→50 ceil — all match the kernel), fail-open on non-positive limit (incl `None`), concurrency exactness under `gather`, GC bound (stale + last-resort), stats/reset isolation, frozen `Decision`.
- **Category (`test_category_resolver.py`, 37)** — `/api/audio/generated/` & `/api/audio/subtitles/`→media (NOT swallowed by `/api/audio/` ai prefix), `/api/ai-mixed-editing`→ai (Phase-2 Fix 2), `validate-session`/`logout`→normal, exact-vs-prefix auth, default bucket, ordering proofs.
- **Client IP (`test_client_ip.py`, 8)** — XFF first-segment/strip/chain/override, fallback to client.host, empty/whitespace-XFF fallback, `"unknown"` sentinel.
- **Provider (`test_rate_limit_config_provider.py`, 13)** — DB key parse, missing-key→default, empty→all-defaults, TTL cache-hit (1 load/5 reads), invalidate forces re-read, TTL expiry refresh (fake clock), DB-error degrade (both paths), coercion, prewarm. `StaticPool` `:memory:` persistence + lazily-imported-factory patch are correct.
- **Admin API (`test_rate_limit_admin_api.py`, 14)** — real router behind real `require_admin` + SessionAuth + committing `get_db_session` override; GET meta (7 keys, ranges 10–3600 / 1000000), non-admin 403 ×4, anon 401, PUT valid persists+invalidates, **PUT 422 with before/after row equality** (no write), window boundary 10/3600 ok & 9/3601 422, reset→defaults, status field set, audit rows (`update`+`reset`, `system_setting`, `changed_by`).
- **RL integration (`test_rate_limit_integration.py`, 9)** — real `RateLimitMiddleware` in production LIFO order; full 429 wire contract; ai independent bucket; auth per-IP; per-user-vs-per-IP identity (proves Auth→RateLimit, R5); distinct users independent; `enabled=false` passthrough (no headers); media high quota (30 reqs); OPTIONS not counted; real-window recovery. `patch_config` patches BOTH the cfg-module singleton AND the middleware's imported reference — correct.
- **Authz integration (`test_authz_integration.py`, 9)** — real SessionAuth + real `require_admin`/`get_current_user` + real R8 `model_settings_router`; protected anon→401, user→200, disabled→403 ACCOUNT_DISABLED, invalid→401; management anon→401, non-admin→403 FORBIDDEN, admin→200, root→200; allowlist `/api/config/`→200.

## Assertion fidelity — MATCHES SHIPPED CONTRACTS
- 429: `error_code="rate_limit.exceeded"`, `Retry-After` int ≥1, `X-RateLimit-Limit/-Remaining`, `error_details={retry_after, limit}` cross-checked against the header — exactly the Phase-1/2 contract.
- Admin PUT: flat top-level keys, 422 on out-of-range/unknown WITHOUT writing (row-equality assertion) — matches `extra="forbid"` + validate-before-write.
- Authz: `UNAUTHORIZED`/`FORBIDDEN`/`ACCOUNT_DISABLED` exact — matches the preserved error-code contract.

## Acceptance report — COMPLETE & HONEST
- master-plan §8 has exactly 7 criteria; the report maps all 7 (§8.1–§8.7) to concrete passing tests. §8.5/§8.6 are honestly marked "PASS (backend) / MANUAL (FE)" — the FE toast/menu-render and the flag-on E2E of the 5 core flows are genuinely live-stack manual steps, captured as a §4 checklist.
- R3 (single-worker) and R7 (TTL) documented and accepted, not falsely "fixed"; R7's invalidate-immediate path IS tested.
- Deferred `/api/user/health`: report explicitly states NO test asserts a 200 for it (correct — anon→401 under flag-on is expected, not a regression).
- Honest "no product bugs; two test-only corrections" with accurate descriptions.

## Issues & Risks
- **None blocking.** The dev's 137-passed claim is consistent with the code I read (every test has a real assertion, fixtures are sound, no masking). The Tester will confirm by running `pytest` per the acceptance command.
- Minor (non-blocking): a couple of assertions are range-based (`test_non_positive_window_defaults_to_sixty` asserts `1 <= retry_after <= 60`) where an exact value was derivable — slightly loose but still meaningful; not worth a change.

## Context for Downstream (Tester)
- Run the acceptance command verbatim (8 files) → expect **137 passed**. The suite is hermetic via the conftest shims; no project venv required on the broken-OpenCV box (cv2 stub is guarded; on a healthy box the real cv2 is used and the stub is a no-op).
- For a FULL `pytest tests/` green: the 2 residual collection errors + 4 `tests/security` failures are pre-existing/env-only (`pip install oss2` resolves 3), independent of this work.
- Execute the §4 manual FE smoke checklist on a live stack with `AUTH_ENFORCE_DEFAULT_DENY=true` before the prod flip — focus on the `test-node` Pexels/Tavily/Volcano-TTS fan-out (TODO-05 fix), media playback via allowlist (no Bearer), the admin "接口安全/限流" page, and the throttled 429 toast (time-window, not permanent latch) with the proxied-Retry-After value (the Phase-3 fix).

## Excellence note (D10-qualifying)
The conftest runnability fix is exemplary platform engineering: it converts two throwaway per-run hacks into a permanent, conservatively-scoped solution (dialect-scoped compiler shims + guarded import stub) that is provably production-safe AND unblocks three previously-dead test suites as a side benefit. The integration tests drive the REAL middleware/router/dependencies (not reimplementations) in production LIFO order, the provider tests correctly distinguish the two degrade paths, and the 422-no-write assertion uses a before/after row comparison rather than a status-only check. The two test-authoring corrections were diagnosed against product source and documented honestly. This is a rigorous, contract-faithful, masking-free terminal test suite.
