# Desktop packaging pipeline — audit of the "wrong root" defect class

> **Status update (2026-10-29 evening).** The body below is kept verbatim as the
> historical record of what was believed at audit time; stale claims carry an
> inline `> CORRECTION (2026-10-29):` line instead of being rewritten. Where
> this document and `root-cause.md` disagree, `root-cause.md` is authoritative.
> Line numbers in the body are as of audit time; moved ones are given in their
> correction line.
>
> Fixed and verified since: the reported defect — item 11 in §1, the wrong-root
> `main/agentBrowserHost.js` assertion — is gone. `scripts/build.js` now splits
> `BUILD_PAYLOADS` (`:59-75`) from `APP_PAYLOADS` (`:82-86`) and reports the root
> per miss (`:234-251`). A real `npm run build` exits 0 in ~11 min and produces
> `release/Ecliptrix-Setup-1.0.0.exe`, 248,742,693 B, 2026-10-29 04:53, sha256
> `bdb0b07e63853647aa6f5aa4591716cf2810c7f392a970de8a4bf41350e7a1e4`
> (size/date/sha256 re-measured for this note). **D1** is fixed as well:
> `researchBrowserSmoke` forwards `researchPorts` at `scripts/smoke-test.js:210-211`,
> pinned by `scripts/smoke-test.research-ports.test.js`, and the packaged gate
> now passes that check for real (`cache/build-logs/gate-smoke-1.log:26`,
> `"success": true, "skipped": false`). Both §2 documentation nits are fixed in
> the current `CLAUDE.md` (`:40-41`, `:137`).
>
> Still open today, re-read against the current source (not assumed):
> **D2** — `camera_motion.py:140` still defaults to cwd-relative
> `config/camera-motion.yaml` and the packaged backend cwd is still the userData
> dir (`main/backendService.js:79`); unfixed. **D3** — `scripts/preflight.js:7`
> and `build.ps1:57` still say `[18, 18]`, `desktop/README.md:22` still
> advertises "≥ 18.18", and `smoke-test.js:1032` still needs native `WebSocket`
> (Node 22+); unfixed. **D4** — `BUILD_PAYLOADS` still omits
> `frontend/.next/BUILD_ID` and `backend/config`; unfixed. **D5 — confirmed
> still true**: the current `app.asar` carries seven `main/*.test.js` files
> (`appIcon`, `backendService`, `browserHostCwd`, `closeGuard`,
> `processManager.spawn-error`, `proxyProbe`, `window-state`), three more than
> this audit listed. **D6** — `prepare-ffmpeg.js:56` still only warns and
> `ffmpeg/LICENSE.txt` is still not asserted (`build/ffmpeg/LICENSE.txt`
> exists); unfixed. **D7** — `build.js:290` still calls `fs.statSync(...).isFile()`
> with no `existsSync` first, at the same line number; unfixed.
>
> Not predicted by this audit: the gate's current red light is a later defect,
> `readiness layout did not converge` at `sampling blocked layout 900x640` in
> `coverReadinessSmoke` — a viewport-override sampling race in which 19 of 60
> sampled frames still read `checking` while every geometry assertion passed. A
> fix landed in the working tree at 09:27Z
> (`desktop/scripts/lib/readiness-sample.js` now samples convergence instead of
> demanding 60/60 identical frames, plus
> `smoke-test.readiness-sampling.test.js`), but the packaged gate has not been
> re-run to `PASS` since. See `root-cause.md` §9-§10.

Scope: everything in `desktop/` that decides *where a payload must exist* and *where the
runtime looks for it*: `scripts/build.js`, `scripts/prepare-*.js`, `electron-builder.yml`,
`build.ps1`, `scripts/smoke-test.js`, and the `main/*.js` paths they must agree with.

Method: read-only. Every "exists now" value was measured with `fs.existsSync`/`readdirSync`
against the current working tree (state of `desktop/build/` at audit time); the packaging
build was **not** run and nothing was written outside this report.

Two notes on the brief:

* The orchestration layer is `desktop/build.ps1`, not `desktop/scripts/build.ps1`
  (no such file exists; `desktop/README.md:41` and `:66` both point at `desktop/build.ps1`).
* `desktop/scripts/build.js` was being edited by the parallel agent while I audited it.
  The reported assertion (item 1) is **already fixed in the working tree** as of this
  writing (`BUILD_PAYLOADS` / `APP_PAYLOADS`, `scripts/build.js:59-86` + `:234-251`);
  the table below records it as *found* (pre-fix) and *now*, and every other finding is
  against the current tree.

---

## 1. Asserted payloads — path / owning root / exists now / produced by / verdict

`BUILD_ASSERTIONS` as originally found (`desktop/scripts/build.js:55-72`, all probed
against `BUILD_DIR` = `desktop/build/` by the old `assertBuildOutputs`,
`build.js:212-221`). "Exists under build/" is measured, not inferred.

| # | Asserted path | Owning root | Exists under `desktop/build/` | Produced by | Verdict |
|---|---|---|---|---|---|
| 1 | `frontend/server.js` | `build/` | **yes** | `prepare-frontend.js:36-49` (cp of `.next/standalone`, `server.js` asserted at `:38`) | OK |
| 2 | `frontend/.next/static` | `build/` | **yes** | `prepare-frontend.js:52-54` (standalone output omits static) | OK |
| 3 | `frontend/node_modules/@mariozechner` | `build/` | **yes** | `prepare-frontend.js:72-78` (file tracing of `serverExternalPackages`) | OK |
| 4 | `backend/run.py` | `build/` | **yes** | `prepare-backend.js:18,51-65` (`COPY_ENTRIES`) | OK |
| 5 | `backend/app/main.py` | `build/` | **yes** | `prepare-backend.js:18,51-65` | OK |
| 6 | `python/python.exe` | `build/` | **yes** | `prepare-backend.js:100-107` (embeddable zip extract) | OK |
| 7 | `python/Lib/site-packages/fastapi` | `build/` | **yes** | `prepare-backend.js:137-140` (`pip install -r requirements.txt`) | OK |
| 8 | `python/Lib/site-packages/playwright/driver/node.exe` | `build/` | **yes** | same pip install; version pinned by `prepare-backend.js:14,84-89` | OK |
| 9 | `python/.../playwright/driver/package/browsers.json` | `build/` | **yes** | same pip install | OK |
| 10 | `backend/app/services/web_research/smoke.py` | `build/` | **yes** | `prepare-backend.js:18` (`app` copied wholesale) | OK |
| 11 | **`main/agentBrowserHost.js`** | **`desktop/`** (app shell, packed by `electron-builder.yml:21` `files: main/**`) | **NO** (file exists at `desktop/main/agentBrowserHost.js`, 7 063 B) | **nothing** — committed source, no prepare step owns it | **DEFECT (the reported one)** |
| 12 | `ffmpeg/ffmpeg.exe` | `build/` | **yes** | `prepare-ffmpeg.js:40-48` | OK |
| 13 | `ffmpeg/ffprobe.exe` | `build/` | **yes** | `prepare-ffmpeg.js:41-48` | OK |
| 14 | `env.template.desktop` | `build/` | **yes** | `prepare-env.js:21,118-129` | OK |
| 15 | *(added by the fix)* `preload/preload.js` | `desktop/` | n/a | source, `files: preload/**` (`yml:22`) | OK |
| 16 | *(added by the fix)* `assets/icon.ico` | `desktop/` | n/a | source, `files: assets/**` + `asarUnpack` (`yml:23,69-70`) | OK |

Result: **one** wrong-root entry (11). Every other asserted payload is genuinely owned by
`build/` and is present. No assertion is missing for a `build/` payload that currently
fails; the gaps I did find are listed as D4/D6 below.

> CORRECTION (2026-10-29): row 11 is **fixed** — see the status header and
> `root-cause.md` §3-§5. The row above is left as written: it was true when
> measured, and it is the reason the double-root assertion exists.

---

## 2. Confirmed additional defects

### D1 — HIGH: the packaged smoke gate can never pass (`scripts/smoke-test.js:184`)

> CORRECTION (2026-10-29): **D1 is fixed.** The forwarded call is now
> `scripts/smoke-test.js:210-211` (`screenshotDir, researchPorts`), pinned by
> `scripts/smoke-test.research-ports.test.js`. The line numbers below are the
> pre-fix ones and have all shifted: `:184` → `:210-211`, `:129-130` → `:130`,
> `:151-152` → the inner `runResearchBrowserSmoke` executor, `:192-199` →
> `:219-226`. The `TypeError` no longer occurs. See `root-cause.md` §6.

`researchBrowserSmoke()` receives the CDP/control ports and then drops them when calling
the inner runner:

```
175  async function researchBrowserSmoke(unpackedDir, userDataDir, screenshotDir,
176    researchPorts) {
...
184      const output = await runResearchBrowserSmoke(resources, userDataDir, screenshotDir)
```

`runResearchBrowserSmoke` (`:129-130`) then reads `researchPorts.cdp` / `researchPorts.control`
inside its `new Promise` executor (`:151-152`) → `TypeError: Cannot read properties of
undefined (reading 'cdp')`, which rejects the promise. `researchBrowserSmoke`'s `finally`
(`:192-199`) still runs the process drain, then the TypeError propagates and
`runDesktopSmoke` (`:1090-1091`) aborts.

Impact: `build.ps1` runs the smoke test **by default** (`build.ps1:46-47,262-269`), so the
next full run still fails — one step after the assertion — with exit code 5
(`build.ps1:72`). It stays hidden behind `npm run build` / `build:dir`
(`desktop/package.json:11-12`), which never invoke the smoke test.

> CORRECTION (2026-10-29): the "still fails one step after the assertion"
> prediction is obsolete. The gate clears this check and fails considerably
> later, in `coverReadinessSmoke` — see the status header.

Fix (one line, `smoke-test.js:184`):

```js
const output = await runResearchBrowserSmoke(resources, userDataDir, screenshotDir, researchPorts)
```

### D2 — MEDIUM: `camera-motion.yaml` is packaged but unreachable at runtime

* Loader default is cwd-relative: `backend-services/basic-service/app/services/composition/camera_motion.py:140`
  `def load_camera_config(config_path: str = "config/camera-motion.yaml")`.
* Every runtime call site relies on that default: `video_composition_service.py:927`,
  `camera_motion.py:402,1105,1365`.
* Packaged backend cwd is the **userData** dir: `desktop/main/backendService.js:79` (`cwd: userDataPath`).
  So the path resolves to `%APPDATA%\Ecliptrix\config\camera-motion.yaml`, which never exists.
* The file *is* shipped: `prepare-backend.js:18` copies `config/` → `electron-builder.yml:43-44`
  maps `build/backend` → `resources/backend` → `resources/backend/config/camera-motion.yaml`
  (verified present).
* Failure is silent-by-design: `camera_motion.py:186-188` falls back to dataclass defaults and
  only logs `warning("Camera motion config file not found, using defaults")`. In dev
  (cwd = `backend-services/basic-service`) the YAML *is* read, so packaged and dev behaviour diverge.

Fix — anchor the default at the module, not the cwd (`camera_motion.py:140`):

```python
def load_camera_config(config_path: str = os.path.join(
        os.path.dirname(__file__), "..", "..", "..", "config", "camera-motion.yaml")) -> CameraMotionConfig:
```

(same `dirname(__file__)/../config` convention `app/config.py:669` already uses).

### D3 — MEDIUM: Node floor disagrees between the gate and the preflight

* `smoke-test.js:1005`: `if (typeof WebSocket !== 'function') fail('Node.js 22+ is required for native CDP WebSocket support')`.
* `preflight.js:7`: `const MIN_NODE = [18, 18]`; `build.ps1:57`: `$MIN_NODE = @(18, 18)`;
  `desktop/README.md:22` advertises "Node.js ≥ 18.18".

On Node 18/20 the preflight passes and the default smoke gate then fails immediately.
(The audit machine runs v22.18.0, so this only bites other builders.)

Fix: set `MIN_NODE = [22, 0]` in `preflight.js:7` **and** `build.ps1:57`, and update
`desktop/README.md:22` — or replace the global `WebSocket` with an explicit client so 18.18 stays valid.

### D4 — LOW: two `build/` payloads are consumed but not asserted

* `frontend/.next/BUILD_ID` is read unconditionally right after packaging
  (`build.js:333-334`) → a missing one aborts with a raw `ENOENT` instead of the payload
  message. It exists today (`desktop/build/frontend/.next/BUILD_ID` = `47a51XeVd5YUbpYKgphlt`,
  identical to the root `.next/BUILD_ID`).
* `backend/config` (14 YAML files, verified 1:1 against `backend-services/basic-service/config/`)
  is what `app/config.py:669` and D2 depend on; nothing asserts it.

Fix: add `'frontend/.next/BUILD_ID'` and `'backend/config'` to `BUILD_PAYLOADS`
(currently `build.js:59-75`).

### D5 — LOW: app-shell test files are shipped inside `app.asar`

`electron-builder.yml:21` is `main/**`, and `desktop/main/` contains four test files
(`appIcon.test.js`, `backendService.test.js`, `closeGuard.test.js`, `window-state.test.js`)
that are packed with no purpose.

Fix (`electron-builder.yml:21-24`):

```yaml
files:
  - main/**
  - '!main/**/*.test.js'
```

### D6 — LOW: FFmpeg payload observability / GPL file not asserted

`prepare-ffmpeg.js:29-73` prints no destination path (unlike `prepare-env.js:135`), and a
missing license text is only a `console.warn` (`:56`) even though `desktop/README.md:91`
promises the GPL license ships with the binaries. `build/ffmpeg/LICENSE.txt` exists
(35 147 B) but nothing checks it.

Fix: log the assembled path like `prepare-env` does, and add `'ffmpeg/LICENSE.txt'` to
`BUILD_PAYLOADS` (`build.js:59-75`) so a license-less FFmpeg build fails loudly.

### D7 — COSMETIC: packaged-runtime check throws before its own message

`build.js:290` calls `fs.statSync(...).isFile()`; on a missing file `statSync` throws
`ENOENT`, so the intended Chinese message at `:291` (`最终包缺少研究资源: …`) never appears.

Fix: `if (!fs.existsSync(p) || !fs.statSync(p).isFile())` before throwing.

### Documentation nits found while cross-checking

* `CLAUDE.md:40-41` lists the build order as `prepare-env → prepare-frontend → prepare-backend
  → electron-builder`; the real order is frontend → backend → ffmpeg → env
  (`build.js:361-372`).
* `CLAUDE.md:137` says `initUserData()` creates `static/timeline_exports`; `main/config.js:29-31`
  creates only `data/`, `storage/`, `logs/` (the backend creates its own).
* Informational, not a bug: `static/timeline_exports` is cwd-relative in all four places that
  touch it (`app/main.py:773`, `app/services/local_media_resolver.py:49,131`,
  `app/services/timeline_export_service.py:26`, `app/routers/timeline_export_router.py:135`),
  so it is self-consistent — it just lives under userData instead of `STORAGE_ROOT`.

> CORRECTION (2026-10-29): both documentation nits are fixed in the current
> `CLAUDE.md`. `:40-41` now gives the real order
> (frontend → backend → ffmpeg → env), and `:137` no longer claims
> `initUserData()` creates `static/timeline_exports` — it says the backend
> creates its own subdirectories relative to its cwd (the userData dir).
> The third bullet is unchanged and was never a defect.

---

## 3. Verified correct (clean list)

* **All four `extraResources` sources exist now** — `build/frontend`, `build/backend`,
  `build/python`, `build/ffmpeg` (`electron-builder.yml:41-48`) — and their destinations are
  exactly what the main process resolves from `process.resourcesPath`
  (`main/index.js:313` → `main/backendService.js:34-36`: `python/python.exe`, `backend/run.py`,
  `ffmpeg/`; `main/frontendService.js:14-19`: `frontend/server.js`).
* **The `from: build / to: scripts / filter: env.template.desktop` mapping is right**
  (`electron-builder.yml:33-36`): destination equals `path.join(app.getAppPath(), 'scripts',
  'env.template.desktop')` (`main/index.js:109`, consumed by `main/config.js:33-37`), the
  `from`-is-a-directory form is the one that actually works for asar files (reasoning and
  measurement recorded in `docs/diagnoses/desktop-default-env-not-bundled/analysis.md:323-338`),
  and `prepare-env.js:135` prints the same relative path it writes.
* **`directories.buildResources: resources`** (`electron-builder.yml:18`) is what keeps
  `build/` outside electron-builder's implicit build-resource ignore, which is a precondition
  for the `from: build` entry above.
* **Icons**: `resources/icons/icon.ico` and `assets/icon.ico` both exist and are byte-identical
  (sha256 prefix `ca3e8d9185b2d5db`); `win.icon` / `installer*Icon` → `resources/icons/icon.ico`
  (`yml:58,79-81`); `asarUnpack: assets/icon.ico` (`yml:69-70`) matches
  `main/appIcon.js:18-27` (`app.asar` → `app.asar.unpacked` rewrite) and `main/index.js:124`;
  `main/appIcon.test.js:70-95` pins both `signAndEditExecutable: true` and the `asarUnpack` line.
* **App-shell paths inside the asar**: `preload/preload.js` (`main/window.js:114`),
  `assets/splash.html` (`window.js:24`), `assets/error.html` (`window.js:179`),
  `assets/dev-waiting.html` (`index.js:406`) are all covered by `files:` (`yml:21-24`).
* **`prepare-frontend`** asserts `server.js` (`:38`), copies `.next/static` + `public`
  (`:52-58`), strips `.env`/`.env.*` (`:63-68`) and asserts `@mariozechner` (`:72-78`).
* **`prepare-backend`** writes the empty `.env` sentinel (`:71-75`) so `load_dotenv` cannot
  walk up, and the `._pth` entry `../backend` (`:117-122`) matches the sibling layout of
  `resources/python` + `resources/backend`.
* **`backend/config`** is copied wholesale and the build copy matches the source exactly
  (14 files, no missing/extra).
* **Installer-name contract** holds: `build.js:326` expects `Ecliptrix-Setup-1.0.0.exe`,
  `yml:77` produces `Ecliptrix-Setup-${version}.exe`, `desktop/package.json:3` is `1.0.0`.
* **Research-manifest runtime constants** match the packaged layout:
  `build.js:313` (`resources/ffmpeg/ffprobe.exe`) is the exact literal required by
  `scripts/lib/research-release-evidence.js:200,211`.
* **`build.ps1` path expectations all resolve**: `scripts/build.js` (`:208`),
  `scripts/smoke-test.js` (`:268`), `node_modules/electron-builder` probe (`:248`),
  `cache/build-logs` (`:187-190`), and its argument whitelist agrees with `preflight.js:32-40`.
* **Other `smoke-test.js` path expectations match reality**: `resources/python/python.exe`
  (`:132,178`), `resources/ffmpeg/ffmpeg.exe` (`:273`), `release/win-unpacked/Ecliptrix.exe`
  (`:16,1003-1010`), `resources/frontend/.next/BUILD_ID` (`:46`, only under
  `--build-provenance`, and the file exists). `run_bundled`/`ffprobe` calls use paths derived
  from those two roots only.

---

## 4. Bottom line

The `main/agentBrowserHost.js` assertion was **not** the only defect of the
"payload checked at the wrong root" family, but it is the only one inside
`BUILD_ASSERTIONS` itself. The next two blockers, in the order the next build hits them, are:

> CORRECTION (2026-10-29): neither numbered item below is a blocker any more.
> The assertion is fixed and D1 is fixed (see the status header). The blockers
> that actually followed were the browser-host `cwd` inside `app.asar`, then
> the unbounded `resolveProxy`, then the gate's own process scope —
> `root-cause.md` §7-§9. D2 stays valid, but it never aborts a build: it
> degrades silently by design (§2/D2 above).

1. **D1** — `scripts/smoke-test.js:184`: the default `build.ps1` smoke gate always dies with
   a `TypeError` (one-line fix). This is the "one step later" failure the fix must also clear.
2. **D2** — `camera_motion.py:140`: `resources/backend/config/camera-motion.yaml` ships but is
   never read in the packaged app (cwd-relative default), silently degrading camera motion.

D3–D7 are latent/quality issues that do not abort the current build.
