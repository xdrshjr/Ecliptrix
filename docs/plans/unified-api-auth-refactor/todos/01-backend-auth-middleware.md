# TODO 01: Backend Auth Middleware + Allowlist

> **Spec:** [specs/01-backend-auth-middleware.md](../specs/01-backend-auth-middleware.md)

## Dependencies

```yaml
depends_on: []
blocks: [04, 07]
parallel_group: A
```

- **No upstream dependencies** — can start immediately. Pure backend work, no frontend coupling.
- **Blocks T04 (Next.js routes sweep)** — once middleware is enforcing auth, T04 must guarantee every route forwards `Authorization`
- **Blocks T07 (testing)** — integration tests need the middleware live to verify 401 / 200 flows
- **Parallel group A** — runs in Phase 1 alongside T02 (backend URL config) and T03 (HTTP client wrapper). All three are independent.

## Tasks

- [ ] Read sibling spec `01-backend-auth-middleware.md` end to end
- [ ] Create directory `backend-services/basic-service/app/middleware/`
- [ ] Add empty `app/middleware/__init__.py`
- [ ] Implement `app/middleware/auth_middleware.py` as a Starlette `BaseHTTPMiddleware` subclass `SessionAuthMiddleware`
- [ ] Define `ALLOWLIST_EXACT` and `ALLOWLIST_PREFIX` constants matching spec §4 (10 entries total)
- [ ] Implement `extract_token(request)` per spec §3.1 — Bearer, raw Authorization fallback, x-session-token legacy
- [ ] Implement allowlist matching per spec §3.2 (exact set lookup, then prefix iteration)
- [ ] Implement DB lookup using existing async session pattern from `app/dependencies/auth.py`
- [ ] Set `request.state.user = user` on success
- [ ] Return JSON `ErrorResponse` with `error_code='UNAUTHORIZED'` for 401 and `error_code='ACCOUNT_DISABLED'` for 403, matching the real `ErrorResponse` shape from `app/models/base_models.py`
- [ ] Modify `app/dependencies/auth.py::get_current_user` to read from `request.state.user` first, fall back to current DB-lookup path on miss
- [ ] Modify `app/main.py` to register the middleware in the correct LIFO order (CORS LAST so it ends up outermost): `add_middleware(SessionAuthMiddleware)` first, `add_middleware(CORSMiddleware, ...)` second
- [ ] Verify the existing `@app.middleware("http")` logging middleware still works as outermost wrapper
- [ ] Create `tests/test_auth_middleware.py` covering cases T1-T12, T14, T15 from spec §6 (T13 concurrency case is marked OPTIONAL stretch goal in the spec — skip unless time permits). Total assertions MUST be ≥ 12 per spec §2 AC9
- [ ] Run `pytest tests/test_auth_middleware.py -v` until green
- [ ] Run full backend suite `pytest tests/ -v` to verify no regressions
- [ ] Confirm coverage of `auth_middleware.py` ≥ 90% via `pytest tests/test_auth_middleware.py --cov=app.middleware.auth_middleware --cov-report=term`
- [ ] Generate router protection audit at `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md` per spec §5
  - [ ] Iterate every file under `app/routers/`
  - [ ] For each endpoint: classify auth as anonymous / user / admin / root
  - [ ] Cross-check against the allowlist — anything NOT allowlisted must require ≥ user
  - [ ] Verify zero in-process self-calls from `app/services/*` to API endpoints (Risk R7)
  - [ ] Flag any router that lacks any `Depends` declaration
- [ ] Sync changed files to Singapore-01 staging area (per remote server protocol — only `app/middleware/`, `app/dependencies/auth.py`, `app/main.py`, `tests/test_auth_middleware.py`)
- [ ] Run `pytest tests/test_auth_middleware.py -v` ON the remote server to validate environment parity
- [ ] Write execution summary at `docs/plans/unified-api-auth-refactor/summaries/phase-1/dev--<agent-id>--todo-01.md` per orchestrator template
- [ ] Mark this TODO complete in the agent's completion report
