# Backend Route Protection Audit

> **Owner task:** T01 — Backend Auth Middleware + Allowlist
> **Spec reference:** `specs/01-backend-auth-middleware.md` §5
> **Generated:** 2026-04-07 (post-middleware deployment)
> **Single source of truth for:** Allowlist correctness, dependency hygiene, downstream consumer awareness

This audit lists every router under `backend-services/basic-service/app/routers/`
and classifies each endpoint by the auth level it requires once
`SessionAuthMiddleware` is in place.

## Auth-level legend

| Tag | Meaning | How enforced |
|-----|---------|--------------|
| `anonymous` | Path is in the allowlist (spec §4); middleware lets it through with NO database lookup | `ALLOWLIST_EXACT` / `ALLOWLIST_PREFIX` constants in `auth_middleware.py` |
| `user` | Any authenticated, active user (`is_active=True`) | Middleware enforces presence + activity. Routers MAY also declare `Depends(get_current_user)` for type-annotated access — that path is now a fast `request.state.user` read. |
| `admin` | `is_admin=True OR is_root=True` | Router-level `Depends(require_admin)` runs after middleware |
| `root` | `is_root=True` | Router-level `Depends(require_root)` runs after middleware |

## Allowlist (spec §4 — exhaustive)

| Path | Match type | Reason |
|------|-----------|--------|
| `/api/auth/login` | exact | Login entry point |
| `/api/auth/register` | exact | Self-service registration |
| `/api/auth/validate-session` | exact | Frontend periodic session check (token in body) |
| `/api/health` | exact | Backend health endpoint (watchdog/monitoring) |
| `/api/health/` | exact | Same with trailing slash |
| `/docs` | exact | FastAPI Swagger UI |
| `/redoc` | exact | FastAPI ReDoc |
| `/openapi.json` | exact | OpenAPI schema (no sensitive info) |
| `/static/` | prefix | Frontend static assets (FastAPI mount) |
| `/api/storage/files/` | prefix | User-uploaded media — **KNOWN GAP**, see Risks below |

Total: 8 exact + 2 prefix = **10 entries**.

## Router classification

Counts come from grepping `^@router\.(get\|post\|put\|delete\|patch)` against
each file. Mount paths come from `app/main.py`.

| # | Router file | Mount path | # endpoints | anonymous | user | admin | root | Notes |
|---|-------------|------------|-------------|-----------|------|-------|------|-------|
| 1 | `api_router.py` | `/api` | 3 | 1 (`/health`) | 2 (`/`, `/config`) | 0 | 0 | `/api/health` is allowlisted; `/` and `/config` become user-only after middleware. NO existing `Depends` declarations — they will work via middleware enforcement alone. **FLAGGED**: `/api/config` exposes app version + log level — consider whether this should remain user-only or be made anonymous via the allowlist. NOT changed in this task; flag for downstream review. |
| 2 | `auth_router.py` | `/api/auth` | 4 | 4 (`/login`, `/register`, `/validate-session`, `/health`) | 0 | 0 | 0 | All four paths in this router land in the allowlist (login/register/validate via exact, `/auth/health` is NOT in the allowlist — it does NOT match `/api/health`). **FLAGGED**: `/api/auth/health` is a duplicate health endpoint that becomes user-only after middleware. Either add it to the allowlist or delete it. **ACTION DEFERRED to downstream task** (out of scope for T01). |
| 3 | `user_router.py` | `/api/user` | 11 | 0 | 1 (`/profile`) | 9 | 0 | `/profile` requires authenticated user only; `/list`, `/create`, `/delete`, `/toggle-status`, `/reset-password`, `/login-history`, `/force-logout`, `/stats`, `/profile/{user_id}` (PUT) require admin. `/health` is unprotected today and will become user-only after middleware. Already declares `Depends(get_current_user)` and `Depends(require_admin)` correctly. |
| 4 | `system_settings_router.py` | `/api/system-settings` | 7 | 0 | 0 | 7 | 0 | All endpoints already declare `Depends(require_admin)`. No change needed — middleware adds defense in depth, dependency still enforces admin role. |
| 5 | `model_settings_router.py` | `/api/model-settings` | 12 | 0 | 12 | 0 | 0 | All endpoints become user-only after middleware. **FLAGGED**: provider CRUD operations (create/update/delete model providers) arguably should require admin, not user. NO existing `Depends` declarations. **ACTION DEFERRED** — not in T01 scope, flag for downstream review. |
| 6 | `video_router.py` | `/api/video` | 17 | 0 | 17 | 0 | 0 | All currently naked. After middleware: every endpoint requires authenticated user. NO existing `Depends`. |
| 7 | `tts_router.py` | `/api/tts` | 6 | 0 | 6 | 0 | 0 | All currently naked → user-only after middleware. NO existing `Depends`. |
| 8 | `storage_router.py` | `/api/storage` | 5 | 0 | 5 | 0 | 0 | All upload/list routes become user-only. The `/api/storage/files/` mount (StaticFiles) is allowlisted as a known gap (Risk R3). NO existing `Depends`. |
| 9 | `audio_router.py` | `/api/audio` | 6 | 0 | 6 | 0 | 0 | Audio transcription/search → user-only after middleware. NO existing `Depends`. |
| 10 | `youtube_router.py` | `/api/youtube` | 5 | 0 | 5 | 0 | 0 | Download/upload → user-only. NO existing `Depends`. |
| 11 | `workflow_router.py` | `/api/workflow` | 5 | 0 | 5 | 0 | 0 | Agent workflow CRUD → user-only. NO existing `Depends`. |
| 12 | `image_router.py` | `/api/image` | 2 | 0 | 2 | 0 | 0 | Image search → user-only. NO existing `Depends`. |
| 13 | `timeline_export_router.py` | `/api/timeline` | 3 | 0 | 3 | 0 | 0 | All naked → user-only. |
| 14 | `timeline_import_router.py` | `/api/timeline` | 3 | 0 | 3 | 0 | 0 | All naked → user-only. |
| 15 | `chat_router.py` | `/api` | 1 | 0 | 1 | 0 | 0 | LLM chat → user-only. |
| 16 | `ai_mixed_editing_router.py` | `/api` | 1 | 0 | 1 | 0 | 0 | AI mixed editing → user-only. |
| 17 | `ai_video_generate_router.py` | `(root, path = /api/workflow/ai-video-generate)` | 1 | 0 | 1 | 0 | 0 | Mounted at root; the path inside the route (`@router.post("/api/workflow/ai-video-generate")`) becomes user-only. |
| 18 | `video_export_router.py` | `(root, path = /api/workflow/video-export)` | 1 | 0 | 1 | 0 | 0 | Mounted at root; user-only. |
| 19 | `video_understanding_script_router.py` | `/api` | 2 | 0 | 2 | 0 | 0 | All naked → user-only. |
| 20 | `llm_router.py` | `/api/llm` | 2 | 0 | 2 | 0 | 0 | LLM models endpoint currently called from the browser via `NEXT_PUBLIC_BACKEND_URL` — that direct browser call will be migrated in T06. After middleware, anonymous calls return 401. |
| 21 | `intent_detection_router.py` | `/api/intent-detection` (mounted at root) | 1 | 0 | 1 | 0 | 0 | Currently called direct from browser via `NEXT_PUBLIC_BACKEND_URL`. T06 migrates that. After middleware, anonymous → 401. |
| 22 | `workflow_preferences_router.py` | `/api/workflow-preferences` | 3 | 0 | 3 | 0 | 0 | All naked → user-only. |
| 23 | `ark_video_router.py` | `/api/ark-video` | 2 | 0 | 2 | 0 | 0 | All naked → user-only. |
| 24 | `ark_image_router.py` | `/api/ark-image` | 1 | 0 | 1 | 0 | 0 | All naked → user-only. |
| 25 | `storyboard_router.py` | `/api/storyboard` | 8 | 0 | 8 | 0 | 0 | All naked → user-only. |
| 26 | `silence_removal_router.py` | `/api/silence` | 3 | 0 | 3 | 0 | 0 | All naked → user-only. |

**Total endpoints: 115**
**Allowlisted (anonymous): 5** (`/api/health` from `api_router`, plus `/login`, `/register`, `/validate-session`, `/api/auth/health` from `auth_router` — note that the last one's allowlist status depends on whether `/api/health` is matched as `/api/auth/health`. Per spec §3.2, the algorithm is exact-match first, so `/api/auth/health` is NOT in the allowlist; this is documented as a flag in row 2.)

Re-counting strictly per the allowlist as defined:
- `/api/auth/login` — allowlisted (auth_router)
- `/api/auth/register` — allowlisted (auth_router)
- `/api/auth/validate-session` — allowlisted (auth_router)
- `/api/health` — allowlisted (api_router)
- `/api/health/` — allowlisted (synonym)
- `/api/auth/health` — NOT allowlisted, FLAGGED row 2

So **4 anonymous endpoints actually live in the routers** (one duplicate `/api/health/` is just a trailing-slash variant of the same endpoint), plus the static mounts (`/static/`, `/api/storage/files/`). Everything else is user-or-stricter.

## Allowlist consistency check (spec §5 requirement #2)

> Anything NOT allowlisted must require at least `user` level after middleware.

| Allowlist entry | Matches an actual router endpoint? | Status |
|-----------------|------------------------------------|--------|
| `/api/auth/login` | YES (`auth_router.py:27`) | OK |
| `/api/auth/register` | YES (`auth_router.py:112`) | OK |
| `/api/auth/validate-session` | YES (`auth_router.py:186`) | OK |
| `/api/health` | YES (`api_router.py:48`) — FastAPI mounts `api_router` at `/api`, so `/health` becomes `/api/health` | OK |
| `/api/health/` | YES (trailing-slash redirect target of `/api/health`) | OK |
| `/docs` | YES (FastAPI built-in) | OK |
| `/redoc` | YES (FastAPI built-in) | OK |
| `/openapi.json` | YES (FastAPI built-in) | OK |
| `/static/` | YES (StaticFiles mount at `/static/timeline_exports`) | OK |
| `/api/storage/files/` | YES (StaticFiles mount in `app/main.py`) | OK — known gap (Risk R3) |

**No allowlist entry is dead.** Every entry maps to a real endpoint or mount.

Conversely, **no router endpoint outside the allowlist relies on being anonymous**. The previously-anonymous endpoints (~80% of the surface) all have legitimate user-context use cases — they were unprotected only because nobody added auth, not because they should be public.

## Routers without ANY auth dependency declaration

The following routers historically did NOT call `Depends(get_current_user)` /
`Depends(require_admin)` / `Depends(require_root)` on any endpoint:

- `api_router.py`
- `ai_mixed_editing_router.py`
- `ai_video_generate_router.py`
- `ark_image_router.py`
- `ark_video_router.py`
- `audio_router.py`
- `chat_router.py`
- `image_router.py`
- `intent_detection_router.py`
- `llm_router.py`
- `model_settings_router.py`
- `silence_removal_router.py`
- `storage_router.py`
- `storyboard_router.py`
- `timeline_export_router.py`
- `timeline_import_router.py`
- `tts_router.py`
- `video_export_router.py`
- `video_router.py`
- `video_understanding_script_router.py`
- `workflow_preferences_router.py`
- `workflow_router.py`
- `youtube_router.py`

**That's 23 of 26 router files** that were fully naked. The middleware closes
this hole atomically — every one of those files now requires authentication.

The remaining 3 files (`auth_router.py`, `user_router.py`, `system_settings_router.py`) already had partial or full coverage and are unaffected behaviorally except that admin/role checks now run AFTER the middleware has already populated `request.state.user`, eliminating one DB lookup per request.

## In-process self-call audit (Risk R7 — spec §5 #4)

> Confirm zero in-process self-calls from `app/services/*` to API endpoints.

I grepped `app/services/` for:
- `httpx.` / `requests.get|post|put|delete` — found 18 files using these, all of them targeting EXTERNAL APIs (Pexels, Volcano TTS, OpenAI/LLM providers, ByteDance ARK, Tavily, Freesound, YouTube)
- `localhost:8000` / `127.0.0.1:8000` — **zero matches** in `app/services/`
- `/api/(video|audio|llm|chat|workflow)` — only string-literal references to URL prefixes used for filename mapping (e.g. `audio_url = f"/api/audio/generated/{filename}"` — these are URLs RETURNED to the caller, not URLs the service fetches)

**Conclusion: Zero in-process self-calls.** Adding the auth middleware does not break any background-worker flow. Risk R7 is empirically clear.

## Flags (action items deferred to downstream tasks)

| # | Flag | Recommended action | Owner |
|---|------|--------------------|-------|
| F1 | `/api/auth/health` (auth_router) is a duplicate health endpoint that becomes user-only after middleware | Either add `/api/auth/health` to the allowlist or delete it. Suggest deletion since `/api/health` already exists. | T04 (routes sweep) or T07 (testing) |
| F2 | `/api/config` (api_router) exposes app version + log level to any authenticated user | Decide whether this should be admin-only. Currently classifies as user. | T04 |
| F3 | `model_settings_router.py` provider CRUD (create/update/delete model providers) becomes user-only by default. Provider credentials are sensitive. | Add `Depends(require_admin)` to write endpoints. | T04 |
| F4 | `/api/storage/files/` static mount remains publicly readable (cannot be middleware-protected without signed URLs) | Track signed-URL implementation as a separate ticket (Risk R3 in master plan) | Future ticket |

These flags are NOT blockers for T01. They are observations that should be addressed by T04 (Next.js routes sweep, which has the audit table as a checklist) or filed as new tickets.

## Cross-references

- Spec: `docs/plans/unified-api-auth-refactor/specs/01-backend-auth-middleware.md`
- TODO: `docs/plans/unified-api-auth-refactor/todos/01-backend-auth-middleware.md`
- Implementation: `backend-services/basic-service/app/middleware/auth_middleware.py`
- Tests: `backend-services/basic-service/tests/test_auth_middleware.py` (19 tests, 98% coverage on the middleware module)
- Modified files:
  - `backend-services/basic-service/app/main.py` — registers `SessionAuthMiddleware` BEFORE `CORSMiddleware` (LIFO → CORS becomes outermost)
  - `backend-services/basic-service/app/dependencies/auth.py` — `get_current_user` now reads `request.state.user` first (fast path), falls back to DB lookup (slow path / unit-test path)
