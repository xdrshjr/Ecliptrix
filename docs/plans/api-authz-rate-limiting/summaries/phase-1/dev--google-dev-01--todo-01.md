# DEV Execution Summary — TODO 01 鉴权覆盖 (Authorization Coverage)

## Meta
- **Agent**: google-dev-01
- **Role**: DEV
- **Task**: todo-01 (Authorization Coverage)
- **Phase**: 1 (parallel group A, alongside dev-02 / TODO 02)
- **Verdict**: COMPLETED (provisional — pending Reviewer + Tester)

## Key Decisions

1. **Converge, do not rebuild.** The default-deny middleware skeleton shipped in `5473c7a`
   already exists and was correct. I verified its real behavior first (see Execution Flow)
   and made only differential changes.

2. **The middleware previously enforced default-deny UNCONDITIONALLY.** Any non-allowlisted
   request without a valid token got a hard 401. Per spec/01 §5 + master-plan R1 and my task
   directive, I introduced **`AUTH_ENFORCE_DEFAULT_DENY` (default `false`)** to *gate the
   enforcement*, so behaviour is unchanged for un-tokened calls until the TODO 05 frontend
   token-carry audit completes. This is the central regression-safety mechanism (R1).

3. **Enforcement gating is surgical — only the REJECTION is gated, never the resolution.**
   When a valid token is present the middleware still resolves it and injects
   `request.state.user` regardless of the flag, so the normal logged-in path behaves
   identically with the flag on or off (zero regression for authenticated users). The flag
   only decides whether a *missing / invalid / disabled* credential on a non-allowlisted path
   becomes a 401/403 (flag on) or passes through unauthenticated (flag off).

4. **`HARD_PROTECT_PATHS` are ALWAYS enforced**, independent of the flag — `enforce = flag OR
   _is_hard_protected(path)`. The three root-mounted high-risk endpoints (ai-video-generate /
   video-export / intent-detection) were locked down in the prior hardening; spec/01 §5
   mandates "保留不弱化 / do not weaken". So even with the flag off, anonymous hits on those
   still 401.

5. **R8 (model_settings_router) — highest priority.** Confirmed it shipped with ZERO auth and
   configures provider API keys. Attached `require_admin` at the **router level**
   (`APIRouter(dependencies=[Depends(require_admin)])`) so every current/future endpoint is
   admin-gated by default and none can be forgotten. This is enforced via the dependency
   layer, so it holds **regardless of `AUTH_ENFORCE_DEFAULT_DENY`** (anonymous → 401 from
   `get_current_user` slow path; non-admin → 403; admin/root → 200).

6. **Allowlist convergence (spec/01 §3.2).** Added the `/api/config/` prefix (frontend reads
   `GET /api/config/playback-flag` at startup before a session exists). Deliberately did NOT
   add the bare `/api/` root nor bare `/api/config`: `src/lib/api/config.ts` already documents
   that `/api/config` callers must be authenticated, and the trailing slash means `/api/config`
   (no slash) does not match the new prefix. Did NOT add `/api/auth/logout` or `/api/auth/me`
   (they require login). Kept `HARD_PROTECT_PATHS` intact; OPTIONS preflight already passes.

7. **Error codes preserved** — `UNAUTHORIZED` / `FORBIDDEN` / `ACCOUNT_DISABLED` unchanged
   (frontend branches on these).

## Execution Flow

1. Read all four planning docs (master-plan, spec 01, todo 01, task-orchestration).
2. **现状核对** — Read and reasoned through the live code:
   - `auth_middleware.py`: `_is_allowlisted` puts hard-protect FIRST (wins over allowlist),
     then exact set, then prefix scan. Confirmed it **already 401s non-allowlisted untokened
     requests unconditionally** (no flag existed). error_codes: `UNAUTHORIZED` (401),
     `ACCOUNT_DISABLED` (403).
   - `dependencies/auth.py`: `get_current_user` has the `request.state.user` fast path + a
     slow path (extract+DB query) for when middleware didn't run / didn't inject. `require_admin`
     (is_admin, root included) and `require_root` raise 403 `FORBIDDEN`.
   - `main.py`: router prefixes; `ai_video_generate`/`video_export`/`intent_detection` mount at
     root (hence HARD_PROTECT_PATHS); static mounts for audio/timeline.
   - `model_settings_router.py`: **zero auth** — confirmed R8.
   - `system_settings_router.py` + `admin_playback_router.py`: every endpoint already has
     `Depends(require_admin)` (per-endpoint). **Compliant — no change.**
   - `user_router.py`: self-profile (`/profile`, `/me/preferences`) on `get_current_user`;
     all management endpoints on `require_admin` with inline root-target protection
     (`_check_admin_target_protection`) and `create_user` requiring root to create an admin.
     **Already fully compliant with spec/01 §3.3 — no change.**
3. Implemented changes (see Artifacts).
4. **Verification** — `py_compile` clean on all four files. The repo's `pytest` for User-creating
   tests fails to even collect in the ambient Python because `db_models` uses
   `postgresql.UUID` which SQLAlchemy 2.0.25 cannot render on SQLite (pre-existing,
   reproduced on unmodified `main` — affects `test_auth_service.py` etc. too, not my change).
   I wrote a standalone harness that applies a UUID→CHAR(36) SQLite compile shim (what the
   project venv effectively provides) and drove the real `SessionAuthMiddleware` through both
   flag states. All 11 assertions passed (see Issues & Risks for the exact matrix).

## Artifacts

**Modified:**
- `backend-services/basic-service/app/config.py` — added `auth_enforce_default_deny` Field
  (default False) + env wiring `AUTH_ENFORCE_DEFAULT_DENY` (truthy set `{1,true,yes,on}`).
- `backend-services/basic-service/app/middleware/auth_middleware.py` —
  (a) added `/api/config/` to `ALLOWLIST_PREFIX`;
  (b) `from app.config import settings`;
  (c) gated the 4 rejection branches (missing token / no user / token mismatch / disabled)
  behind `enforce = settings.auth_enforce_default_deny or _is_hard_protected(path)`; valid-token
  resolution + `request.state.user` injection is unconditional.
- `backend-services/basic-service/app/routers/model_settings_router.py` — added
  `Depends(require_admin)` at router level (R8); imported `Depends` + `require_admin`.
- `backend-services/basic-service/tests/test_auth_middleware.py` —
  (a) updated `test_allowlist_constants_match_spec` for the new `/api/config/` prefix;
  (b) autouse fixture flips `AUTH_ENFORCE_DEFAULT_DENY=True` for the legacy rejection-behaviour
  tests (T3/T4/T6/T15/T18 + defense-in-depth) so they keep asserting the enforcement path;
  (c) added 5 new tests: flag-off ordinary passthrough (no token / invalid token), flag-off
  valid-token still injects user, flag-off HARD_PROTECT still 401, `/api/config/` allowlist.
- `backend-services/basic-service/env.template` — documented `AUTH_ENFORCE_DEFAULT_DENY`.

**Created:** none (no new source files).

> NOTE: `app/main.py` and `app/middleware/rate_limit_middleware.py` /
> `app/services/rate_limit_*` show as changed/untracked in git — those belong to **dev-02 /
> TODO 02** (parallel). I did NOT touch them.

## Interfaces Touched (Produces → Consumers)

- **`AUTH_ENFORCE_DEFAULT_DENY`** flag (config + env) → **consumed by dev-03 TODO 05** (gates
  the rollout: flip to `1` only after FE token audit) and the **Tester** (must test both states).
- **`PUBLIC_ALLOWLIST` (`ALLOWLIST_EXACT` + `ALLOWLIST_PREFIX`)** — now includes `/api/config/`.
  Consumed by `SessionAuthMiddleware` and referenced by **dev-02's rate-limit middleware** for
  anonymous-path identity resolution.
- **Error codes** `UNAUTHORIZED` / `FORBIDDEN` / `ACCOUNT_DISABLED` — UNCHANGED contract for FE.
- **`require_admin` on `model_settings_router`** — R8 closed; consumed by Tester (integration:
  anon→401, non-admin→403, admin→200) and by FE admin model-settings page (must send token).

## Issues & Risks

- **R1 (regression)**: mitigated — flag default false keeps un-tokened calls working. Verified
  flag-off passthrough. Real flip is TODO 05's call.
- **`/api/user/health`**: has no auth dep and is NOT in the allowlist. Flag OFF → passes
  through (fine). Flag ON → would 401 (it's not `/api/health`). Spec/01 §3.2 only lists
  `/api/health`. Flagging for TODO 05/06 to decide whether `/api/user/health` should be
  allowlisted or is acceptable to lock behind auth. Did not add it (out of the spec's explicit
  allowlist; conservative — don't widen public surface without sign-off).
- **Test environment**: ambient Python cannot run the SQLite User-creating tests
  (`postgresql.UUID` non-renderable on SQLite in SQLAlchemy 2.0.25). Pre-existing on `main`.
  Tester should run in the project venv (pinned deps) where this is configured. My standalone
  harness confirmed the logic; results:
  ```
  OFF anon /workflow/list               -> 200   (passthrough, no regression)
  OFF anon has_user                     -> False
  OFF valid-token has_user              -> True   (logged-in unchanged)
  OFF anon HARD ai-video-generate       -> 401   (never weakened)
  OFF anon /config/playback-flag        -> 200   (allowlist)
  OFF anon /model-settings              -> 401   (R8 via dependency)
  OFF non-admin /model-settings         -> 403   (R8)
  OFF admin /model-settings             -> 200   (R8)
  ON  anon /workflow/list               -> 401   (default-deny)
  ON  valid-token /workflow/list        -> 200
  ON  anon /config/playback-flag        -> 200   (allowlist exempt)
  ```

## Context for Downstream

**For dev-03 / TODO 05 (frontend token audit & rollout):**
- The single switch to flip is `AUTH_ENFORCE_DEFAULT_DENY` (backend `.env`, truthy =
  `1/true/yes/on`; default off). Flip to `1` ONLY after auditing that every `src/app/api/*`
  proxy forwards `Authorization`/cookie and all direct fetches go through `http-client`.
- Public allowlist (anonymous-reachable): `/api/auth/login`, `/api/auth/register`,
  `/api/auth/validate-session`, `/api/health`(+`/`), `/docs`, `/redoc`, `/openapi.json`, and
  prefixes `/static/`, `/api/storage/files/`, `/api/audio/generated/`, `/api/audio/subtitles/`,
  `/api/config/`. Everything else requires a token once the flag is on.
- `/api/auth/logout` and `/api/auth/me` are NOT public — FE must send a token.
- Watch `/api/user/health` (see Issues) when flipping.

**For Tester (TODO 06):**
- Test BOTH flag states (patch `auth_middleware.settings.auth_enforce_default_deny`).
- Flag-on matrix: anon→401 on protected; valid→200; allowlist anon→pass; disabled→403; HARD
  paths→401 even flag-off.
- R8: integration on `/api/model-settings/*` — anon 401, non-admin 403, admin 200.
- The drift-guard `test_allowlist_constants_match_spec` now expects 5 prefixes (incl
  `/api/config/`).
- Run in the project venv (asyncpg + SQLite-UUID-capable SQLAlchemy) — the ambient env here
  cannot collect User-creating SQLite tests.
