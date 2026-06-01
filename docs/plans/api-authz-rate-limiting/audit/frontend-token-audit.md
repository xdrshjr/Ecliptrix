# Frontend Token Audit & Rollout Checklist — `AUTH_ENFORCE_DEFAULT_DENY`

> TODO 05 deliverable (Phase 2) · Owner: google-dev-03
> Spec: [`specs/05-frontend-token-audit-and-rollout.md`](../specs/05-frontend-token-audit-and-rollout.md)
> Consumes: TODO 01 PUBLIC_ALLOWLIST + `AUTH_ENFORCE_DEFAULT_DENY` flag (dev-01)
> Status: AUDIT COMPLETE — 1 real regression fixed, 1 rate-category miss fixed, 1 deferred item recommended

This is the **gate** that lets the backend default-deny middleware
(`AUTH_ENFORCE_DEFAULT_DENY`) be flipped to `true` safely. It is an audit +
two targeted fixes + a rollout checklist — not a rewrite.

---

## 0. Executive summary

| Metric | Result |
|---|---|
| Total Next.js proxy route files (`src/app/api/**/route.ts`) | **118** |
| Routes via the `backend-proxy` helper (auto-forward `Authorization` + `x-session-token`) | **103** |
| Routes NOT via the helper (escape hatches / direct calls) | **15** |
| — third-party LLM/CDN direct (no backend session) | **13** |
| — backend-session escape hatches (self-enforce + forward token) | **2** (compliant) |
| Routes needing a fix for the flag flip | **1** (`workflow/test-node` internal fan-out) — **FIXED** |
| Bare browser `fetch('/api/...')` bypassing http-client | **3** (1 LLM-direct OK, 1 dead path, 1 test file) |
| `EventSource` usages | **0** |
| Backend rate-category miss found & fixed | **1** (`/api/ai-mixed-editing` → `ai_generation`) |
| Deferred items decided | **2** (`/api/user/health` flagged; `/api/ai-mixed-editing` fixed) |

**Conclusion:** The unified `backend-proxy` helper already forwards
`Authorization` + `x-session-token` on every one of the 103 routes that use it,
and `http-client` injects `Bearer` by default on every browser call. R1 was
correctly narrowed to "verify helper coverage + enumerate escape hatches." Of
the 15 escape hatches, **14 were already correct** (third-party direct calls or
self-enforcing proxies). **Exactly one** real regression existed:
`workflow/test-node` validated the caller's session but did NOT forward the
token on its internal fan-out fetches to backend-proxied routes — that would
break Pexels / Tavily / TTS node tests once the flag flips on. **Fixed.**

---

## 1. Helper verification (Task A — 现状核实)

### `src/lib/api/server/backend-proxy.ts`
- `buildForwardedHeaders` (lines 133–155): on **every** proxied call it
  unconditionally copies the incoming request's `Authorization` header and the
  legacy `x-session-token` header onto the upstream request, plus any
  `forwardHeaders` extras. Confirmed for all verbs (GET/POST/PUT/PATCH/DELETE)
  and for both buffered and `streaming: true` paths (the header build happens in
  `executeProxy` before the streaming short-circuit).
- `createPassthroughRoute` / `backendProxy.{get,post,put,patch,del}` are thin
  wrappers over `executeProxy`, so all of them inherit the auth forwarding.
- **Coverage:** 103 / 118 route files import `createPassthroughRoute`/`backendProxy`.

### `src/lib/api/http-client.ts`
- `requireAuth` defaults `true` (line 292) — opt-out, secure-by-default.
- `Bearer ${token}` injected at lines 328–330 (`request`) and 533–535
  (`streamRequest`). `http.download` (line 765) routes through `streamRequest`,
  so authenticated downloads carry the token too.
- 401 → global session-expiry handling; 403 → `ForbiddenError`. (429 handling is
  TODO 04's scope, not this audit's.)

**Result of Task A:** R1 risk is confirmed narrowed to "enumerate & classify the
15 non-helper escape hatches + bare browser fetches." Done below.

---

## 2. Escape-hatch classification (Tasks B + C)

The 15 routes that do NOT use `backend-proxy`, each classified. **"Needs
session?"** = does the route hit a *protected* FastAPI backend endpoint.
**"Token OK?"** = is auth correctly handled for the flag-on world.

| # | Route | Class | Hits FastAPI backend? | Needs session? | Token OK? | Fix? |
|---|---|---|---|---|---|---|
| 1 | `ai-video-script-expand` | 3rd-party LLM (`LLM_API_*`) | No | No | n/a | N |
| 2 | `ai-video-script-generation` | 3rd-party LLM (`LLM_API_*`) | No | No | n/a | N |
| 3 | `content-polish` | 3rd-party LLM (SSE) | No | No | n/a | N |
| 4 | `content-polish-multiple` | 3rd-party LLM (SSE) | No | No | n/a | N |
| 5 | `creative-brainstorming` | 3rd-party LLM (SSE) | No | No | n/a | N |
| 6 | `prompt-polish` | 3rd-party LLM (`LLM_API_*`) | No | No | n/a | N |
| 7 | `script-keywords-generation` | 3rd-party LLM (`LLM_API_*`) | No | No | n/a | N |
| 8 | `translate-search-query` | 3rd-party LLM (`FAST_LLM_*`) | No | No | n/a | N |
| 9 | `video-ai-match` | 3rd-party LLM (Aliyun DashScope, `AI_VIDEO_MATCH_LLM_*`); has SWEEP-NOTE | No | No | n/a | N |
| 10 | `video-script-generation` | 3rd-party LLM (`LLM_API_*`) | No | No | n/a | N |
| 11 | `polish-config` | Local YAML config read (`getClientSafePolishConfig`) | No | No (public-safe, no secrets) | n/a | N |
| 12 | `video-proxy` | CDN media proxy (strict host allowlist: OSS + ARK CDN); `<video src>` | No (3rd-party CDN) | No | n/a | N |
| 13 | `chat` (`/api/chat`) | 3rd-party LLM streaming (SWEEP-EXCEPTION / Pattern E). One backend `GET /api/model-settings/resolve/chat` to resolve creds — **does NOT forward caller token** (resolve route falls back to env if 401) | resolve-only | No (resolve degrades to env defaults) | OK by design | N |
| 14 | `video-editing-chat` | 3rd-party LLM streaming. Also calls backend `/api/intent-detection/detect` and **forwards `Authorization`** (line 194) | Yes (intent-detection) | Yes | **Yes** | N |
| 15 | `video-editing-agent/chat` | Agent SDK / Pattern E (SWEEP-EXCEPTION). **Self-enforces 401** if no token (line 302); forwards `Authorization`+`x-session-token` to `/api/model-settings/resolve/chat` (line 181); Agent tools forward `authToken` on every internal fetch (`tools/apiHelper.ts:106`) | Yes | Yes | **Yes** | N |

### Escape-hatch findings of note

- **`/api/chat` (resolve creds without caller token)** — `getConfig()` calls
  `GET /api/model-settings/resolve/chat` with NO caller token, and on a non-2xx
  silently falls back to `.env` `LLM_API_*`. This is **acceptable**: `/api/chat`
  is a server-to-server credential resolution, not a user-scoped read, and the
  env fallback keeps chat working. The *user-selected* model from
  `model_settings` will not be applied for the plain `/api/chat` route once the
  flag is on (resolve → 401 → env fallback), but **chat still works**. The
  Agent route (#15) correctly forwards the token to resolve, so the agent path
  honours user model selection. **Not a regression** (no functional break), but
  logged here for awareness — see §6 Deferred/Notes.

- **`video-proxy`** is the `<video src>` CDN passthrough for ARK/OSS temporary
  URLs. Host-allowlisted (≤3 explicit hosts), no backend session involved. Safe.

---

## 3. Bare browser `fetch` / streaming / media sweep (Task C cont.)

Searched all of `src/` for browser-side `fetch('/api/...')` outside http-client,
`EventSource`, `window.open`, `<a download>`, and media `src` patterns.

| Location | Target | Class | Token OK? | Action |
|---|---|---|---|---|
| `components/video/hooks/useStoryboardChat.ts:194` | `/api/chat` | 3rd-party LLM SSE (custom reader); explicit eslint-disable documents "no session auth required" | OK (no session needed) | None |
| `components/video/components/VideoCoverModal/components/ImageUploadInput.tsx:61` | `/api/storage/upload` | **Dead path** — no such route exists (routes are `upload-file` / `upload-video`); 404 today regardless of flag | n/a (pre-existing 404 bug) | **Note only** — out of scope; flag does not change behaviour. Flagged for a separate fix (should be `/api/storage/upload-file`). |
| `components/AdminSettings/__tests__/ModelSettingsPanel.test.ts` | (test fixture) | Jest test, not runtime | n/a | None |

- **`EventSource`: 0 occurrences.** All SSE/streaming in the FE is consumed via
  `fetch(...).body.getReader()` (either `http.stream` for protected backend
  streams, or bare `fetch` for the third-party-LLM SSE routes which need no
  session). Protected streaming routes (e.g. `ai-video-script-generation` via
  `createPassthroughRoute(..., { streaming: true })`) go through the helper and
  forward auth.

- **Media playback (`<video>` / `<audio>` / `<img>`):** these issue raw browser
  GETs that carry **neither** an `Authorization` header **nor** a cookie (the FE
  stores the session token in `localStorage` as `ecliptrix-session-token`, not a
  cookie). Media works because the backend **PUBLIC_ALLOWLIST** exempts the media
  prefixes:
  - `/api/storage/files/` (served via `storage/files/[...path]` helper route,
    `streaming` + Range forwarding)
  - `/api/audio/generated/`, `/api/audio/subtitles/`
  - `/static/`

  **Key correctness point for rollout:** media playback does **not** depend on
  auth — it depends on the allowlist. The middleware's cookie fallback
  (`auth_middleware._extract_token` line 170) is a latent capability this FE
  does not exercise. So when `AUTH_ENFORCE_DEFAULT_DENY=true`, media playback is
  unaffected *as long as the allowlist prefixes are intact* (verified — see
  §5). Authenticated downloads use `http.download` (fetch-with-Bearer → Blob),
  not raw GETs, so they keep working too.

---

## 4. Fixes applied (Task D + deferred-item #2)

### Fix 1 — `src/app/api/workflow/test-node/route.ts` (the one real R1 regression)
`workflow/test-node` already gates the caller via
`verifySessionFromRequest(request)` (returns 401 if the caller has no valid
session). **But** its node executors fan out to internal same-origin routes
**without forwarding the caller's token**:

| Internal target | Backend? | Flag-on behaviour BEFORE fix |
|---|---|---|
| `/api/video-search` → backend `/api/video/search` (proxied) | Yes | **401 → Pexels node test breaks** |
| `/api/workflow/tavily-search` → backend (proxied) | Yes | **401 → Tavily node test breaks** |
| `/api/tts/convert-sentences` → backend (proxied) | Yes | **401 → Volcano TTS node test breaks** |
| `/api/chat` → 3rd-party LLM | No | OK (no session needed) |

**Fix:** added `buildInternalAuthHeaders(request)` (extracts the caller's token
via `extractSessionToken` from `sessionGuard`, builds `Authorization: Bearer
<token>` + `x-session-token`) and threaded `internalAuthHeaders` into every node
executor (`executeChatLLMNode`, `executePexelsVideoSearchNode`,
`executeTavilySearchNode`, `executeVolcanoTTSNode`, `executeToArrayNode`,
`executeResultsCombineNode`, `executeResultsCombineItemTransformation`). The
backend-bound fetches now carry the user's session; `/api/chat` gets it too
(harmless, uniform). Type-checked clean.

### Fix 2 — `backend-services/basic-service/app/services/rate_limiter.py` (deferred item #2)
The `_AI_GENERATION_PREFIXES` tuple's **comment block** (line 343) listed
`/api/ai-mixed-editing` as an AI-generation endpoint, but the **tuple itself was
missing it** — so `/api/ai-mixed-editing` resolved to `normal` (≈300/min) instead
of `ai_generation` (≈30/min). It is a long-running (600s timeout) compute-heavy
AI editing endpoint that unambiguously belongs in `ai_generation`. Added the
one-line prefix. This is the "low-risk one-liner you MAY apply" from the task
directive. `py_compile` clean.

> No other route needed a fix — the 103 helper routes and the 14 compliant
> escape hatches already forward/handle auth correctly.

---

## 5. Allowlist cross-check (what must stay public for the flip)

Verified against `app/middleware/auth_middleware.py` (the live flag gate). For
the flip to be safe, these must remain exact:

**ALLOWLIST_EXACT:** `/api/auth/login`, `/api/auth/register`,
`/api/auth/validate-session`, `/api/health`(+`/api/health/`), `/docs`,
`/redoc`, `/openapi.json`.

**ALLOWLIST_PREFIX:** `/static/`, `/api/storage/files/`,
`/api/audio/generated/`, `/api/audio/subtitles/`, `/api/config/`.

**HARD_PROTECT_PATHS (always 401 even flag-off):** `/api/workflow/ai-video-generate`,
`/api/workflow/video-export`, `/api/intent-detection`.

FE startup dependency check: `GET /api/config/playback-flag` (read before a
session exists) → covered by the `/api/config/` prefix. `/api/auth/logout` and
`/api/auth/me` are **NOT** public — FE must (and does, via http-client) send a
token.

---

## 6. Deferred-item decisions (Task E / §5 of the directive)

### `/api/user/health` — **RECOMMEND allowlist, but FLAGGED to dev-01 (not applied)**
- It is a backend `UserService` health probe (`user_router.py:299`, does a DB
  check). It is **NOT** used by the frontend (no `src/app/api/**` route proxies
  to it; no FE component references `user/health`).
- Flag OFF → passes through. Flag ON → anonymous probe gets **401** (it is not
  `/api/health`, which is the canonical allowlisted probe).
- **Decision:** Do **not** widen the public surface unilaterally. The canonical
  `/api/health` probe already exists and is allowlisted; external monitors
  should target that. IF ops has a monitor pinned to `/api/user/health`, dev-01
  should add `"/api/user/health"` to `ALLOWLIST_EXACT` (one line). Otherwise it
  is acceptable to let it sit behind auth. **Action for TODO 06:** assert that
  anonymous `/api/user/health` → 401 under flag-on is *expected* (not a
  regression), or add the allowlist entry if a monitor needs it.

### `/api/ai-mixed-editing` rate category — **APPLIED (Fix 2 above)**
- Belongs in `ai_generation`; the prefix was missing from
  `_AI_GENERATION_PREFIXES` despite being documented in the adjacent comment.
  One-line, clearly-correct, low-risk → applied. **Action for TODO 06:** add a
  `resolve_category("/api/ai-mixed-editing") == "ai_generation"` unit assertion.

### Note (no action) — `/api/chat` user-model selection under flag-on
- `/api/chat` resolves creds via `/api/model-settings/resolve/chat` **without**
  the caller's token; flag-on makes that resolve return 401 and `/api/chat`
  falls back to `.env` LLM. Chat still works; only the *user-selected* model is
  not applied for this specific route (the Agent route forwards the token and is
  unaffected). Not a functional regression. If desired later, forward the
  caller's token in `chat/route.ts:getConfig()` the same way
  `video-editing-agent/chat` does — but that is a behaviour improvement, not a
  rollout blocker, and is out of this audit's scope.

---

## 7. Rollout / 灰度 checklist — flipping `AUTH_ENFORCE_DEFAULT_DENY` safely

### Switch facts
- **Name:** `AUTH_ENFORCE_DEFAULT_DENY` (backend `.env` / `app/config.py`
  `auth_enforce_default_deny`). Truthy set: `{1, true, yes, on}`. **Default:
  `false`.**
- **What it gates:** ONLY the *rejection* of a missing/invalid/disabled
  credential on a non-allowlisted path. Valid-token resolution + `request.state.user`
  injection happen regardless of the flag, so logged-in behaviour is identical
  with the flag on or off.
- **Always-on regardless of flag:** `HARD_PROTECT_PATHS` (the 3 root-mounted
  endpoints) and router-level `require_admin`/`require_root` deps
  (`model_settings`, `system_settings`, admin user mgmt, `admin_playback`).
- **Independent of rate limiting:** the rate-limit global switch is
  `RateLimitConfig.enabled` (SystemSetting `rate_limiting` category, default
  **true**, hot-reloaded via `rate_limit_config_provider` TTL). It is a
  *different* knob in a *different* store. Limiting can be on while auth-deny is
  off, and vice-versa. **Do not conflate them.**

### Recommended sequence
1. **Merge** spec 01–05 code with `AUTH_ENFORCE_DEFAULT_DENY=false` (no behaviour
   change). This audit's two fixes ride along.
2. **Confirm FE token audit complete** (this document) — done. The single
   regression (`test-node` fan-out) is fixed; all other escape hatches verified.
3. **(Optional) Grace-logging dry run.** Before flipping to hard-deny, run a
   "log-only" pass: temporarily add a `logger.warning("would-401", {path,
   method})` branch in `auth_middleware.dispatch` at the `if not enforce:`
   passthrough points (token-missing / no-user) — i.e. log every
   non-allowlisted, un-tokened request that *would* be rejected, without
   rejecting. Tail logs through a full manual exercise of: login, video editor
   (incl. AI agent + node tests), TTS, workflows (incl. `test-node` for Pexels
   /Tavily/TTS nodes), media playback (video + audio + thumbnails), downloads,
   admin settings. **Expected "would-401" hits: only genuinely public/unauth
   surfaces** (none should be a real user action). Any unexpected hit = a missed
   token-carry site → fix before step 4. (This is the R1 belt-and-suspenders.)
4. **Test environment:** set `AUTH_ENFORCE_DEFAULT_DENY=true`. Run the TODO 06
   integration suite (both flag states) + manual regression of the core flows in
   step 3. Specifically verify:
   - Anonymous protected route → 401; valid token → 200.
   - Allowlist anon (`/api/config/playback-flag`, media prefixes) → still 200.
   - `model_settings` / admin routes → anon 401, non-admin 403, admin 200.
   - **Workflow `test-node`** Pexels / Tavily / Volcano-TTS nodes succeed
     (regression target of Fix 1).
   - Media playback (`<video>`/`<audio>`) uninterrupted; authenticated download
     works.
   - `/api/user/health` anon → 401 is *expected* (see §6) unless allowlisted.
5. **Production:** set `AUTH_ENFORCE_DEFAULT_DENY=true` after test-env sign-off.
6. **Rollback:** set `AUTH_ENFORCE_DEFAULT_DENY=false` (or remove the env var)
   and restart — instant, no code change. The rate-limit `enabled` switch is
   untouched by this rollback.

### Acceptance gate for TODO 06
- All escape-hatch rows in §2 have a conclusion (done).
- `test-node` fan-out forwards token (Fix 1) — add an integration assertion.
- `resolve_category("/api/ai-mixed-editing") == "ai_generation"` (Fix 2) — add a
  unit assertion.
- Flag-on core flows show no regression (manual + integration).

---

## 8. Artifacts changed by this task
- **Modified:** `src/app/api/workflow/test-node/route.ts` — forward caller
  session on internal fan-out fetches (Fix 1).
- **Modified:** `backend-services/basic-service/app/services/rate_limiter.py` —
  add `/api/ai-mixed-editing` to `_AI_GENERATION_PREFIXES` (Fix 2).
- **Created:** this audit document.
- **Not changed (verified compliant):** `backend-proxy.ts`, `http-client.ts`,
  `sessionGuard.ts`, all 103 helper routes, the 14 compliant escape hatches,
  `video-editing-agent` tools.
