# Spec 01: Backend Auth Middleware + Allowlist

> **Owner role:** Backend developer
> **Layer:** FastAPI backend (`backend-services/basic-service/`)
> **Depends on:** None (Phase 1 — independent)
> **Blocks:** S04 (Next.js routes need to know rules), S07 (testing exercises this)

---

## 1. Purpose

Stop relying on per-endpoint `Depends(get_current_user)` to enforce authentication, and instead enforce it **once** in a request-level middleware that intercepts every incoming request before it reaches a router. This gives us:

- **Secure-by-default**: any new endpoint added in the future is protected automatically — developers cannot forget
- **Single audit point**: one allowlist file is the entire surface area to review
- **Per-request user injection**: `request.state.user` is populated once and re-used by routers, eliminating duplicate DB lookups

---

## 2. Acceptance Criteria

1. A new file `backend-services/basic-service/app/middleware/auth_middleware.py` exists and exports a Starlette `BaseHTTPMiddleware` subclass (e.g., `SessionAuthMiddleware`) so it has access to `request.state`
2. The middleware is registered in `app/main.py` such that **CORS remains the outermost middleware**. In Starlette, `add_middleware` is LIFO — the call made LAST wraps all earlier ones. Therefore the registration order in `main.py` MUST be: (a) `app.add_middleware(SessionAuthMiddleware)` first, (b) `app.add_middleware(CORSMiddleware, ...)` second. This makes CORS outermost so that preflight `OPTIONS` requests are answered before they ever reach the auth layer. The existing `@app.middleware("http")` logging middleware stays where it is — it gets added after CORS at decoration time and ends up as the outermost wrapper, but since it does not block requests this is acceptable.
3. An allowlist constant exposes the exact set of paths exempt from auth (see Section 4)
4. Anonymous request to a non-allowlisted path → **HTTP 401** with the standard `ErrorResponse` envelope
5. Authenticated request (valid token) to a non-allowlisted path → middleware sets `request.state.user` and forwards to the router
6. Authenticated request with valid token but `is_active=False` → **HTTP 403**
7. Allowlisted path → middleware passes through without DB lookup
8. The existing `get_current_user` / `require_admin` / `require_root` dependencies in `app/dependencies/auth.py` continue to work (backwards compatible) — `get_current_user` is modified to read from `request.state.user` first, falling back to its current DB-lookup path only when `request.state.user` is unset (e.g., direct unit tests that bypass middleware). `require_admin` / `require_root` are unchanged because they delegate to `get_current_user`.
9. Pytest test file `tests/test_auth_middleware.py` covers all branches above with at least 12 assertions
10. Audit report (text file `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md`) lists every router and what auth is required (anonymous / user / admin / root)

---

## 3. Behavior Specification

```
                        ┌─────────────┐
   incoming request →   │   CORS MW   │  (handles OPTIONS preflight)
                        └──────┬──────┘
                               ↓
                        ┌──────────────────────────────┐
                        │   SessionAuthMiddleware      │
                        ├──────────────────────────────┤
                        │ 1. extract path & method     │
                        │ 2. if OPTIONS → pass         │
                        │ 3. if path in allowlist →    │
                        │    pass (no DB lookup)       │
                        │ 4. extract token: Bearer or  │
                        │    raw Authorization, or     │
                        │    x-session-token (legacy)  │
                        │ 5. if no token → 401         │
                        │ 6. async DB lookup user by   │
                        │    active_session_token     │
                        │ 7. if no user → 401          │
                        │ 8. if !user.is_active → 403  │
                        │ 9. set request.state.user    │
                        │ 10. forward to next middle-  │
                        │    ware / router             │
                        └──────────────┬───────────────┘
                                       ↓
                              ┌────────────────┐
                              │  Other MWs &   │
                              │     Router     │
                              └────────────────┘
```

### 3.1 Token extraction (pseudocode)
```
function extract_token(request):
    auth = request.headers["Authorization"]
    if auth starts with "Bearer ":
        return strip(auth[7:])
    if auth is non-empty:
        # legacy: raw token in Authorization header (pre-refactor clients)
        return strip(auth)
    legacy = request.headers["x-session-token"]
    if legacy:
        return strip(legacy)
    return None
```
The "raw Authorization" branch matches the existing behavior in `app/dependencies/auth.py::_extract_token` and MUST be preserved so that any in-flight pre-refactor request still works during the rolling deploy. Per master plan D8, the canonical form sent by the new frontend wrapper (S03) is `Authorization: Bearer <token>` only.

### 3.2 Allowlist matching algorithm
- Exact-match paths: `/api/auth/login`, `/api/auth/register`, `/api/auth/validate-session`, `/api/health`, `/api/health/`, `/docs`, `/redoc`, `/openapi.json`
- Prefix-match paths: `/static/`, `/api/storage/files/` (note: trailing slash significant)
- Algorithm: first try exact match (O(1) set lookup), then iterate prefix list

### 3.3 Error response shape (must match existing `ErrorResponse` model)

`ErrorResponse` is defined in `app/models/base_models.py` and inherits from `BaseResponse`. Its field set is: `success: bool`, `message: str`, `timestamp: datetime` (ISO string when serialized), `data: Optional[Any]` (default `None`), `error_code: Optional[str]`, `error_details: Optional[Dict[str, Any]]`. Example payload returned by the middleware:
```json
{
  "success": false,
  "message": "未提供认证凭证",
  "timestamp": "2026-04-07T12:00:00",
  "data": null,
  "error_code": "UNAUTHORIZED",
  "error_details": {"reason": "Missing session token"}
}
```
- `error_code: "UNAUTHORIZED"` for 401 (missing token, invalid/expired token, or token mismatch) — matches the existing `get_current_user` 401 branches
- `error_code: "ACCOUNT_DISABLED"` for 403 (token valid but `is_active=False`) — matches the existing `get_current_user` 403 branch

Reusing the existing error codes is mandatory: any client (frontend HTTP wrapper in S03, integration tests in S07) that already branches on `UNAUTHORIZED` / `ACCOUNT_DISABLED` continues to work without change. The middleware MUST NOT introduce new code values.

### 3.4 Interaction with existing dependencies
The middleware MUST cooperate with the existing dependency-based auth (`get_current_user`, `require_admin`, `require_root`):

| Dependency | New behavior |
|---|---|
| `get_current_user` | Reads `request.state.user` if present (set by middleware), falls back to current implementation if not (e.g., during direct unit tests that don't use the middleware). Returns the user object. |
| `require_admin` | Calls `get_current_user`, then checks `is_admin or is_root`. Unchanged. |
| `require_root` | Calls `get_current_user`, then checks `is_root`. Unchanged. |

This means routers can KEEP their `Depends(get_current_user)` declarations — they become a no-op fast-path read from `request.state.user` rather than a duplicate DB hit. **We do not delete the `Depends` declarations in this spec**; the audit (Section 5) merely verifies they remain consistent.

---

## 4. The Allowlist (final, exhaustive)

| Path | Match type | Reason |
|---|---|---|
| `/api/auth/login` | exact | Login entry point — anonymous by definition |
| `/api/auth/register` | exact | Self-service registration |
| `/api/auth/validate-session` | exact | Frontend periodic session check (token in body, not header) |
| `/api/health` | exact | Backend health endpoint used by watchdog + monitoring |
| `/api/health/` | exact | Same with trailing slash |
| `/docs` | exact | FastAPI Swagger UI |
| `/redoc` | exact | FastAPI ReDoc |
| `/openapi.json` | exact | OpenAPI schema (no sensitive info) |
| `/static/` | prefix | Frontend static assets served by FastAPI mount (covers `/static/timeline_exports/`) |
| `/api/storage/files/` | prefix | User-uploaded media (KNOWN GAP — see Risk R3 in master-plan) |
| `/api/audio/generated/` | prefix | **Phase 3.7 addition** — TTS-generated audio mount. Browsers request these via `<audio src=>` which cannot send Authorization headers. Same KNOWN GAP class as `/api/storage/files/`. |
| `/api/audio/subtitles/` | prefix | **Phase 3.7 addition** — generated subtitle files mount, same constraint as `/api/audio/generated/`. |

**Phase 3.7 (2026-04-07) note:** The original spec only enumerated `/api/storage/files/` as a static-mount allowlist entry. The dev-server test on 2026-04-07 served a 401 on a TTS-generated audio file (`/api/audio/generated/agent-segment-0_concatenated_*.mp3`), revealing that 2 of the 4 FastAPI `StaticFiles` mounts in `app/main.py` were missing from the allowlist. The rule going forward: **every `app.mount(...)` call in `app/main.py` MUST have a corresponding entry in `ALLOWLIST_PREFIX` until signed-URL gating ships.** Phase 3.7 added the 2 missing entries and 3 regression tests (T16-T18 in `tests/test_auth_middleware.py`).

**Anything not on this list requires authentication.** This includes: `/api/video/*`, `/api/audio/transcribe`, `/api/audio/transcribe-local`, `/api/llm/*`, `/api/chat/*`, `/api/intent-detection/*`, `/api/image/*`, `/api/workflow/*`, `/api/storyboard/*`, `/api/youtube/*`, `/api/tts/*`, `/api/timeline-export/*`, `/api/timeline-import/*`, `/api/system-settings/*`, `/api/user/*`, `/api/model-settings/*`, `/api/video-understanding-script/*`, `/api/workflow-preferences/*`, `/api/ai-mixed-editing/*`, `/api/workflow/ai-video-generate`, `/api/workflow/video-export`. Note: `/api/audio/generated/` and `/api/audio/subtitles/` are passthrough (allowlisted), but `/api/audio/transcribe` / `/api/audio/transcribe-local` are NOT — the trailing slash discipline matters.

---

## 5. Backend Router Audit (deliverable)

The implementer MUST produce `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md` with one row per router, structured as:

| Router file | Mount path | # of endpoints | Anonymous | User | Admin | Root | Notes |
|---|---|---|---|---|---|---|---|
| `auth_router.py` | `/api/auth` | 5 | 4 | 1 | 0 | 0 | login/register/validate are anonymous; logout requires user |
| `user_router.py` | `/api/user` | ~12 | 0 | varies | varies | varies | profile is user, list is admin, delete is root |
| ... | ... | ... | ... | ... | ... | ... | ... |

This audit is the **single source of truth** for what the middleware allows. The audit MUST:
1. Be generated by reading every `app/routers/*.py` file
2. Match exactly against the allowlist in Section 4 — any route NOT in the allowlist must require at least `user` level
3. Flag any router that currently lacks any `Depends` and warn about it explicitly
4. Confirm zero in-process self-calls from `app/services/*` to API endpoints (mitigates Risk R7)

---

## 6. Test Matrix (`tests/test_auth_middleware.py`)

| # | Scenario | Expected |
|---|---|---|
| T1 | GET `/api/health` no headers | 200 |
| T2 | POST `/api/auth/login` no headers | passthrough (router decides) |
| T3 | GET `/api/video/search` no headers | 401 + `UNAUTHORIZED` |
| T4 | GET `/api/video/search` with `Authorization: Bearer invalid` | 401 + `UNAUTHORIZED` |
| T5 | GET `/api/video/search` with valid token | 200 (or whatever the router returns) |
| T6 | GET `/api/video/search` with valid token, user inactive | 403 + `ACCOUNT_DISABLED` |
| T7 | GET `/api/video/search` with `x-session-token: <valid>` | 200 (legacy header still works) |
| T8 | OPTIONS `/api/video/search` no auth | 200/204 (CORS preflight passes) |
| T9 | GET `/static/test.png` no auth | 404 or 200 (passthrough) |
| T10 | GET `/api/storage/files/foo.jpg` no auth | passthrough (allowlisted) |
| T11 | GET `/api/system-settings/categories` admin user | 200 |
| T12 | GET `/api/system-settings/categories` non-admin user | 403 (`require_admin` still enforced) |
| T13 | Concurrency: 100 parallel requests, only 1 DB lookup per request (verify `request.state.user` reuse inside the same request) — OPTIONAL stretch goal |
| T14 | Allowlist prefix match: `/api/storage/files/sub/dir/file.jpg` → passthrough |
| T15 | Allowlist prefix mismatch: `/api/storage/files-other` → requires auth |

---

## 7. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| Token belongs to a deleted user | DB lookup returns None → 401 |
| Token belongs to a user whose `active_session_token` was just rotated | DB lookup uses the CURRENT value → 401 (intended — single-device login enforcement) |
| Request body is large (file upload) | Middleware MUST NOT read the body — operate on headers only |
| Path traversal: `/api/auth/../video/search` | FastAPI normalizes the path before middleware sees it; we operate on the normalized version. Verify with T15-style test |
| WebSocket upgrades | OUT OF SCOPE — no current WS endpoints. Future WS endpoints will need their own auth handshake |
| Internal calls from other middleware | Middleware only sees client requests; not applicable |

---

## 8. Files to Create / Modify

| File | Action | LoC estimate |
|---|---|---|
| `app/middleware/__init__.py` | Create (empty) | 1 |
| `app/middleware/auth_middleware.py` | Create | ~100 |
| `app/main.py` | Modify (add middleware registration) | +5 |
| `app/dependencies/auth.py` | Modify (read from `request.state.user` first) | +15 |
| `tests/test_auth_middleware.py` | Create | ~250 |
| `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md` | Create | ~150 |

**Estimated total LoC: ~520** (within the <500 LoC soft limit per task; the audit doc is documentation, not source LoC)

---

## 9. Out of Scope for This Spec

- Adding role checks to currently-naked routers (this happens in S04 by way of routes already declaring the right `Depends` — middleware does NOT add role checks itself)
- Refactoring `get_current_user` to be sync — keep async for DB access
- Caching user objects across requests — only per-request via `request.state.user`
- Signed URL implementation for `/api/storage/files/` — deferred to a separate ticket (Risk R3)

---

## 10. Coordination Notes for Other Agents

- **For S04 (Next.js routes sweep):** The backend is now strict. Every Next.js route handler MUST forward `Authorization: Bearer <token>` from the incoming request. The frontend HTTP wrapper (S03) already injects this header, so the routes just need to pass it through.
- **For S07 (testing):** The integration test suite needs a fixture that creates a real test user, logs in, captures the token, and uses it. The middleware is the boundary that integration tests will hammer.
- **For S08 (deployment):** No env var changes are required for this spec. The middleware is hard-wired (allowlist is a Python constant).
