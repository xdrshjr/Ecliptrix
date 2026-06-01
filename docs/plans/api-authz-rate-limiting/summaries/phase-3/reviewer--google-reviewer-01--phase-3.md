# REVIEWER Summary — Phase 3 (TODO 04)

## Meta
- **Agent**: google-reviewer-01
- **Role**: REVIEWER
- **Phase**: 3
- **Verdict (Task D — TODO 04, google-dev-03)**: PASS WITH FIXES
- **Method**: Static correctness review against `specs/04`, the Phase-2 backend contract digest, and the live backend router. No test runs (information boundary respected). Read all created/modified files + the consumed primitives (`backend-proxy`, `SettingsFieldHelpers`, `SettingsSectionCard`) and counted i18n key parity.

## Fix Applied (1)
**`src/lib/api/http-client.ts` — `makeRateLimitError` Retry-After body fallback.**
- **Problem**: `makeRateLimitError` derived `retryAfter` ONLY from the `Retry-After` response header. The Next.js `backend-proxy` buffered path forwards only `Content-Type` on JSON 4xx responses (see `backend-proxy.ts` step 7, lines 345–350) — it drops `Retry-After` (and `X-RateLimit-*`). So for every rate-limited *business* endpoint reached through a proxy route (i.e. essentially all of them), `parseRetryAfter(null)` returned the hard-coded 5s default, and the toast/countdown would show "5s" regardless of the real server value. The backend's true value survives in the JSON body as `error_details.retry_after` (the proxy preserves the body), but the code never read it.
- **Fix**: when the header is absent (`=== null`), fall back to `parsed.details.retry_after` (guarded `typeof === 'number' && finite && > 0`, `Math.ceil`) before the default. Header still takes precedence (spec §2.3 says "read `Retry-After`"), so direct (non-proxied) backend calls are unchanged. Type-safe (`parsed.details` is `Record<string, unknown> | undefined`; structural cast + numeric guard). No design change — purely closes the proxied-path data gap.
- This is recorded as PASS WITH FIXES. Everything else is correct as shipped.

## Interfaces Verified
- **Contract fidelity** — client `getConfig/updateConfig/resetConfig/getStatus` read `res.config` / `res.status` (top-level on `BaseResponse`), matching the TODO 03 router (`RateLimitConfigResponse.config`, `RateLimitStatusResponse.status`). Types mirror the 5 flat `limits` keys + `meta{default,type,min,max,description}`. PUT sends a FLAT top-level subset of the 7 keys (component sends all 7 flat: `{enabled, window_seconds, ...limits}`) → matches the router's `extra="forbid"` request model. Form min/max come exclusively from `config.meta` (`minFor`/`maxFor`) — zero hard-coded ranges; the `useState` seed values are placeholders overwritten by `applyConfig` on load.
- **Proxy routes** — all three (`config` GET+PUT, `reset` POST, `status` GET) are one-line `createPassthroughRoute(...)` destructures; verified `buildForwardedHeaders` in `backend-proxy.ts` unconditionally forwards `Authorization` + `x-session-token` (and the JSON 4xx body+status pass through), so backend `require_admin` sees the session and a 429/422/403 reaches the client with status preserved.
- **429 handling** — `RateLimitError extends ApiError` with `retryAfter`; the `static code` collision (TS2417) was correctly avoided by naming the subclass constant `RateLimitError.CODE` while the instance `.code` is `'RATE_LIMITED'` via `super(...)`. `parseRetryAfter` handles delta-seconds AND HTTP-date with a sane positive-only fallback. The `status === 429` branch sits BEFORE the generic `status >= 400 && status < 500` branch in BOTH `request` (line 514 < 521) and `streamRequest` (line 711 < 717), and throws immediately — NO auto-retry (and `retries` only ever applies to network/5xx anyway).
- **Throttle (NOT the 401 latch)** — `AuthContext` listens for `ecliptrix:rate-limited` and uses a TIME-WINDOW throttle: `windowMs = max(retryAfter*1000, 3000)`, suppresses only within the window, then updates `lastRateLimitWarnAt`. A later 429 (past the window) fires again — explicitly NOT the permanent `sessionExpiryHandled` latch. `{seconds}` placeholder replaced correctly; toast duration `max(retryAfter*1000, 4000)`. `useEffect` deps `[notification, t]` re-bind on locale change.
- **Menu wiring** — consistent across the three required edits: `SettingsMenuItem` union has `'apiSecurity'`; `menuItems` has the `apiSecurity` entry (`id/label/description/icon`, i18n-driven); `AdminSettingsPage` imports `RateLimitSettings` and has `case 'apiSecurity': return <RateLimitSettings />`. Panel-level gating inherited from the `canManageUsers` entry point; backend `require_admin` is the real guard (spec §2.1).
- **i18n parity** — all 31 new keys appear EXACTLY 3× each (93 total) = type interface + EN + ZH. `tsc` enforces EN/ZH satisfy the `Translations` type, so parity is structurally guaranteed. Spot-checked content: EN/ZH genuinely localized (not stubs); `rateLimited` has `{seconds}` in both; `rlDisabledHint`="限流已停用", `rlSaveSuccess`="已保存,数秒内生效" match spec copy.
- **Primitives** — `NumberField {label,value,onChange,min?,max?,step?}` (auto-clamps to min/max on blur → prevents most out-of-range PUTs client-side), `SwitchField {label,checked,onChange}`, `SettingsSectionCard {title,description?,children}` — all match the component's usage; no broken prop contracts.

## Correctness notes (load-bearing edges)
- **Disabled-state UX** — `enabled=false` greys the limit inputs (`opacity-50 pointer-events-none select-none` + `aria-disabled`) with the "限流已停用" hint, while keeping `enabled` and `window_seconds` editable so the admin can re-enable. Current values stay visible (spec §4).
- **Status best-effort** — `loadStatus` swallows errors so `/status` flakiness never breaks the editable form; manual Refresh + post-save/reset reload (no background polling). Spec-compliant (read-only panel).
- **Save/Reset** — full-set PUT on save (a valid subset = the whole set; backend validates each + echoes effective config). 422/403/ApiError → friendly error toast, form keeps the user's values. Spec acceptance pts 1–5 all reachable.
- **Verified the AuthContext stray-backslash worry was a Grep-rendering artifact** — line 276 in the actual file is a clean `// by TIME WINDOW` comment, not a syntax error. The `tsc`-clean claim holds.

## Issues & Risks (none blocking)
- **X-RateLimit-* also dropped by the proxy** — same root cause as the Retry-After gap I fixed. These are debug-only headers the FE doesn't consume for UX, so no fix needed; flagging for awareness. If a future feature wants them client-side, the proxy's buffered branch would need a small response-header allowlist (it already has `responseHeaderAllowlist` for the streaming branch).
- **Static countdown** (no live tick-down) — matches spec ("含倒计时秒数", a static N). Acceptable.
- **ESLint not runnable in the dev env** (`next lint` broken module, pre-existing; ESLint errors are ignored in prod builds per CLAUDE.md). Type-check was clean. A healthy-env `npm run lint` is a nice-to-have for the Tester, not a blocker.

## Context for Downstream (Tester focus)
1. **Admin happy path**: AdminSettings → "接口安全 / 限流" (`apiSecurity`) → form loads current config with meta-driven min/max → edit a limit → Save → "已保存,数秒内生效" toast → re-fetch reflects PUT echo.
2. **Reset**: Reset → "已重置为默认" → values return to `RATE_LIMIT_DEFAULTS`.
3. **Toggle-off**: flip `enabled` → limit inputs grey + "限流已停用" → Save → `/status` shows enabled Off.
4. **Non-admin**: reaching the panel or curling `/api/rate-limit/*` → backend 403 (`ForbiddenError`); panel entry normally hidden by the entry-point gate but backend is the real guard.
5. **429 behaviour**: drive an endpoint past its limit (e.g. lower `ai_generation_per_min` then hammer an AI route) → exactly ONE warning toast "请求过于频繁,请 N 秒后重试" with N from `Retry-After` — AND, importantly, verify the countdown is correct when the 429 arrives **through a proxy route** (this is what my fix repairs: N should reflect `error_details.retry_after`, not always 5). NO auto-retry; a burst → one toast (time-window throttle); a later 429 → toasts again (not latched). Check both `http.*` (request) and `http.stream` (streamRequest) paths.
6. **i18n**: EN/ZH switch → all rate-limit labels/toasts localized; type-check guarantees parity.
7. After this fix, a quick `npm run type-check` (with `.next/types` cleared) to confirm the edited `makeRateLimitError` compiles.

## Excellence note
Strong contract discipline: the form is a pure projection of the backend `GET /config` envelope (flat keys + meta-driven bounds, no client-side range duplication), the 429 path correctly distinguishes a transient (time-window throttle) from a terminal (401 permanent latch) condition — exactly the trap spec §2.3 warned about — and the `RateLimitError.CODE`-vs-`code` resolution shows real TS-soundness awareness (TS2417). The one gap (proxied Retry-After) was a non-obvious cross-layer interaction between this task and the pre-existing proxy buffering; fixed in-review without disturbing the header-first design.
