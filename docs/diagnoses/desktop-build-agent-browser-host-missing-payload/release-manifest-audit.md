# Post-packaging release finalisation audit

> **Status update (2026-10-29 evening).** Body kept verbatim as the historical
> record; superseded measurements carry an inline
> `> CORRECTION (2026-10-29):` line. `root-cause.md` is authoritative where the
> two documents disagree. Line numbers below are as of audit time —
> `scripts/build.js` has since grown ~30 lines, so its later steps moved.
>
> Superseded by what exists now (all re-measured while writing this note):
>
> - The installer is **not** the 2026-10-03 / 214,909,149 B file. It is
>   `release/Ecliptrix-Setup-1.0.0.exe`, 248,742,693 B, mtime 2026-10-29 04:53,
>   sha256 `bdb0b07e63853647aa6f5aa4591716cf2810c7f392a970de8a4bf41350e7a1e4`.
> - `release/win-unpacked` is **not stale**: it was rebuilt from the fixed tree
>   (dir mtime 2026-10-29 04:57) and `resources/frontend/.next/BUILD_ID` is
>   `3DexEyA6UtBBITHbI2krO`, not the 2026-10-03 `R3S-JM6FMC32W4Fs4gseM`. All
>   four §3.1 payloads are present, `resources/backend/config/camera-motion.yaml`
>   among them, and the packaged python probe now exits 0 printing
>   `{"python":"3.11.9","playwright":"1.63.0","bs4":"4.15.0"}` — the failure
>   §3.2 records against the old tree no longer reproduces. `app.asar` also
>   carries `main/proxyProbe.js`.
> - `release/research-build-manifest.json` **exists** now (2,340,795 B,
>   2026-10-29 04:54, `package_id=b5e363c9…939cd`): the §5 row calling it
>   MISSING is obsolete, and so are §6 items 1 and 5. F2/F3 and pipe-audit's
>   F8 (`smoke-test.js` now forwards `researchPorts` at `:210-211`) are done.
>
> Still open today, re-read against the current source (not assumed):
>
> - **A-1 / F1** — `build.js:290` and `build.js:327` still `statSync` without an
>   `existsSync` guard, so a missing installer or resource still throws a raw
>   `ENOENT` instead of `安装器不是本次打包产物` / `最终包缺少研究资源`.
> - **A-2 / F4** — `readPackagedRuntime` still returns `playwright`'s version
>   without comparing it to `PLAYWRIGHT_VERSION`
>   (`prepare-backend.js:14`, the only place that constant exists), so a
>   `--skip-backend` reuse is still undetected.
> - **A-3 / F6** — `build.js:342` still writes the manifest with
>   `{ flag: 'wx' }` and no `rmSync` of a leftover `.tmp`.
> - **§5 is still a FAIL for a different reason.** `.agentmesh/research-r2/` is
>   empty (no `evidence.json`, no `installed` tree) and no `package_offline.json`
>   exists anywhere under `.agentmesh/`, so `verify:research` still cannot
>   produce a "release ready" claim; F7 (it is not wired into `build.js` or
>   `build.ps1`) still stands.
> - The smoke gate has still not printed `PASS`, and its current red light is
>   `readiness layout did not converge` at `sampling blocked layout 900x640`
>   (`coverReadinessSmoke`, a sampling race: 19/60 frames still `checking`,
>   geometry fine). A fix landed in the working tree at 09:27Z
>   (`desktop/scripts/lib/readiness-sample.js` + its test), so the reason is now
>   "gate not re-run" rather than "defect open" — and it is still not the
>   `smoke-test.js:184` `TypeError` this audit inherited from pipe-audit. §6
>   item 7's conclusion therefore holds, for a later reason.

Scope: everything that runs **after** `electron-builder` exits successfully in
`desktop/scripts/build.js:350`. Prompted by the packaging failure at
`[assert] verifying build/ payloads` (`- main/agentBrowserHost.js`); that
assertion is owned by another agent. This document audits what the build will do
once the assertion passes, so it does not fail again a long way in.

Working tree state at audit time: `git rev-parse HEAD` =
`6fc956ea13bedd14aaf75c6f3efce826e1394f1b`, and **a concurrent agent was running
`prepare-backend`**, which does `fs.rmSync(build/python)` then re-installs CPython
(`desktop/scripts/prepare-backend.js:106`). `desktop/build/python` was therefore a
moving target; findings below state which observations were taken from a
*completed* install.

Raw material: `desktop/scripts/build.js`, `desktop/scripts/verify-research-release.js`,
`desktop/scripts/lib/research-release-evidence.js`, `desktop/package.json`,
`desktop/electron-builder.yml`, `desktop/scripts/prepare-frontend.js`,
`desktop/scripts/prepare-backend.js`, and the on-disk trees
`desktop/build/`, `desktop/release/`, `.agentmesh/research-r2/`.

## 1. Execution order after electron-builder

`desktop/scripts/build.js:349-354`

```
const packagingStartedAt = Date.now()
await runElectronBuilder(builderArgs)                 // :350
await writeResearchManifest(args.dir, packagingStartedAt)  // :351  ← step A
printArtifacts()                                      // :353  ← step B
console.log(`[build] completed in ...`)               // :354
```

`writeResearchManifest` (`build.js:286-315`) is a straight-line chain with no
try/catch, so **the first failing precondition kills the build after the ~10-20
minute packaging step with nothing written**. Its order is:

1. `git rev-parse HEAD` → `sourceHead` (`:301-302`)
2. `git status --porcelain` → `dirty` (`:302`)
3. read `desktop/package.json` `version` (`:294`)
4. derive installer path, stat + mtime guard (`:296-299`)
5. read `resources/frontend/.next/BUILD_ID` from `win-unpacked` (`:303-304`)
6. `readPackagedRuntime()` — 4 file asserts + python probe (`:305` → `:254-284`)
7. `createPackageManifest(...)` — hash the entire package tree (`:300-308`)
8. write `release/research-build-manifest.json` (`:310-313`)

`desktop/scripts/verify-research-release.js` is **not** called by `build.js` or by
`desktop/build.ps1` (`findstr /I "verify" desktop\build.ps1` → no match). It is
only reachable via `desktop/package.json:14` (`npm run verify:research`) and the
README acceptance recipe, so nothing in the packaging pipeline consumes the
evidence contract automatically.

## 2. Step A — `writeResearchManifest()` preconditions

| # | Input contract | Evidence today | Verdict |
|---|---|---|---|
| A1 | `git rev-parse HEAD` from workspace root | `6fc956ea13bedd14aaf75c6f3efce826e1394f1b`; `.git/` present | **pass** |
| A2 | `git status --porcelain` (may be non-empty ⇒ `dirty:true`) | 7 lines (4 `M`, 3 `??`) ⇒ `dirty:true` | **pass** (tolerated) |
| A3 | `desktop/package.json` `.version` | `1.0.0` (root `package.json` also `1.0.0`) | **pass** |
| A4 | `release/Ecliptrix-Setup-<version>.exe` name matches `artifactName` | `electron-builder.yml:77` = `${productName}-Setup-${version}.${ext}` ⇒ `Ecliptrix-Setup-1.0.0.exe`; file exists, 214,909,149 B, mtime `2026-10-03T15:10:46Z` | **pass** |
| A5 | installer mtime ≥ `packagingStartedAt` | guard is `build.js:297`; electron-builder rewrites the exe, so a fresh run passes. `--dir` sets `installerPath=null` and skips it | **pass, but no ENOENT handling** |
| A6 | `win-unpacked/resources/frontend/.next/BUILD_ID` | `prepare-frontend` copies `.next/standalone` → `build/frontend` (`prepare-frontend.js:49`), which carries `.next/BUILD_ID` (`47a51XeVd5YUbpYKgphlt`); electron-builder maps `build/frontend` → `resources/frontend` (`electron-builder.yml:41-42`). The stale `win-unpacked` copy holds a **different** id (`R3S-JM6FMC32W4Fs4gseM`, mtime `2026-10-03`) | **pass on a fresh package**; the existing tree is stale and must not be re-used with `--skip-frontend` |
| A7 | whole-repo `git status` ⇒ `dirty` | `.gitignore:84-85` ignore `desktop/build/` and `desktop/release/`, so package artifacts never dirty the tree — but any untracked doc/test file (e.g. `.agentmesh/`, `docs/diagnoses/`, `desktop/scripts/lib/build-payload-checks.js`) sets `dirty:true` permanently | **pass** (see risk R3) |

> CORRECTION (2026-10-29): the A4 and A6 evidence columns are both stale.
> The installer is now 248,742,693 B, mtime 2026-10-29 04:53 (sha256
> `bdb0b07e…e7a1e4`), and `win-unpacked` was rebuilt from the fixed tree, so its
> `BUILD_ID` is `3DexEyA6UtBBITHbI2krO` — the "existing tree is stale and must
> not be re-used" caveat in A6 no longer applies to the current artefacts. Both
> rows stay as written because they were the measured truth at audit time.

### Findings for step A

- **A-1 (robustness).** `build.js:297` and `build.js:260` call `fs.statSync(...)`
  without `existsSync` first. A missing installer or missing packaged resource
  therefore throws a raw `ENOENT` instead of the intended Chinese message
  (`安装器不是本次打包产物` / `最终包缺少研究资源`). The failure is still loud, but
  the message points at the wrong thing.
- **A-2 (stale-artifact trap).** The single most likely post-assertion failure in
  local iteration is `npm run build:dir --skip-frontend`: `build/frontend` keeps
  the old `BUILD_ID`, but the more dangerous case is `--skip-backend` reusing a
  `build/python` whose `playwright` version does not match the
  `PLAYWRIGHT_VERSION = '1.63.0'` assertion in `prepare-backend.js:87` — the
  assertion is skipped, and `readPackagedRuntime` only checks *importability*,
  not the version (`build.js:267-278`). Nothing compares
  `desktop/build/python/Lib/site-packages/playwright-*.dist-info` version to
  `requirements.txt:59`.
- **A-3.** `fs.writeFileSync(temporary, …, { flag: 'wx' })` (`build.js:312`) fails
  with `EEXIST` if a previous crashed run left
  `research-build-manifest.json.<pid>.tmp` behind. Low probability (pid-scoped),
  but an `fs.rmSync(temporary, {force:true})` before the write would remove it.

## 3. Step B — `readPackagedRuntime()` (`build.js:254-284`)

### 3.1 The four hard-asserted resources

Checked with `fs.statSync(...).isFile()` (`build.js:256-263`) under
`release/win-unpacked/resources/`:

| Relative path | `desktop/build/` (source payload) | `release/win-unpacked/resources/` (existing, stale pkg) |
|---|---|---|
| `backend/run.py` | present, 1,881 B | present, 1,023 B |
| `backend/app/services/web_research/smoke.py` | present, 19,900 B | **MISSING (ENOENT)** |
| `python/Lib/site-packages/playwright/driver/node.exe` | present, 93,580,104 B (completed install) | **MISSING (ENOENT)** |
| `python/Lib/site-packages/playwright/driver/package/browsers.json` | present, 1,137 B (completed install) | **MISSING (ENOENT)** |

All four arrived correctly from `build/` in a *completed* `prepare-backend`, and
`electron-builder.yml:43-48` maps `build/backend` → `resources/backend` and
`build/python` → `resources/python`, so a fresh package satisfies all four.
The existing `win-unpacked` predates the research/browser feature entirely — it
must not be used as evidence for anything.

> CORRECTION (2026-10-29): the three "MISSING (ENOENT)" cells and that
> conclusion are superseded. `release/win-unpacked` was rebuilt from the fixed
> tree (2026-10-29 04:57): `backend/app/services/web_research/smoke.py`,
> `python/Lib/site-packages/playwright/driver/node.exe` (93,580,104 B) and
> `…/driver/package/browsers.json` are all present, as is
> `resources/backend/config/camera-motion.yaml`. The old tree was a valid
> negative control when measured; it no longer describes the artefacts.

Caveat observed live: because a teammate's `prepare-backend` was re-extracting
CPython during this audit, `desktop/build/python/Lib/site-packages/playwright`
went from present → absent → (mid-`pip install`) within ~90 s. `build/python` is
only trustworthy after `[prepare-backend] done`.

### 3.2 The python probe — actually executed

Command reproduced verbatim from `build.js:267-277` against
`desktop/build/python/python.exe`, `cwd = M:\takoAI\Ecliptrix`,
`PYTHONNOUSERSITE=1`, script:

```python
import json, sys
from importlib.metadata import version
import playwright.async_api, bs4
print(json.dumps(dict(python=sys.version.split()[0], playwright=version("playwright"), bs4=version("beautifulsoup4"))))
```

Result on the completed install:

```
exit code: 0
stdout raw: "{\"python\": \"3.11.9\", \"playwright\": \"1.63.0\", \"bs4\": \"4.15.0\"}\r\n"
stderr raw: ""
parsed:     {"python":"3.11.9","playwright":"1.63.0","bs4":"4.15.0"}
```

The same probe against the **stale packaged runtime**
(`release/win-unpacked/resources/python/python.exe`) fails, which is what the
final packaging step would have reported:

```
exit code: 1
stdout: ""
stderr: "Traceback (most recent call last):\r\n  File \"<string>\", line 3, in <module>\r\nModuleNotFoundError: No module named 'playwright'\r\n"
```

Note the earlier transient failure of the same probe (`ModuleNotFoundError: No
module named 'playwright'`, exit 1) was the concurrent `pip install` window, not
a real defect — `requirements.txt:58-59` pins
`beautifulsoup4==4.15.0` and `playwright==1.63.0`, and a clean install satisfies
the probe.

> CORRECTION (2026-10-29): the packaged probe no longer fails. Re-run against
> the current `release/win-unpacked/resources/python/python.exe` it exits 0 and
> prints `{"python": "3.11.9", "playwright": "1.63.0", "bs4": "4.15.0"}`, so
> the `ModuleNotFoundError` block above describes the 2026-10-03 tree only.

**Verdict: pass**, conditional on a full (non-`--skip-backend`) payload.

The returned runtime object satisfies `manifestSchema`
(`research-release-evidence.js:195-200`): `browser` contains `CDP`,
`ffprobe === 'resources/ffmpeg/ffprobe.exe'`, and `build/ffmpeg/` contains
`ffmpeg.exe`, `ffprobe.exe`, `LICENSE.txt`, `SOURCE.txt` — so both
`resources/ffmpeg/ffmpeg.exe` and `…/ffprobe.exe` will be present in the file
list.

## 4. Step C — `createPackageManifest()` (`research-release-evidence.js:216-230`)

### 4.1 What it actually requires

Derived by reading the implementation, then each item checked against the repo:

| Requirement | Source | Check today |
|---|---|---|
| `workspaceRoot` absolute and free of symlinks/junctions on every ancestor | `:89-99`, `:67-80` | pass — `M:\` → `M:\takoAI` → `M:\takoAI\Ecliptrix`, 0 symlinks |
| `releaseRoot` and `packageRoot` inside workspace | `:81-88` | pass — `desktop/release`, `desktop/release/win-unpacked` |
| `packageRoot` strictly inside `releaseRoot` | `:98` | pass |
| whole package tree enumerable, no symlink/junction, no case-fold collision, every segment `relative()`-safe | `:135-158`, `:53-58` | pass — `win-unpacked`: 12,318 files / 1,779 dirs, 0 symlinks, 0 case clashes, 0 offending segments (incl. trailing-dot check; `.next`/`.exe` are fine) |
| ≤ 200,000 files (`MAX_FILES`) | `:11`, `:151` | pass — 12,318 |
| every file hashable, stable size+mtime+ctime+ino+dev across 2 enumerations | `:110-134`, `:159-180` | pass in principle; see risk R4 |
| installer hash inside `releaseRoot`, not inside `packageRoot` | `:221-225` | pass — `Ecliptrix-Setup-1.0.0.exe` is a sibling of `win-unpacked/` |
| `sourceHead` = 40-64 hex, `frontendBuildId` non-empty ≤256, `dirty` boolean, `runtime` 6 string fields | `:190-196` | pass with today's values |
| `ffmpeg`/`ffprobe` entries present in the file list | `:211` | pass (`resources/ffmpeg/*`) |
| `installer` may be `null` | `:213` | pass |
| **evidence documents, checksums, smoke output** | — | **not required** — see 4.2 |

### 4.2 Key structural finding

`createPackageManifest` reads **no evidence document, no checksum manifest and no
smoke output**. Its entire input is: the package tree, the installer file, and
six scalar/git facts. All failure paths funnel through `safeError`
(`:215`) into `{success:false, errors:[…]}`, and `build.js:309` turns that into
`研究包清单失败: …`.

So area 3 **will not fail for missing research evidence** — the evidence
contract is enforced only by `validateReleaseEvidence` (§5). Verdict: **pass**.

Failure paths enumerated, with today's status:

| Failure path | Line | Status today |
|---|---|---|
| any `lstat`/`realpath`/`open` error (ENOENT/EACCES/EBUSY) | `:67-80`, `:110-134` | needs a complete `win-unpacked` |
| symlink or junction anywhere in the package | `:73`, `:147` | 0 present |
| path segment "." / ".." / trailing space/dot / `<>:"|?*` / reserved name | `:56` | 0 present |
| >200,000 files | `:151` | 12,318 |
| duplicate file after case folding | `:144`, `:205` | 0 |
| tree changed during the scan | `:168`, `:178` | see R4 |
| file over `MAX_JSON`… (not used here) | `:10` | n/a |
| installer inside package tree | `:223` | no |
| bad `sourceHead` / `frontendBuildId` / `runtime` shape | `:192-200` | valid |
| `created_at` in the future (>5 min) | `:194` | system clock driven |

### 4.3 Cost, not correctness

On the happy path the tree scan hashes the **whole** `win-unpacked`
(~0.99 GiB incl. the 188 MB `Ecliptrix.exe` and the 93 MB Playwright
`driver/node.exe`), then `enumerate()`s it twice more to prove stability
(`:159-180`). A read-only dry run of `createPackageManifest` against the
existing `win-unpacked` did not complete inside a 120 s window, so expect
**several minutes** of silent hashing after packaging with only a 30 s
`onProgress` tick (`:173`) — which `build.js:307` prints as a bare object.
`printArtifacts` then hashes the 215 MB installer again (`build.js:247`).

## 5. Step D/E — `verify-research-release.js` and the evidence docs it reads

`desktop/scripts/verify-research-release.js:10-27` requires three arguments
(`--unpacked`, `--manifest`, `--evidence`) and forwards `installedRoot`,
`manifestPath`, `evidencePath` to `validateReleaseEvidence`
(`research-release-evidence.js:547-632`).

Executed as documented (README.md:335) and again with absolute paths — **both
produce byte-identical output**:

```
$ node desktop/scripts/verify-research-release.js --unpacked desktop/release/win-unpacked --manifest desktop/release/research-build-manifest.json --evidence .agentmesh/research-r2/r2-audit/evidence.json
{"success":false,"release_ready":false,"package_id":null,"checks":[],"blockers":["文件系统操作失败 (ENOENT)"],"exitCode":1}
```

The generic `ENOENT` is produced by `safeError` (`:215`), which deliberately
discards the path. Instrumenting the library's injectable `fs` boundary
(`options.fs`, `:90`) proves which input is missing:

```
# with a non-existent run-id:
FSFAIL lstat "M:\takoAI\Ecliptrix\.agentmesh\research-r2\r2-audit" ENOENT
RESULT {"success":false,...,"blockers":["文件系统操作失败 (ENOENT)"],"exitCode":1}

# with the existing .agentmesh/research-r2 root:
FSFAIL lstat "M:\takoAI\Ecliptrix\.agentmesh\research-r2\installed" ENOENT   ← tolerated (:105)
FSFAIL lstat "M:\takoAI\Ecliptrix\desktop\release\research-build-manifest.json" ENOENT
RESULT {"success":false,...,"blockers":["文件系统操作失败 (ENOENT)"],"exitCode":1}
```

Inputs the CLI needs, versus what exists:

| Input | Contract | Status |
|---|---|---|
| `--manifest desktop/release/research-build-manifest.json` | directly in `releaseRoot`, outside the package tree (`:552`); ≤64 MiB JSON (`:10`, `:555`) | **MISSING** — `release/` holds only `builder-debug.yml`, `builder-effective-config.yml`, the installer, its `.blockmap`, `win-unpacked/`. Written by step A, i.e. it appears only if `writeResearchManifest` succeeds |
| `--evidence .agentmesh/research-r2/<run-id>/evidence.json` | must sit directly in a directory whose **basename is the `run_id`** (`:563`), `schema_version:1`, `package_id` + `manifest_sha256` matching, exactly 7 checks (`IDS`, `:14`, `:566`) | **MISSING** — `.agentmesh/research-r2/` exists but is **empty**. No tool in the repo generates `evidence.json`; `findstr /S "evidence.json" desktop\scripts` matches only `research-release-evidence.test.js`, so this file is hand-authored per release |
| `--installed .agentmesh/research-r2/<run-id>/installed` | must be exactly `<evidenceRoot>/installed` (`:104`); tree must equal the manifest file set + one optional `Uninstall Ecliptrix*.exe` (`:408-429`) | **MISSING** — optional at root level (`:105` ENOENT tolerated) but then `installedTree` requires it plus a `pass` installer check (`:409`) |
| `.agentmesh/research-r2/<run-id>/package_offline.json` | produced by `smoke-test.js:922-946`, must be `status:'pass'`, `success:true`, 6 steps (`:375-407`) | **MISSING** (and per pipe-audit, `smoke-test.js:184` currently `TypeError`s) |
| attachments: before/after images, source records, MP4 + probe record + frames, disabled/enabled model records, test results + baseline comparison | `ROLES`/`RECORD_EXTRA` (`:24-39`), per-check validators (`:519-545`) | **MISSING** |

**Verdict: FAIL** — but note *where* it fails: this step is a **manual,
out-of-band acceptance command**. `npm run build` does not call it, so it cannot
break the packaging run. It does mean the "release is ready" claim cannot be
produced at all today.

> CORRECTION (2026-10-29): the first row of the table above changed.
> `desktop/release/research-build-manifest.json` now exists (2,340,795 B,
> 2026-10-29 04:54, `package_id=b5e363c9764753e91b796245db5b3dbbf3190098e0a2b40279274a55dda539cd`).
> The verdict still stands, but for the remaining inputs:
> `.agentmesh/research-r2/` is empty (no `evidence.json`, no `installed` tree)
> and no `package_offline.json` exists anywhere under `.agentmesh/`, because the
> smoke gate has not reached `PASS`.

Two additional traps worth recording:

- `validateReleaseEvidence` requires a **non-null `manifest.installer`**
  (`:409`). A `--dir` build writes `installer: null` (`build.js:296`, `:306`),
  so a `build:dir` artifact can never pass release acceptance even with perfect
  evidence.
- `--evidence` basename must differ from the smoke report: the README recipe uses
  `<run-id>/package_offline.json` for smoke and `<run-id>/evidence.json` for the
  aggregate, and `researchReportPath` (`smoke-test.js:903-920`) hard-rejects any
  report not named `package_offline.json` in
  `.agentmesh/research-r2/<run-id>/`.

## 6. What will break the build after the assertion fix — ranked

1. **`readPackagedRuntime` on a stale `win-unpacked`** — `build.js:260` throws
   `ENOENT` (raw, not the Chinese message) if `resources/backend/app/services/web_research/smoke.py`
   or the two Playwright driver paths are absent, which is the case in the
   existing `release/win-unpacked/`. Only a real re-package fixes it; do not
   reuse the current tree.
2. **`build/python` mid-install** — the only *observed* live failure in this
   audit: hashing/probing while `prepare-backend` is re-extracting CPython gives
   `ModuleNotFoundError: No module named 'playwright'` at `build.js:278`
   (`包内研究运行时探测失败`). Anything that packages concurrently with another
   `prepare-backend` will trip this.
3. **Installer missing or misnamed** — `build.js:297` raw `ENOENT` if
   `Ecliptrix-Setup-1.0.0.exe` was not produced (e.g. NSIS step skipped);
   the mtime guard itself is satisfied by a fresh package.
4. **`BUILD_ID` missing** — `build.js:303` `readFileSync` throws raw `ENOENT`
   when `--skip-frontend` is combined with a cleaned `release/` and the
   electron-builder `extraResources` mapping changes. Not expected today.
5. **`main/agentBrowserHost.js` assertion** (other agent's fix): note that
   **`desktop/build/main/` does not exist at all** and no `prepare-*` script
   creates it — `build root: backend, env.template.desktop, ffmpeg, frontend,
   python`. `electron-builder.yml:21` packages `main/**` straight from
   `desktop/main/` into the asar, so `BUILD_ASSERTIONS` (`build.js:64`) is
   asserting a `build/` path this pipeline never produces. The durable fix is to
   validate `desktop/main/agentBrowserHost.js` (source) or drop that entry —
   not to invent a `build/main/` staging step, which would additionally ship a
   duplicate of `main/` inside `extraResources`-free asar content.
6. **`createPackageManifest` runtime cost/flakiness** — the full-tree hash takes
   minutes and *fails hard if any package file changes mid-scan*
   (`:168`, `:178`). A Defender/indexer rewrite or a second packaging attempt
   running against the same `win-unpacked` yields
   `包文件在扫描期间发生变化` / `包文件集合或元数据发生变化`. Also keep the
   installer and manifest writes out of concurrent hands.
7. **`research-release` acceptance cannot pass** — §5: no manifest, no
   `evidence.json`, no `installed` tree, no smoke report, and `smoke-test.js:184`
   currently `TypeError`s (pipe-audit). This blocks the release gate, not
   `npm run build`.
8. **`dirty:true` is inevitable and by design** — every build from this tree will
   record `dirty:true` because `.agentmesh/`, `docs/diagnoses/` and the untracked
   `desktop/scripts/lib/build-payload-checks.js` are untracked. The contract
   accepts it (`research-release-evidence.js:192`), but
   `docs/plans/agent-general-capabilities/spec.md:1103` states the pre-build gate
   "打包前 `git status --porcelain` 必须为 0" — code and spec disagree, and the code
   wins today. No action needed unless the release wants a clean-commit
   guarantee.

> CORRECTION (2026-10-29): only items 2, 3, 4 (latent) and 8 still describe
> today. Item 1 is gone (the re-package happened, 2026-10-29 04:53 / 04:57, all
> four §3.1 resources present), item 5 is fixed by the double-root assertion,
> and item 7's premise changed: the manifest now exists and the gate's `:184`
> `TypeError` is fixed — it still cannot reach `PASS`, for the later
> `coverReadinessSmoke` reason. Step A itself did not fail: the build printed
> `[build] completed in 10.9 min` and `package_id=b5e363c9…939cd`
> (`cache/build-logs/gate-build-1.log:571-576`).

## 7. Recommended fixes (for the owning agents)

| # | Where | Change |
|---|---|---|
| F1 | `desktop/scripts/build.js:260`, `:297`, `:303` | Guard with `fs.existsSync` / wrap in a helper that reports the *path* and the intended Chinese message, so a missing payload prints `最终包缺少研究资源: <path>` instead of raw `ENOENT`. Keeps `safeError`-style context. |
| F2 | `desktop/scripts/build.js:64` | Replace `main/agentBrowserHost.js` with a `desktop/main/` source assertion (or drop it), since `build/main/` is not a pipeline product. |
| F3 | `desktop/build/` staging | Do **not** add a `prepare-main` step just to satisfy F2: `main/**` already ships inside the asar from `desktop/main/` (`electron-builder.yml:21`), so staging a copy would duplicate it. |
| F4 | `desktop/scripts/build.js:267-278` | Compare `version("playwright")` to `prepare-backend.js`'s `PLAYWRIGHT_VERSION` (`1.63.0`) inside `readPackagedRuntime`, so a `--skip-backend` reuse of an older payload fails with a clear message instead of silently shipping it. |
| F5 | `desktop/scripts/lib/research-release-evidence.js:215` | Make `safeError` include the failing path for `ENOENT` at least; today every missing input collapses to `文件系统操作失败 (ENOENT)`, which is what made this audit need an `fs` shim to diagnose. |
| F6 | `desktop/scripts/build.js:310-313` | `fs.rmSync(temporary, {force:true})` before the `{flag:'wx'}` write to survive a leftover `.tmp` after a crash. |
| F7 | Release process (README.md:328-336) | `verify:research` is not wired into `build.js` or `build.ps1`; add it as an explicit post-smoke step (or document that it is manual) so area 5's FAIL is visible instead of silent. |
| F8 | `desktop/scripts/smoke-test.js:184` | pipe-audit's one-line fix: pass `researchPorts` as the 4th argument. Required before any `package_offline.json` can exist. |

## 8. Assumptions

- A fresh full build (`npm run build`, no `--skip-frontend`/`--skip-backend`,
  not `--dir`) is what the e2e agent is running; `--dir` artifacts are treated as
  unable to satisfy release acceptance by design (`:409`).
- `desktop/release/win-unpacked` inspected here is a **stale** artifact from
  `2026-10-03` (its `BUILD_ID` and missing research payloads prove it) and is used
  only as a negative control.
- No writes were made outside this document; `desktop/build/`,
  `desktop/release/` and the packaging pipeline were left untouched. All probes
  were read-only (`fs.statSync`/`readdirSync`, `git`, and the python
  interpreter).

> CORRECTION (2026-10-29): `win-unpacked` is no longer that artifact — it was
> rebuilt from the fixed tree on 2026-10-29 (`BUILD_ID` `3DexEyA6UtBBITHbI2krO`,
> dir mtime 04:57, all research payloads present). The rest of §8 still holds.
