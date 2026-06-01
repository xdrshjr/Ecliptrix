# DEV Execution Summary — TODO 04 前端后台 UI 与 429 处理 (Frontend Admin UI & 429 Handling)

## Meta
- **Agent**: google-dev-03
- **Role**: DEV
- **Task**: todo-04 (Frontend Admin UI & 429 handling)
- **Phase**: 3 (group C, single track; after TODO 02/03)
- **Verdict**: COMPLETED (provisional — pending Reviewer + Tester)

## Key Decisions

1. **Bind the form 1:1 to the backend contract (no nesting, no rename).** The
   `GET /config` envelope exposes `config.{enabled, window_seconds,
   limits:{5 flat keys}, meta:{per-key default/type/min/max/description}}` as
   TOP-LEVEL `config` on `BaseResponse` (verified by reading
   `rate_limit_settings_router.py`). The API client reads `res.config` /
   `res.status` directly; the PUT body sends the 7 keys FLAT at top level (not
   under `limits`). Min/max for each `NumberField` comes from `config.meta`, so
   the form bounds always track the backend's single source of truth
   (`app/config.py` RATE_LIMIT_META) — zero hard-coded ranges.

2. **Reuse the `backend-proxy` helper for all 3 proxy routes** (verified in
   TODO 05 that `createPassthroughRoute` forwards `Authorization` +
   `x-session-token`). One-liners each — no hand-rolled fetch. So `require_admin`
   on the backend sees the caller's session; non-admin → backend 403.

3. **429 → `RateLimitError extends ApiError`, dispatch-on-every-429, throttle in
   the listener.** `http-client` parses `Retry-After` (delta-seconds OR
   HTTP-date, fallback 5s), dispatches `ecliptrix:rate-limited {retryAfter,
   message}`, and throws `RateLimitError` (carries `retryAfter`). **No auto-retry**
   (429 is a 4xx; the special branch sits before the generic 4xx branch in BOTH
   `request` and `streamRequest`). The global toast lives in `AuthContext` (which
   already owns `useNotification`/`useLocale` and the `session-expired` listener),
   using a **TIME-WINDOW throttle** (`lastRateLimitWarnAt`, window = `max(Retry-
   After, 3s)`) — explicitly NOT the 401 permanent `sessionExpiryHandled` latch
   (which would mute every future 429). One friendly toast per burst; later 429s
   still surface.

4. **Avoided the `static code` collision.** `ApiError` declares `static readonly
   code = 'API_ERROR'` (narrowed literal type), so a subclass cannot redeclare
   `static code` with a different literal (TS2417). I named the subclass's static
   constant `RateLimitError.CODE` instead; the INSTANCE `.code` is still
   `'RATE_LIMITED'` (set via `super(...)`), which is the runtime contract.

5. **Reused existing field primitives** (`NumberField`, `SwitchField`,
   `SettingsSectionCard`) and existing i18n action keys
   (`save`/`saving`/`loading`/`settingsRestoreDefaults`/`settingsResetting`) —
   the `resetDefaults` key I first reached for does NOT exist; corrected to the
   real keys. Matches the look-and-feel of the other 8 panels.

6. **Disabled-state UX:** when `enabled=false` the limit inputs get
   `opacity-50 pointer-events-none select-none` + `aria-disabled` and a
   `rlDisabledHint` ("限流已停用") banner; current values stay visible (spec §4).
   The `enabled` toggle and `window_seconds` remain editable so the admin can
   re-enable.

7. **Status panel is best-effort:** a `/status` failure does not break the
   editable form (its catch swallows). Includes a manual Refresh button; status
   also re-loads after each successful save/reset.

## Execution Flow
1. Read spec/04, todo/04, global-context Phase-2 digest, dev-02's TODO 03 summary
   (exact `GET /config` JSON + PUT/reset/status semantics + 429 contract).
2. **现状核对** — read `AdminSettingsPage.tsx`, `SettingsSidebar.tsx`,
   `http-client.ts` (401/403 branches, both `request` + `streamRequest`),
   `AuthContext.tsx` (`session-expired` listener + `NETWORK_WARN_THROTTLE_MS`),
   `NotificationContext.tsx`, `VideoAnalysisSettingsPanel.tsx` +
   `SettingsFieldHelpers.tsx` + `SettingsSectionCard.tsx` (panel conventions),
   and the i18n `adminSettings` block boundaries (type ~525, EN ~3333, ZH ~6163).
3. Verified the backend router response envelope (`config`/`status` top-level,
   `meta` = 7 keys, PUT `extra="forbid"`) against my client types.
4. Built: i18n (type + EN + ZH, in sync) → API client → 3 proxy routes →
   http-client 429 (error class + `parseRetryAfter` + `makeRateLimitError` +
   branches in both fns) → AuthContext listener → `RateLimitSettings` component
   → menu wiring (3 edits).
5. **Verification:** `rm -rf .next/types` (stale cache from prior phase) then
   `npm run type-check` → **clean (exit 0)** after fixing the TS2417 static-code
   collision. ESLint CLI is broken in this env (`next lint`: "Cannot find module
   './plugins'" — pre-existing install issue; ESLint errors are ignored in prod
   builds per CLAUDE.md anyway); manually reviewed for `prefer-const`/unused/deps.

## Artifacts
**Created:**
- `src/lib/api/rateLimitSettings.ts` — typed client (`getConfig`/`updateConfig`/
  `resetConfig`/`getStatus` + `RateLimitConfig`/`RateLimitLimits`/
  `RateLimitMeta`/`RateLimitStatus`/`RateLimitConfigUpdate` types).
- `src/app/api/rate-limit/config/route.ts` — `createPassthroughRoute` GET+PUT.
- `src/app/api/rate-limit/reset/route.ts` — `createPassthroughRoute` POST.
- `src/app/api/rate-limit/status/route.ts` — `createPassthroughRoute` GET.
- `src/components/AdminSettings/RateLimitSettings.tsx` — the config page.

**Modified:**
- `src/lib/api/http-client.ts` — `RateLimitError extends ApiError`,
  `parseRetryAfter`, `makeRateLimitError` (dispatch + throw), 429 branch in
  `request` and `streamRequest`.
- `src/contexts/AuthContext.tsx` — `ecliptrix:rate-limited` listener + module
  throttle (`lastRateLimitWarnAt`, `RATE_LIMIT_WARN_MIN_WINDOW_MS`).
- `src/components/AdminSettings/SettingsSidebar.tsx` — `SettingsMenuItem` union
  + `apiSecurity` menu item (shield icon).
- `src/components/AdminSettings/AdminSettingsPage.tsx` — import + `case
  'apiSecurity'` → `<RateLimitSettings/>`.
- `src/lib/i18n.ts` — `t.adminSettings.*` rate-limit strings in the TYPE
  interface + EN + ZH blocks (menu name/desc, page title/desc, section
  titles/desc, 5 limit labels, window/enabled/disabled-hint, status labels,
  save/reset success/error/load-error, and `rateLimited` toast with `{seconds}`).

## Interfaces consumed (Produces → Consumers)
**Consumes (backend, TODO 03 — matched exactly):**
- `GET /api/rate-limit/config` → `{config:{enabled, window_seconds,
  limits:{5 flat keys}, meta:{7 keys × {default,type,min,max,description}}}}`.
- `PUT /api/rate-limit/config` → flat subset of 7 keys; 422 unknown/out-of-range
  (nothing written), 403 non-admin; returns the new effective config envelope.
- `POST /api/rate-limit/reset` → no body; returns config envelope.
- `GET /api/rate-limit/status` → `{status:{enabled, active_keys, total_checked,
  total_blocked}}`.
- 429 contract (TODO 02): `Retry-After` header + `ErrorResponse(error_code=
  "rate_limit.exceeded", error_details={retry_after, limit})`. The FE reads
  `Retry-After` for the countdown; the body `error_code`/details flow into
  `RateLimitError.details`.

**Produces (FE):**
- `RateLimitError` (exported from `http-client`) + `ecliptrix:rate-limited`
  CustomEvent `{retryAfter, message}`.
- `rateLimitSettingsApi` client + the 3 `/api/rate-limit/*` proxy routes.
- `apiSecurity` AdminSettings menu → `RateLimitSettings` panel.

## Issues & Risks
- **ESLint not runnable in this env** (`next lint` broken module). Type-check is
  clean; relied on manual review + existing-pattern reuse. Reviewer/Tester in a
  healthy env should run `npm run lint` for final confirmation.
- **Full-set PUT on save:** the component PUTs all 7 keys (a valid subset = the
  whole set). Harmless — backend validates each and echoes the effective config.
  If a future requirement needs dirty-only PUT, the client already supports
  subsets.
- **429 toast duration** is `max(retryAfter*1000, 4000)` so the countdown copy
  stays visible roughly for the cooldown. The copy shows the INITIAL retryAfter
  (no live tick-down) — matches spec ("含倒计时秒数", a static N, not a live timer).
- **No live polling of `/status`** — manual Refresh + post-save reload only
  (avoids a background timer hammering the admin API). Acceptable per spec
  (read-only panel).
- **Multi-worker note (inherited from TODO 03):** `/status` counters and
  `invalidate()` are per-process; production is single-worker. Not a FE concern.

## Context for Downstream — what TODO 06 should smoke-test on the FE
1. **Admin happy path:** open AdminSettings → "接口安全 / 限流" (`apiSecurity`)
   menu appears → form loads current config (values + meta-driven min/max) →
   edit a limit → Save → success toast "已保存,数秒内生效" → backend reflects (PUT
   echoes new value; re-fetch shows it).
2. **Reset:** Reset button → "已重置为默认" toast → values return to defaults.
3. **Toggle-off:** flip `enabled` off → limit inputs grey out + "限流已停用" hint;
   Save → `/status` `enabled` shows Off.
4. **Validation:** put an out-of-range value (the `NumberField` clamps client-
   side, but if a raw 422 ever returns) → error toast, form keeps values. (The
   `NumberField` auto-clamps to meta min/max on blur, so most invalid input is
   prevented before PUT.)
5. **Non-admin:** a non-admin reaching the panel (or curling the proxy) → backend
   403 → `ForbiddenError` (the panel-level gating normally hides the entry, but
   the backend is the real guard).
6. **429 behaviour:** drive any endpoint past its limit (e.g. hammer an
   `ai_generation` route after lowering `ai_generation_per_min`) → exactly ONE
   warning toast "请求过于频繁,请 N 秒后重试" with N from `Retry-After`; NO auto-
   retry; a burst yields one toast (time-window throttle); a later 429 toasts
   again (NOT permanently latched). Verify via both `http.*` (JSON) and
   `http.stream` paths if convenient.
7. **i18n:** switch EN/ZH → all rate-limit labels/toasts localized, no missing
   keys (type-check already guarantees EN/ZH/type parity).
