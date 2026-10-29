# Packaged startup path — audit for unbounded awaits / silent stalls

> **Status update (2026-10-29 evening).** Body kept verbatim as the historical
> record; what the day disproved carries an inline
> `> CORRECTION (2026-10-29):` line. `root-cause.md` is authoritative where the
> two disagree. The line numbers below were re-checked and still match the
> current tree.
>
> Now verified, no longer UNVERIFIED: §7's first bullet — "does the `proxyProbe`
> fix actually bound `resolveProxy` in a *packaged* build?" — is answered **yes**.
> Two independent packaged launches log
> `resolveProxy did not answer within 2500ms — continuing without a system proxy`
> and, in the same millisecond, `agent-browser-host ready (cdp=…)`, then
> `backend healthy`, then `frontend healthy`
> (`.agentmesh/cover-finalization-runtime/ecliptrix-smoke-V9Bf1c/logs/process.log:1-9`
> and `…-AInRuT/logs/process.log:1-9`). Row 16 is therefore verified in the
> package; so is row 14 (`'error'` recording, `processManager.js:73,94-102` — a
> spawn that cannot start now fails in ~1.5 s instead of at the 20 s deadline).
> `release/win-unpacked` is no longer stale either (rebuilt 2026-10-29 04:57), so
> §7's last bullet is superseded: that tree is now the evidence, not a suspect.
>
> Budgets that now have measurements instead of "no measurement in the repo":
> backend cold start 15.2 s and 12.2 s, frontend 1.5 s and 1.4 s, against the
> 120 s / 60 s limits (§2's last row, §7's fourth bullet). Both fit comfortably,
> so S5 stays a *contract* defect rather than an observed failure.
>
> Still open today, re-read against the current source — **S1-S10, none fixed**:
> **S1** `processManager.js:140-153` still `await exited` on :153 with no deadline
> on the Windows branch (`graceMs` still unused there). **S2** `index.js:165`
> still awaits `startResearchBrowserHost()` with no aggregate deadline;
> `root-cause.md` §8 records that layer as deliberately not implemented. **S3**
> `index.js:200` still `showMessageBoxSync` before any service starts. **S4**
> there is still no `startupComplete` flag anywhere in `desktop/` (grep). **S5**
> `smoke-test.js:22` is still 120 s against an app worst case of ~202.5 s.
> **S6** `logger.js:170` still opens `createWriteStream` with no `'error'`
> listener. **S7** still `initUserData` (`index.js:112`) before the `Logger`
> (`:122`), so a first-launch failure still leaves no log file. **S8**
> (`waitHealthy` silent polls), **S9** (`config.js:44` bare `catch {}`) and
> **S10** (`index.js:250`, `:368` `.catch(() => {})`) unchanged.
>
> Still UNVERIFIED, deliberately: that a Windows tree-kill can leave a child
> without an `'exit'` event (S1's trigger frequency — the missing deadline is a
> code fact, the frequency is unmeasured); and that S6 has actually crashed a
> packaged launch (reasoned from Node stream semantics, not reproduced).
>
> §6 is the one part promoted to reference material (`root-cause.md` §10.3); the
> packaged process logs now show its lines 1-14 in exactly the order it predicts.

Scope: the code that runs between `app.whenReady()` and
`createMainWindow()` in the packaged app — `desktop/main/index.js`,
`processManager.js`, `backendService.js`, `frontendService.js`, `ports.js`,
`config.js`, `envCheck.js`, `window.js`, `logger.js`, `proxyProbe.js` — plus
the part of `desktop/scripts/smoke-test.js` that decides "healthy within 120s".

Method: read-only. Files were read in full at working-tree state
`6fc956ea` + uncommitted changes (index.js / processManager.js / proxyProbe.js
are the parallel agent's in-flight work; `index.js` was re-read after
`proxyProbe.js` appeared). No build, no packaged launch, no smoke run. The one
runtime artefact quoted is the existing
`desktop/cache/build-logs/app-probe-userdata/logs/process.log` and
`desktop/cache/build-logs/proxy-probe-result.txt`.

Why this document exists: the last two startup bugs (`cwd` inside `app.asar`,
`resolveProxy` never calling back) were both "awaited something that may never
settle". They were found one 40-minute packaging cycle apart. This is the full
inventory of that defect class on the startup path so the next one is found by
reading, not by rebuilding.

---

## 0. Class definitions used below

| Class | Meaning |
|---|---|
| (a) | Bounded — timeout, abort, deadline or finite retry. Cannot stall. |
| (b) | Unbounded but safe — no deadline, yet it cannot reasonably stall (local sync IO, loopback bind, event-driven). |
| (c) | **UNBOUNDED AND CAN STALL** — startup can block forever with no diagnostic. |

---

## 1. Every await / callback on the startup path

Execution order, `main()` (index.js:109) → `createMainWindow` (index.js:167).
"Stall" = what would have to happen for that line to never settle.

| # | file:line | Await / callback | Class | What stalls it | Smallest correct fix |
|---|---|---|---|---|---|
| 1 | index.js:111 | `initUserData()` (sync) | (b) | Redirected/OneDrive `%APPDATA%` makes `copyFileSync`/`writeFileSync` slow; throws rather than hangs | none (bounded by OS); move logger creation earlier (D8) |
| 2 | index.js:147 | `backfillUserEnv()` (sync) | (b) | unreadable `.env` throws (EACCES) | log the throw, don't let it reach the message-box-only path |
| 3 | index.js:153 | `loadUserEnv()` (sync) | (b) | same | same |
| 4 | index.js:126 | `fs.existsSync(APP_ICON_PATH)` | (b) | synchronous stat | none |
| 5 | index.js:164 | `await resolvePorts()` | (a) | inherits rows 6–9 | none |
| 6 | index.js:181 | `await pickPort(config.backendPort)` | (b) | ≤20 loopback binds (ports.js:21-30); each settles on `error` or `listen` | none |
| 7 | index.js:182 | `await pickPort(config.frontendPort)` | (b) | same | none |
| 8 | index.js:184 | `await pickPort(frontendPick.port + 1)` | (b) | same, conditional | none |
| 9 | ports.js:25 | `await isPortFree(candidate)` | (b) | `net` bind on `127.0.0.1`; both paths resolve (ports.js:9-12) | none |
| 10 | index.js:165 | `await startResearchBrowserHost()` | **(c)** | *structural*: an optional-capability block awaited serially with no aggregate deadline — any future unbounded call inside it (this is exactly what row 12 was) blocks required startup | `Promise.race([startResearchBrowserHost(), sleep(BUDGET).then(warn)])` (D2) |
| 11 | index.js:227 | `await ensureResearchBrowserPorts()` | (b) | two `pickPort` calls (rows 13-14) | none |
| 12 | index.js:270 | `await pickPort(9222)` | (b) | loopback bind | none |
| 13 | index.js:272 | `await pickPort(9333)` | (b) | loopback bind | none |
| 14 | index.js:230 | `await state.browserHost.waitHealthy()` | (a) | 20 s deadline (index.js:307) + spawn-`error` rejection (processManager.js:94-113) | none |
| 15 | index.js:238 | `await buildResearchBrowserEnv(ports)` | **(c)** | only via row 16; no bound of its own | fold into the row-10 race |
| 16 | index.js:327 | `await resolveSystemProxyUrl()` | (a) | **fixed today**: 2.5 s deadline (proxyProbe.js:17,90-127). Before the fix this was the incident | keep the deadline; never `await resolveProxy` bare again |
| 17 | index.js:250 | `await state.browserHost.stop().catch(() => {})` | **(c)** | `stop()` → processManager.js:153 `await exited` with no timeout (row 20) | same fix as row 20 + log instead of `.catch(()=>{})` |
| 18 | index.js:166 | `await startServices()` | (a) | composed of rows 19-23; worst case 202.5 s, not infinite | see D5 |
| 19 | index.js:390 | `await tagServiceError('后端…', waitHealthy)` | (a) | 120 s (backendService.js:83) | none |
| 20 | index.js:411 | `await fn()` inside `tagServiceError` | (a) | passthrough of rows 19/22 | none |
| 21 | index.js:404 | `await tagServiceError('界面…', waitHealthy)` | (a) | 60 s (frontendService.js:32) | none |
| 22 | processManager.js:121 | `await httpOk(healthUrl)` | (a) | 3 s socket timeout, resolves `false` on error/timeout (processManager.js:27-39) | none |
| 23 | processManager.js:125 | `await sleep(1000)` | (a) | fixed timer | none |
| 24 | index.js:171 | `await stopChildren()` (failure path, before the error page) | **(c)** | via row 26 — a hung stop means no error window, only the splash | same fix as row 26 |
| 25 | index.js:539 | `await Promise.all(children.map(stop))` | **(c)** | via row 26 | same |
| 26 | processManager.js:153 | `await exited` (`new Promise` at :138) | **(c)** | **Windows only**: `stop()` tree-kills and then waits for `'exit'` forever. There is no post-kill deadline on this branch (:140-144); the non-Windows branch has one (:147). If `taskkill` fails (access denied, AV lock, process already a zombie) `'exit'` never fires | `await Promise.race([exited, sleep(graceMs)])` → log "no exit after tree-kill" (D1) |
| 27 | processManager.js:147 | `await Promise.race([exited, sleep])` | (a) | non-Windows only | port it to the Windows branch |
| 28 | index.js:93 | `stopChildren().finally(...)` in `before-quit` | **(c)** | via row 26; a hung stop also makes the app unquittable | same fix as row 26 |

Non-await blocking calls on the same path (same class, same symptom):

| # | file:line | Call | Class | Why it blocks startup | Fix |
|---|---|---|---|---|---|
| 29 | index.js:200 | `dialog.showMessageBoxSync` (port fallback) | **(c)** | blocks the main process until a human clicks; in an unattended/smoke launch = forever, before any service is spawned | show it after the window exists (D3) |
| 30 | index.js:501 | `dialog.showMessageBoxSync` (unexpected exit) | **(c)** | can fire *during* startup (backend dies while `waitHealthy` polls); blocking the loop freezes the health deadline and the app shows two competing errors | gate on a `startupComplete` flag (D4) |
| 31 | window.js:24 | `splash.loadFile(...)` (not awaited) | (b) | fire-and-forget | none |
| 32 | window.js:31-33 | `executeJavaScript(...).catch(()=>{})` | (b) | swallowed; text just stops updating | log at DEBUG |
| 33 | window.js:165 | `win.loadURL(url)` (not awaited) | (b) | failure surfaces via `did-fail-load`, which only dev mode listens to | acceptable |
| 34 | processManager.js:62 | `spawn(...)` | (b) | throws synchronously only on bad args; ENOENT/EACCES are async and now recorded (:94) | none |

**Count:** 7 rows classified (c) — 10, 15, 17, 24, 25, 26, 28 — but they
collapse to **two distinct root causes**: (i) `processManager.js:153` has no
post-kill deadline on Windows, and every stop call site inherits it (17, 24,
25, 28); (ii) the optional-capability block at index.js:165 has no aggregate
deadline, so it will keep producing new (c) rows (10, 15 — row 12/16 was the
last one). Add the two human-gated sync dialogs (29, 30) and the honest figure
is **2 unbounded awaits + 2 unbounded blocking calls = 4 defects**, not 7
independent ones.

---

## 2. ManagedService / backend / frontend — can they hang instead of reject?

| Question | Answer | Evidence |
|---|---|---|
| Can `waitHealthy()` hang forever? | **No.** Fixed `deadline` computed once, loop exits and rejects. Overrun is bounded by one `httpOk` (3 s) + `sleep` (1 s), i.e. it can reject up to ~4 s late, never hang | processManager.js:116-130 |
| Can it hang when the child never started? | No — `recordSpawnError` stores the error and `assertChildRunning()` throws it on the next iteration | processManager.js:94-113, 105-113 |
| Can it hang when the child exited without a spawn error? | No — `'exit'` nulls `this.child` (:75) and `assertChildRunning` throws `exited before becoming healthy` (:110-112) | same |
| Can `httpOk` hang? | No — `timeout` handler destroys and resolves `false`; `'error'` resolves `false` | processManager.js:27-39 |
| Can `start()` hang? | No — synchronous `spawn`, errors arrive as events | processManager.js:55-85 |
| Can `stop()` hang? | **YES on Windows** — `await exited` after `killTree` has no deadline; `graceMs` is accepted but unused on that branch. Elsewhere (`:147`) it is raced. | processManager.js:132-156 |
| Can `stop()` hang on a child that already exited? | No — `'exit'` already nulled `this.child`, so `stop()` returns at `:134` | processManager.js:74-75, 134 |
| Can the backend descriptor itself stall? | No — pure object construction; `cwd: userDataPath` exists (created by `initUserData`, config.js:29-31) | backendService.js:26-85 |
| Can the frontend descriptor itself stall? | No — pure object construction; `cwd` = `resources/frontend` | frontendService.js:13-34 |
| Is 120 s/60 s enough for a cold packaged start? | **UNVERIFIED** — the only measured figure in the repo is 60–70 s for the backend (`smoke-test.js:18-20`). The frontend 60 s has no measurement in the code I read. | — |

Conclusion: the *supervisors* are bounded; only `stop()` is not. A service
that genuinely hangs at startup is reported as a timeout (a bounded rejection
→ the error page), which is the correct behaviour.

> CORRECTION (2026-10-29): the last row above is no longer UNVERIFIED. Two
> packaged launches measured backend cold start at 15.2 s and 12.2 s and
> frontend readiness at 1.5 s and 1.4 s
> (`.agentmesh/cover-finalization-runtime/ecliptrix-smoke-{V9Bf1c,AInRuT}/logs/process.log:6-9`),
> i.e. both well inside 120 s / 60 s. The "only `stop()` is unbounded"
> conclusion still stands (S1).

---

## 3. Ordering: can an optional capability block REQUIRED startup?

Current sequence (index.js:163-167):

```
resolvePorts()                // required
startResearchBrowserHost()    // OPTIONAL: ports + spawn + 20 s health
                              //           + 2.5 s proxy probe
startServices()               // REQUIRED: backend → frontend
createMainWindow(url)
```

Every optional thing that runs before `createMainWindow`, and whether it can
block it:

| Optional capability | Where | Blocks required startup? | Assessment |
|---|---|---|---|
| Browser-host port pick | index.js:270,272 | yes, bounded | must stay serial: the backend is spawned with these ports baked into env, so they must be decided first (index.js:384-386 → backendService.js:51) |
| Browser-host readiness | index.js:230 | yes, 20 s, bounded | serial by design — `researchBrowserEnv` is injected at backend spawn time. The bound *is* the isolation |
| System-proxy probe | index.js:238 → 327 | yes, 2.5 s, bounded today | this is the incident. It only ever sets `WEB_RESEARCH_SYSTEM_PROXY`; a miss must degrade to DIRECT |
| Browser-host **failure** | index.js:244-254 | no | correctly isolated: caught, warned, `researchBrowserEnv = null`, startup continues. Confirmed in the field: `app-probe-userdata/logs/process.log:1-3` shows the host timing out and the app continuing to the proxy probe |
| Icon | index.js:126 | no | `existsSync` only; the real load happens inside `BrowserWindow` |
| Config read (`desktop-config.json`) | config.js:41-49 | no | sync; a corrupt file silently resets ports (D10) → which triggers row 29's modal |
| `.env` read / heal | index.js:147-153 | no | sync; a throw here leaves the app dead with a message box and no log file (D8) |
| LLM probe | — | **not on this path** | `desktop/main` has no LLM probe (grep of `desktop/main` for `llm` matches only `envCheck.js:9,11`). Capability/LLM status is requested by the renderer/backend after the window opens. UNVERIFIED beyond the grep |
| Window bounds / screen | window.js:93 | required, sync | safe |

**Defect:** the *only* thing keeping optional work from blocking required work
is that each individual call inside `startResearchBrowserHost()` happens to be
bounded. There is no structural guarantee. That is exactly how the
`resolveProxy` bug became a total startup failure: the block was bounded in
principle, unbounded in fact.

**Correct ordering / isolation (minimal):**

1. Keep `resolvePorts()` first (required; the backend needs the ports).
2. Wrap the optional block in one aggregate deadline (D2):

   ```js
   // The browser host is a capability, never a startup dependency: a block
   // that overruns its budget must degrade, not delay the backend forever.
   await Promise.race([
     startResearchBrowserHost(),
     sleep(RESEARCH_BROWSER_BUDGET_MS).then(() => state.logger.warn(
       'process', 'research capability budget exceeded — continuing degraded')),
   ])
   ```

3. Then backend → frontend → window, unchanged.
4. If a future refactor lets the backend start *without* the browser env, the
   optional block can move fully off the critical path (fire-and-forget +
   backend capability re-probe). Not needed for the one-line fix.

---

## 4. Silent-swallow risks on this path

| file:line | Swallow | Consequence | Fix |
|---|---|---|---|
| index.js:250 | `stop().catch(() => {})` | a failing *and* a hanging stop both disappear; the hang also blocks `startServices()` | log it (as `:541` already does) and bound the stop |
| index.js:368 | `stop().catch(() => {})` (host restart) | same, plus it is inside the crash-restart path | same |
| index.js:103-105 | `.catch` → `showErrorBox` + `app.exit(1)` | the *first* failures (initUserData, logger construction, `.env`) reach the user as a message box and **nothing is written to any log file** — the user has no `error.log` to send | construct the logger before `initUserData` (D8) |
| config.js:44 | `catch { }` corrupt `desktop-config.json` | silently resets ports/bounds → next launch may show the port modal or centre the window; no trace anywhere (logger does not exist yet) | return warnings and log them after `:122` (D10) |
| logger.js:58-68 | failed `mkdirSync` → `process.stderr.write` | packaged GUI has no console → the app runs with **no logs at all**, and the very next write hits D7 | record the failure and retry once at a fallback path |
| window.js:31-33 | `executeJavaScript(...).catch(() => {})` | splash text silently freezes at "正在准备本地服务…" | DEBUG log |
| index.js:479 | `wc.loadFile(waitingPage).catch(() => {})` | dev-only blank window on a broken asset | acceptable |
| logger.js:163-171 | `fs.createWriteStream` has **no `'error'` listener** | an asynchronous `open` failure (EBUSY from AV / ENOSPC) emits an unhandled `'error'` → uncaught exception → main process dies with no error page. This is a crash, not a hang, but it is on the startup path and it is silent | `entry.stream.on('error', ...)` → drop the stream, breadcrumb to stderr (D7) |
| index.js:311 | `onUnexpectedExit: () => restartResearchBrowserHost()` — returned promise ignored | restart rejects only if `startResearchBrowserHost` throws, which it does not (self-catching) | acceptable, worth a `.catch` for safety |

Awaits whose rejection is nobody's business but which still gate the window:
`index.js:171` (`stopChildren()` before the error page) — a rejection there is
swallowed per-child at `:541`, but a *hang* there is what hides the error page
from the user. That is row 26/24 again.

---

## 5. Confirmed additional defects (new, not the two already fixed)

Numbering continues the diagnosis folder's D-series used by
`pipeline-audit.md`; prefixed `S` to avoid collision.

| # | Severity | Where | Defect | One-line fix |
|---|---|---|---|---|
| S1 | **HIGH** | processManager.js:132-156 | `stop()` waits for `'exit'` with **no deadline on Windows** (`graceMs` unused at :140-144). Reached from startup-failure cleanup (index.js:171), the browser-host catch (:250), host restart (:368) and `before-quit` (:93). A tree-kill that produces no `'exit'` = splash forever, no error page, unquittable app | replace `await exited` (:153) with `await Promise.race([exited, sleep(graceMs)])` and warn on the timeout |
| S2 | **HIGH** | index.js:165 | optional-capability block awaited serially before required services with **no aggregate deadline** — the structural cause of the `resolveProxy` incident (index.js:327 was row 16) | race the whole block against a documented budget (see §3) |
| S3 | MEDIUM | index.js:200 | `dialog.showMessageBoxSync` (port fallback) blocks startup until a human clicks, *before* any service starts; a smoke/probe launch would sit at the splash for the full 120 s and fail with "services not healthy" | move the notification to after `createMainWindow` (`did-finish-load`) |
| S4 | MEDIUM | index.js:498-515 | `handleUnexpectedExit` runs during startup too: the backend dying inside `waitHealthy` opens a modal that freezes the main loop (and thus the health deadline), then `waitHealthy` throws and the startup catch opens a **second** window | `if (!state.startupComplete) return state.logger.error(...)`; set `state.startupComplete = true` right after `createMainWindow` |
| S5 | MEDIUM | smoke-test.js:18-21 vs index.js:307 + backendService.js:83 + frontendService.js:32 | the gate's budget (120 s) is **below the app's own worst case** (20 + 120 + 60 + 2.5 = 202.5 s), so a legitimately slow cold start fails the gate with the same message as a hang | raise `STARTUP_TIMEOUT_MS` to ≥ 210 000, or lower the backend's 120 s — and keep the existing "must stay ≥ …" comment true |
| S6 | MEDIUM | logger.js:163-171 | `fs.createWriteStream` without an `'error'` listener → unhandled `'error'` kills the main process (AV/ENOSPC) | attach `entry.stream.on('error', …)` |
| S7 | LOW | index.js:100-116 | any failure before index.js:122 (logger construction) produces a message box and **no log file**; `initUserData`/`loadUserEnv` are exactly where a bad install fails first | create the `Logger` immediately after `state.userDataPath` is known |
| S8 | LOW | processManager.js:116-130 | `waitHealthy` logs nothing between "starting …" (:61) and the final healthy/timeout line — 120 s of silence is indistinguishable from a hang, which is the stated pain in this whole diagnosis | log the first failed poll and every ~10 s at INFO, or one DEBUG per attempt |
| S9 | LOW | config.js:41-47 | a corrupt `desktop-config.json` is reset silently (`catch { }`) and then surfaces as S3's modal | return a warnings array; log after the logger exists |
| S10 | LOW | index.js:250, 368 | `.catch(() => {})` around `stop()` — silent, unlike :541 | log them |

Non-defect worth recording: the browser host's failure path is genuinely
isolated (index.js:244-254 catches, warns, nulls the env, continues). Field
evidence that the isolation works:
`desktop/cache/build-logs/app-probe-userdata/logs/process.log:1-3`
(host times out at 20 s, "stopping…", and the app carried on).

---

## 6. Packaged startup checklist (derived from the code)

What a healthy packaged launch must print, in order. Every line is emitted by
code cited on the right; nothing here is taken from the smoke test's
assertions. **The last line printed tells you which stage stalled.**

| # | Log line (exact text) | Category / file | Emitted by |
|---|---|---|---|
| 1 | `Ecliptrix <ver> starting (userData=<path>)` | main.log | index.js:123 |
| 2 | *(warn, only if broken)* `App icon missing at <path>` | main.log / error.log | index.js:126 |
| 3 | *(only if healed)* `self-healed N placeholder credential(s) from bundled template: …` | config.log | index.js:149 |
| 4 | *(only if incomplete)* `config incomplete (LLM_API_KEY, …) — starting anyway; in-app setup guide will prompt` | config.log / error.log | index.js:156 |
| 5 | *(only if a port moved)* `port fallback: frontend=A backend=B (configured C/D)` | config.log | index.js:191 |
| 6 | `starting agent-browser-host: <exe> --agent-browser-host --cdp-port=P --control-port=Q` | process.log | processManager.js:61 |
| 7 | `agent-browser-host healthy at http://127.0.0.1:P/json/version` | process.log | processManager.js:122 |
| 8 | `agent-browser-host healthy — resolving research browser env` | process.log | index.js:234-237 |
| 9 | `system proxy for research: <url>` **or** `resolveProxy did not answer within 2500ms — continuing without a system proxy` | process.log | index.js:349 / proxyProbe.js:41-45 |
| 10 | `agent-browser-host ready (cdp=http://127.0.0.1:P)` **or** `agent-browser-host unavailable — browser capability degraded: …` (non-fatal) | process.log | index.js:240-243 / 245-248 |
| 11 | `starting backend: <…>/python/python.exe -B -X utf8 <…>/backend/run.py` | process.log | processManager.js:61 |
| 12 | `backend healthy at http://127.0.0.1:B/api/health` | process.log | processManager.js:122 |
| 13 | `starting frontend: <exe> <…>/frontend/server.js` | process.log | processManager.js:61 |
| 14 | `frontend healthy at http://127.0.0.1:F/` | process.log | processManager.js:122 |
| 15 | `main window created (bounds={…})` | main.log | index.js:432 |
| 16 | `main window shown (bounds={…})` | main.log | index.js:434 |
| 17 | `main window finished load (http://127.0.0.1:F)` | main.log | index.js:445 |

Triage table — "last line I see → what is stuck":

| Last line | Stalled stage | Where to look next |
|---|---|---|
| 1–4 and nothing else | `resolvePorts()` (index.js:164) — no log line exists for a successful pick, so silence here is ambiguous | `desktop-config.json` ports; add a `ports resolved` line |
| 6, no 7 | host spawn / 20 s health — check for `failed to spawn (code=…)` in error.log (processManager.js:96-101) | `agent-browser-host.log` |
| 7, no 8/10 | the system-proxy probe (index.js:327). **Expected ceiling 2.5 s**; still stuck after that = a regression of proxyProbe | `proxyProbe.js` deadline |
| 10 absent, 11 present | nothing wrong — host degraded, startup continued by design | — |
| 11, no 12 | backend cold start (up to 120 s). Genuinely stuck only if > 120 s | `backend.log`, `error.log` |
| 12, no 13/14 | frontend spawn / 60 s health | `frontend.log` |
| 14, no 15 | between `startServices()` returning and `createMainWindow` — should be instantaneous; a stall here means a blocking dialog (S3/S4) | look for a modal on screen |
| 15, no 17 | renderer load failure (`did-fail-load` is not logged in packaged mode — window.js:165) | add a `did-fail-load` log line |

Two gaps in the current log stream, both worth one line each: no
`ports resolved frontend=A backend=B` (stage between 1 and 6, index.js:186-188)
and no `did-fail-load` handler in the packaged path (`watchDevFrontend` is
dev-only, index.js:464-489).

---

## 7. Verified vs unverified

Verified by reading current code: every file:line above; the (c)
classification of processManager.js:153 (the Windows branch simply has no
deadline — code fact); 120 s/60 s/20 s/2.5 s/3 s bounds; the absence of an
LLM probe and of a `startupComplete` flag in `desktop/main` (grep); the
absence of a stream `'error'` listener in `logger.js` (grep).

UNVERIFIED (do not quote as evidence):

- That the `proxyProbe` fix actually bounds `resolveProxy` in a *packaged*
  build. Only the pre-fix probe record exists
  (`desktop/cache/build-logs/proxy-probe-result.txt:3`,
  "callback DID NOT fire within 20s"). Requires the parallel agent's rebuild.
- That a Windows tree-kill can leave a child without an `'exit'` event. The
  *missing deadline* is a code fact; the frequency of the trigger is not
  measured.
- That `logger.js:170`'s missing `'error'` listener has actually crashed a
  packaged launch. Reasoned from Node stream semantics, not reproduced.
- Whether the frontend reaches `/` 200 within its 60 s budget on a cold
  packaged start — no measurement anywhere in the repo.
- Anything about `desktop/release/` artefacts: the existing `win-unpacked` is
  stale (`release-manifest-audit.md:336-338`) and was not used.

> CORRECTION (2026-10-29): three of the five bullets above are now settled
> (1, 4, 5) and the last one is inverted.
>
> - Bullet 1 is **verified**: the packaged app logs the 2500 ms WARN followed by
>   `agent-browser-host ready`, backend and frontend healthy
>   (`…/ecliptrix-smoke-V9Bf1c/logs/process.log:1-9`,
>   `…/ecliptrix-smoke-AInRuT/logs/process.log:1-9`), and `app.asar` contains
>   `main/proxyProbe.js` (34 entries, checked with
>   `desktop/cache/build-logs/gate-asar-check.js`).
> - Bullet 4 is **answered** by measurement: frontend ready in 1.5 s / 1.4 s,
>   backend in 15.2 s / 12.2 s.
> - Bullet 5 is **superseded**: `release/win-unpacked` was rebuilt from the
>   fixed tree on 2026-10-29 04:57 and *is* the source of the evidence above.
> - Bullets 2 and 3 stay UNVERIFIED (tree-kill without `'exit'`; S6 actually
>   crashing a launch).

## 8. Assumptions

- `index.js` in the working tree (with `proxyProbe.js` already extracted) is
  the code under audit; the (c) classification of index.js:238/327 therefore
  reflects the *fixed* state, and the pre-fix state is named only to explain
  where the class came from.
- `smoke-test.js`'s 120 s gate is the contract the packaged app must meet;
  S5 assumes that contract stands rather than that the app is wrong.
