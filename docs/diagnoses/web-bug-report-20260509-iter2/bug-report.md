# Web Bug Report — Iter2 (2026-05-09)

> Round 2 of the loop "网页Bug探索与修复完整流程". Round 1 already covered the Video Cover modal — this round explores the rest of the platform: login, AI chat, workflow editor, projects view, admin (TTS settings), and the in-editor video-search modal.
>
> All bugs were reproduced in **Microsoft Edge (Chromium)** against the dev server at `http://192.168.1.123:3010/`, logged in as `admin / admin`.

## Environment

| Field | Value |
|------|------|
| URL | `http://192.168.1.123:3010/` (dev server, host `kt-NF5568M4`) |
| Browser | Microsoft Edge (msedge) — playwright-cli persistent profile |
| Backend | uvicorn :8000 (proxied) |
| Account | `admin` (role: 管理员) |
| Test session | `ws-iter2-20260509-172520-28984` |
| Screenshots | `.web-debugger/screenshots/` |
| Console / network logs | `.web-debugger/logs/` |
| Source console snippet | `.web-debugger/logs/console-baseline.log` |

---

## Bug List (Severity Ranked)

| # | Title | Severity | Priority | Area |
|---|-------|----------|----------|------|
| 1 | Wrong-credentials login surfaces "Session expired" + "Network error" instead of "Invalid credentials" | Critical | P0 | Auth / Login UX |
| 2 | Workflow execution log renders error details as `{ "error": {} }` (Error object lost) | High | P1 | Workflow editor |
| 3 | TTS Settings accepts out-of-range values (e.g. `99999` for max=200) and persists them | High | P1 | Admin / Settings |
| 4 | Verbose `[LOG]` chatter floods the production console (perf + DX noise) | Medium | P2 | Logging hygiene |
| 5 | Project card uses nested `<button>` inside `<button>` (invalid HTML, a11y broken) | Medium | P2 | Projects list / a11y |
| 6 | Login modal hint reveals `admin / *` even in production builds | Medium | P2 | Security / DX |
| 7 | Login `<input type="password">` is not wrapped in a `<form>` — Chromium password-manager warning | Low | P3 | Login form / a11y |

---

## Bug #1 — Wrong-credentials login is mis-reported as "Session expired" + "Network error" (Critical / P0)

**Location**: Login modal (homepage `Login / Register` button) and dedicated `/login` page
**Code path (likely)**: `[AuthContext] Login error: SessionExpiredError` → `LoginModal` shows `Network error` paragraph
**Evidence**: `.web-debugger/logs/console-baseline.log` (around iteration #2 entry), screenshot `chat-173012.png` shows post-login state for context

### Reproduction
1. Open `http://192.168.1.123:3010/`.
2. Click **Login / Register** in the top-right (or on a fresh tab go to `/login`).
3. Enter `admin` / `7#rA3310` (or any wrong password) and click **Login**.

### Expected
- Inline error: "Invalid username or password" (or equivalent zh).
- The user remains on the same login modal/page; no banner about "session expired" since the user has no session yet.

### Actual
- The page redirects to `/login?reason=session-expired`.
- A red banner appears: **"会话已过期，请重新登录 / Your session has expired. Please log in again."**
- An inline paragraph below the password field reads **"Network error"**.
- Console emits two separate errors:
  ```
  [ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized) @ /api/auth/login:0
  [ERROR] [AuthContext] Login error: SessionExpiredError: Session expired. Please log in again.
  ```
- Console warning shows the LoginModal accepted the error as a generic `error: 'Network error'`:
  ```
  [WARNING] [LoginModal] Login failed: {username: admin, error: Network error, …}
  ```

### Impact
- Users with wrong passwords are told their session expired (which can't have happened — they have no session yet) and that there is a network error (which is also untrue; the network call returned a healthy 401).
- This sends users hunting for connectivity issues / browser cache problems instead of just retyping the password. It also masks brute-force lockout signals.

### Likely root cause
- `AuthContext` maps any 401 from `/api/auth/login` to a generic `SessionExpiredError`.
- The `?reason=session-expired` redirect path is meant for 401s on *protected* routes (i.e. expired-token interceptor), but the same handler is firing for the **login** endpoint itself.
- Separately, the `LoginModal` falls back to "Network error" when it cannot read a typed error, so the same 401 produces two inconsistent messages.

---

## Bug #2 — Workflow execution log shows `{ "error": {} }` instead of the actual error message (High / P1)

**Location**: WorkFlow tab → open any workflow → **Workflow Interface** view → **Run** with no nodes (or any failing run)
**Screenshot**: `.web-debugger/screenshots/workflow-empty-run-173106.png`

### Reproduction
1. Log in as `admin`.
2. Click **WorkFlow** in the side rail.
3. Click any of the listed `New Workflow` cards (e.g. workflow-1776384707387).
4. Click the **Workflow Interface** toggle in the right panel.
5. With an empty canvas (Nodes: 0, Connections: 0), click **Run**.

### Expected
- The execution log entry's "details" line shows the real error text — e.g. `{ "error": "No Start node found in workflow" }` or simply the error message.

### Actual
The "Execution Logs" panel shows two entries:
1. `17:30:51.483  Workflow execution started`
2. `17:30:51.483  Workflow execution failed: No Start node found in workflow`
   - Below it, in the "details" section: **`{ "error": {} }`**

The message is correct on the line above, but the details payload is an empty object. The console clarifies the situation:
```
[LOG] [WorkflowExecutor] Log [error]: Workflow execution failed: No Start node found in workflow
      {error: Error: No Start node found in workflow at X.execute (...)}
```

### Impact
- For users debugging more complex workflows (where the error isn't echoed in the message), the details panel is the only chance to see the stack/cause — and it's always empty.
- Looks unfinished / broken.

### Likely root cause
`JSON.stringify(new Error(...))` returns `{}` because `Error`'s own properties (`message`, `stack`) are non-enumerable. The log renderer is stringifying the wrapped `{ error: <Error> }` object directly instead of pulling out `err.message` (and optionally `err.stack`).

---

## Bug #3 — TTS Settings allow out-of-range values to be saved (High / P1)

**Location**: 管理员设置 (Admin Settings) → **TTS 设置** → 资源限制 → **每批最大段数**
**Network evidence**: `[PUT] /api/system-settings/tts => [200] OK` accepted the bad payload

### Reproduction
1. Log in as `admin`.
2. Open **管理员设置** → **TTS 设置**.
3. Locate **每批最大段数** input. The HTML attribute is `max="200"`.
4. Type `99999` into the field. It is *not* clamped, and the field accepts it.
5. Click **保存**.

### Expected
Either (a) the input clamps to `[10, 200]` on blur/save, (b) the Save button is disabled while the value is out of range, or (c) the backend returns a 400/422 with a validation error.

### Actual
- The field keeps `99999`.
- The Save button is enabled.
- `PUT /api/system-settings/tts` returns **200 OK** — the backend silently accepts it.
- Other range-violating values (concurrency `0` with `min=1`, single-request timeout `-5` with `min=5`) were also accepted by the form (the spinbutton's HTML `min`/`max` are not enforced) and submitted to the backend.

### Impact
- A misconfigured `max_segments_per_batch=99999` will pass validation and may later cause OOM or timeouts when the TTS pipeline tries to enqueue 99999 segments at once.
- Other settings panels (Upload, Watermark Removal, Video Analysis) likely share the same pattern and need a sweep.

### Likely root cause
- The frontend reads `min`/`max` from a config schema but does not validate before allowing Save (or allowing the user to leave the field).
- The backend `PUT /api/system-settings/tts` writes the payload without re-validating the bounds. A pydantic/Field constraint is missing on the settings model.

---

## Bug #4 — Verbose `[LOG]` debug chatter in the production console (Medium / P2)

**Location**: Globally — any page with the chat interface or workflow interface mounted
**Console log**: `.web-debugger/logs/console-baseline.log` lines after `[Chat] Streaming complete`

### Reproduction
1. Log in.
2. Open the AI Chat tab.
3. Send any one-word message (e.g. "hi") and watch DevTools Console.

### Expected
A clean console with at most a couple of structured `info`-level lines. Streaming shouldn't log per-chunk.

### Actual
Sending one short message produces **30+ `[LOG]` entries**, including:
- Per-chunk: `[Chat] Streaming update - accumulated content length: 5 / 10 / 25 / 35`
- Per-chunk: `[MessageBubble] 流式消息更新 {messageId: …, contentLength: …}`
- Per-render: `[ChatInterface] Initializing/Restoring state: {…}` repeats once **per streaming chunk** (suggesting an effect dep array is too coarse and is re-running on every render)
- Mixed Chinese/English log strings (`流式消息更新` vs `Streaming update`)

The Workflow tab is similar — `[WorkflowInterface] Rendering interface`, `[WorkflowSidebar] Rendering sidebar`, `[WorkflowCanvas] Rendering canvas` log on every state change.

### Impact
- Production console is unreadable — drowns out genuine warnings/errors.
- Hot path during streaming (per-chunk `console.log`) measurably slows long responses on slower devices.
- The `[ChatInterface] Initializing/Restoring state` repeating during streaming hints at a useEffect dependency bug causing redundant work, not just noise.

### Suggested fix
- Gate all `[Chat] / [MessageBubble] / [WorkflowInterface]` logs behind `process.env.NODE_ENV !== 'production'` or behind a `debug` flag.
- Investigate the `[ChatInterface] Initializing/Restoring state` re-run during streaming (likely an effect deps issue).
- Standardize log strings to one language.

---

## Bug #5 — Project card has nested `<button>` inside `<button>` (Medium / P2 — a11y / valid-HTML)

**Location**: 视频编辑 (Video Editing) projects list — every project card
**Snapshot evidence**: ref tree shows
```
button "BugTest Project actions Last opened: 32m" [ref=e224]
  └── button "Project actions" [ref=e233]
        └── (when open) button "Rename" [ref=e1626]
        └── (when open) button "Delete"  [ref=e1627]
```

### Reproduction
1. Log in → Video Editing.
2. Inspect any project card in DevTools.

### Expected
- The card is clickable but is *not* a `<button>` containing nested buttons. Use a `<div role="button" tabIndex={0}>` for the card OR keep the card as a button and move "Project actions" outside (positioned absolutely via CSS) so it's a sibling, not a descendant.

### Actual
- The whole card is rendered as `<button>`. Nested inside is **another** `<button>` for the kebab menu, and (when the menu opens) two more buttons (`Rename`, `Delete`).
- HTML5 forbids interactive descendants inside a `<button>`. Browsers handle this by hoisting/breaking events; screen readers announce the entire card label as one giant button name (`"BugTest Project actions Rename Delete Last opened: 32m"`), as visible in the accessibility tree.

### Impact
- **Invalid HTML** — known to cause unpredictable click handling across browsers.
- **a11y**: assistive tech announces the whole concatenated label, then re-announces "Project actions" as its own button — confusing and noisy.
- Keyboard users tabbing through can land on buttons that the parent button's `onClick` will also fire for, causing accidental project navigation when they meant to open the menu.

### Suggested fix
Replace the outer `<button>` with `<div role="button" tabIndex={0} onKeyDown={…}>` (and an explicit Enter/Space handler). Keep the `Project actions` `<button>` as a *sibling* of the clickable area or stop the click bubble explicitly.

---

## Bug #6 — Login hint exposes `Test credentials: admin / *` in production-looking builds (Medium / P2)

**Location**: Login modal and `/login` page (both surfaces)

### Reproduction
1. Open `/login` (or click `Login / Register`).
2. Read the helper text under the form.

### Expected
- No "test credentials" hint on a deployed environment, OR a clearly-flagged dev-only banner.

### Actual
- Both surfaces show: **`Test credentials: admin / *`**.
- The asterisk hides the password but the *username* is leaked. Combined with the well-known bcrypt-default `admin` (the seeder uses `7#rA3310`) — and the fact that this dev server is reachable from the LAN at `http://192.168.1.123:3010` — this becomes a meaningful disclosure.

### Impact
- Tells any visitor that an `admin` account exists, narrowing brute-force search space.
- Looks unprofessional in screenshots / demos.

### Suggested fix
- Gate the hint behind `process.env.NEXT_PUBLIC_SHOW_DEV_HINTS === 'true'`, default false.
- Even in dev, do not reveal the actual username; print "ask the team" or omit.

---

## Bug #7 — Password input is not wrapped in a `<form>` (Low / P3)

**Location**: Login modal — `<input type="password" name="password" autocomplete="current-password">`
**Console warning**: emitted by Chromium itself
```
[VERBOSE] [DOM] Password field is not contained in a form: (More info: https://www.chromium.org/developers/design-documents/create-amazing-password-forms)
```

### Reproduction
1. Open the login modal in Edge.
2. Watch DevTools Console as the modal mounts.

### Expected
- The username + password inputs live inside a `<form onSubmit={...}>` so password managers can detect & autofill, and pressing Enter has a default submit semantics.

### Actual
- The two inputs sit inside `<div>`s with no enclosing `<form>`. Edge / Chrome flag this every render.

### Impact
- 1Password / Bitwarden / native browser autofill are unreliable.
- Pressing Enter without a focused submit button doesn't always submit.

### Suggested fix
Wrap the username + password fields in `<form onSubmit={handleLogin}>`; mark the submit button `type="submit"`. The aria-label / id wiring already exists, this is just a structural change.

---

## Quick verification commands

To reproduce all bugs in a fresh session:

```bash
# 1. Bug #1: trigger the wrong-credentials path
curl -i -X POST http://192.168.1.123:3010/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"WRONG"}'
# expect 401; observe how the SPA reacts

# 2. Bug #3: post out-of-range TTS settings directly
curl -X PUT http://192.168.1.123:3010/api/system-settings/tts \
  -H 'content-type: application/json' \
  -H 'cookie: <session cookie>' \
  -d '{"max_segments_per_batch": 99999}'
# expect 422; today returns 200
```

## Files referenced

- Console baseline: `.web-debugger/logs/console-baseline.log`
- Network log: `.web-debugger/logs/network-baseline.log`
- Auth state backup: `.web-debugger/states/auth-latest.json`
- Screenshots used as evidence:
  - `initial-20260509-172608.png` — homepage before login
  - `after-login-172732.png` — admin home after login
  - `editor-172836.png` — BugTest project workspace (context for nested-buttons bug)
  - `chat-173012.png` — AI Chat conversation (context for log-flood bug)
  - `workflow-173025.png` — Workflow editor pre-Run
  - `workflow-empty-run-173106.png` — Empty-workflow Run failure (Bug #2)
  - `admin-173337.png` — Admin Settings entry (Bug #3 context)
  - `search-results-173827.png` — Pexels results inside the editor

## Summary

7 distinct bugs were reproduced across login, workflow editor, admin settings, projects list, and global console hygiene — none of them overlap with the 8 Video-Cover bugs already shipped in commit `28d6ce8` from the previous round. **Bug #1 (login mis-reporting) is the most urgent**: it changes correctness of the auth flow that every user hits.
