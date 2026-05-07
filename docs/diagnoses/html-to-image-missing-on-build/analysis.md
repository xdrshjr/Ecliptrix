# Bug Analysis: `html-to-image` module not found during `start.sh` production build

> Slug: `html-to-image-missing-on-build`
> Reported: 2026-05-07 23:40 (dev server `kt@kt-NF5568M4`, working dir `~/tako/Ecliptrix`)
> Reporter command: `./start.sh` (production mode, port 3010)

---

## 1. Problem description

`./start.sh` aborts during step `[3/5] Building Frontend` with a webpack
module-resolution error:

```
./src/components/video/components/VideoCoverModal/hooks/useCoverRender.ts
Module not found: Can't resolve 'html-to-image'

Import trace for requested module:
./src/components/video/components/VideoCoverModal/VideoCoverModal.tsx
./src/components/video/components/VideoCoverModal/index.tsx
./src/components/video/components/VideoPlayerPanel/VideoPlayerPanel.tsx
./src/components/video/components/VideoPlayerPanel/index.ts
./src/components/video/components/index.ts
./src/components/video/VideoEditingInterface.tsx
./src/components/video/projects/VideoEditorContainer.tsx
./src/components/video/projects/index.ts
./src/components/Container.tsx
./src/app/page.tsx

> Build failed because of webpack errors
[ERROR] 2026-05-07 23:40:58 - Frontend build failed / 前端构建失败
```

After the build failure, `start.sh` invokes its `handle_error` trap and shuts
down the partially-started services, so neither frontend nor backend is left
running.

---

## 2. Reproduction steps

Tested on a Linux host (Node 22, npm 10, conda env `ecliptrix`) where the
checkout has been **freshly pulled but `npm install` has NOT been re-run**
since commit `d82de4d` (the cover-authoring feature).

1. `cd ~/tako/Ecliptrix` (or wherever the repo is checked out).
2. `git pull` to a tree that includes commit `d82de4d` ("feat: add
   per-project video cover authoring with template-based editor").
3. **Skip `bash install.sh`** — i.e. do not run `npm install`. Verify:
   ```bash
   ls node_modules/html-to-image     # → "No such file or directory"
   grep -c html-to-image package.json # → 1
   ```
4. `conda activate ecliptrix`
5. `./start.sh`
6. Observe the build failure quoted above at step `[3/5]`. The script exits
   with `[ERROR] Frontend build failed`.

### Minimal repro (no shell wrapper)

```bash
cd ~/tako/Ecliptrix
rm -rf node_modules/html-to-image      # simulate the missing dep
npm run build
```

The same `Module not found: Can't resolve 'html-to-image'` is emitted.

### Confirmed fix path (manual)

```bash
npm install                            # restore the dep listed in package.json
npm run build                          # builds successfully
```

---

## 3. Root cause analysis

### 3.1 The dependency was added in the most recent commit

Commit `d82de4d` ("feat: add per-project video cover authoring …") introduced
both the new module that imports `html-to-image` and the `package.json` /
`package-lock.json` entry for it:

`package.json:31`
```json
"html-to-image": "^1.11.13",
```

`src/components/video/components/VideoCoverModal/hooks/useCoverRender.ts:54`
```ts
const htmlToImage = await import('html-to-image');
```

The lockfile in the same commit pins `node_modules/html-to-image` to
`1.11.13` (`package-lock.json`, entry `node_modules/html-to-image`), so a
plain `npm install` (or `npm ci`) on the new tree is sufficient to provide the
module. No registry / network problem is involved.

### 3.2 `start.sh` does not install dependencies

`start.sh` is a *runtime* orchestrator, not an installer. Reading
`start.sh:286-300`:

```bash
# ============ Step 3: Build Frontend (production mode only) ============
if [ "$DEV_MODE" = false ] || [ "$FORCE_REBUILD" = true ]; then
    header "[3/5] Building Frontend / 构建前端项目"
    cd "$SCRIPT_DIR"

    step "Running npm run build..."
    if ESLINT_NO_DEV_ERRORS=true npm run build 2>&1 | tee -a "$STARTUP_LOG"; then
        success "Frontend build complete / 前端构建完成"
    else
        error "Frontend build failed / 前端构建失败"
        handle_error
    fi
```

There is no `npm install`, `npm ci`, or even a freshness check against
`package-lock.json` anywhere in the script. A grep across the file confirms
this — only `npm run build`, `npm run dev`, and `npm start` are invoked.

The corresponding install logic lives only in `install.sh:274-278`:

```bash
step "Running npm install..."
if npm install $NPM_ARGS 2>&1 | tee -a "$INSTALL_LOG"; then
    success "Frontend dependencies installed / 前端依赖已安装"
else
    error "npm install failed / npm install 失败"
```

So when `package.json` changes between two `start.sh` invocations,
the operator must remember to run `install.sh` (or `npm install`) in between.
This was not done on this machine before the failing run, leaving
`node_modules/` stale relative to the locked `package.json`.

### 3.3 The `await import()` does not save us

`useCoverRender.ts:54` uses a *dynamic* `import('html-to-image')`. One might
hope this defers the dependency until runtime, but Next.js / webpack still
resolves the specifier statically at build time to know how to code-split the
chunk. With the package missing from `node_modules/`, the resolver throws
`Module not found` during `next build`, which is exactly what the log shows.
The `await import` therefore does **not** make the dependency optional —
it only changes *when* the user pays the JS download cost.

### 3.4 Evidence summary

| Evidence | What it shows |
|----------|---------------|
| Build log: `Module not found: Can't resolve 'html-to-image'` | Webpack cannot find the package. |
| `package.json:31` lists `"html-to-image": "^1.11.13"` | Dep is declared, so the source code is correct. |
| `git show d82de4d -- package.json` adds the line | The dep is brand new; older `node_modules/` predates it. |
| `git show d82de4d -- package-lock.json` adds `node_modules/html-to-image` | Lockfile is consistent; `npm install` will work without ambiguity. |
| `start.sh:286-300` runs `npm run build` only | The start path never installs deps. |
| `install.sh:274-278` is the only place `npm install` is invoked | Re-installation is operator-driven. |

**Conclusion**: the failure is operational, not a code defect. After pulling
`d82de4d`, `node_modules/` on the dev server was not refreshed, and
`start.sh` does not auto-detect or repair this drift. The single missing
package transitively breaks the entire build because it is imported (even
dynamically) from a component that is part of the home-page render tree
(`page.tsx → Container → VideoEditorContainer → … → VideoCoverModal`).

---

## 4. Impact surface

- **Affected feature**: the new "Cover" button / VideoCoverModal in the video
  editor (commit `d82de4d`). However, because `VideoCoverModal` is statically
  imported through the chain ending in `src/app/page.tsx`, the build fails
  *globally*, not just for the cover feature.
- **Affected users / environments**: any deployment that pulls latest `main`
  and starts via `start.sh` without first running `install.sh` / `npm
  install`. This includes:
  - The reporter's dev server `kt@kt-NF5568M4` (observed).
  - The Singapore-01 production server (`47.245.126.128`) the next time it
    deploys this commit, if the deploy workflow does not run `npm ci` /
    `npm install` before `start.sh`.
  - Any contributor who `git pull`s and runs `start.sh` directly.
- **Severity**: high for any operator on the upgrade path — the app cannot
  start at all until deps are installed. Low once `npm install` has been run;
  the bug does not recur until another dependency is added.
- **Data / runtime risk**: none. `start.sh` aborts cleanly via its
  `handle_error` trap; backend and frontend services are not left in a
  half-running state.

---

## 5. Candidate fixes

| # | Fix | Where | Invasiveness | Risk | Effort | Notes |
|---|------|-------|--------------|------|--------|-------|
| A | **Operator action only** — instruct the user to run `bash install.sh` (or at least `npm install`) before `./start.sh` whenever `package.json` / `package-lock.json` changed. | docs / runbook | None (no code) | None | ~1 min | Doesn't prevent recurrence next time a new dep lands. |
| B | **Auto-install in `start.sh`** when `package-lock.json` (or `package.json`) is newer than `node_modules/.package-lock.json`. Run `npm ci` (or `npm install`) before the build step. | `start.sh:286` (new step before `[3/5]`) | Small (~10 lines of bash) | Low — `npm ci` is idempotent; only adds time on stale checkouts. Slightly invasive on slow servers / CI without network. | ~15 min | Symmetric with the existing `.next` freshness check at `start.sh:269-284`, so it fits the file's style. |
| C | **Move dep-install responsibility into the deployment pipeline** (e.g. CI/CD or `dev/deploy_dev_*.py`) so `start.sh` can stay a pure runtime script. | deploy scripts | Medium | Low for new pipelines, higher for ad-hoc operators who still call `start.sh` directly. | ~30 min + per-pipeline | Cleanest separation of concerns, but does not help anyone running `start.sh` by hand. |

A and B can coexist — the docs nudge reduces friction while B is being
implemented. B and C together (auto-install in `start.sh` AND a CI step) give
defense in depth.

---

## 6. Recommended fix

**Adopt fix B** — add an auto `npm install` (or `npm ci`) check to
`start.sh`, modelled on the existing `.next` freshness check at
`start.sh:269-284`. Specifically, before step `[3/5]`:

1. If `node_modules/` is missing → run `npm install`.
2. Else if `package-lock.json` is newer than `node_modules/.package-lock.json`
   → run `npm ci` (or `npm install`).
3. Otherwise → skip.

Justification:

- **Fixes the reported symptom directly.** The reporter's exact command
  (`./start.sh`) would have succeeded.
- **Symmetric with existing patterns in the same script.** `start.sh`
  already detects stale `.next` builds against source files
  (`start.sh:269-284`) and rebuilds automatically; doing the same for
  `node_modules/` against `package-lock.json` keeps the script's mental
  model coherent.
- **Low risk.** `npm ci` on an already-fresh tree is a fast no-op; on a stale
  tree it is exactly what the operator would have run by hand.
- **Backward compatible.** `install.sh` continues to handle first-time setup
  (system deps, Python venv, DB bootstrap) — `start.sh` only patches the
  Node-side dependency drift between two `start` invocations, which is the
  failure mode actually observed.
- **Pairs naturally with fix A** (docs note in `CLAUDE.md` /
  `README.md`) so contributors still understand the contract.

Out of scope for this report (per node constraints, no fix code is being
written here): the actual bash insertion into `start.sh` and any
documentation update.

---

## 7. 评审结论 (Review Verdict)

### 7.1 Evidence audit

The root-cause chain has been re-verified against the working tree:

- `package.json:26-39` — confirmed `"html-to-image": "^1.11.13"` is the only
  declaration; no peerDependency / optionalDependency variant exists.
- `package-lock.json` — `grep -c "node_modules/html-to-image" package-lock.json`
  returns `1`, so a `npm ci` against this lockfile is unambiguous. (Verified
  in this review.)
- `git show --stat d82de4d -- package.json package-lock.json` — confirmed
  this single commit adds both the `package.json` entry and the lockfile
  entry; no follow-up commit modifies them. So any tree pulled at or after
  `d82de4d` without re-running `npm install` is guaranteed to reproduce.
- `grep -rn "html-to-image" src/` — the only *executable* reference is the
  dynamic import at `useCoverRender.ts:54`; the other two matches are doc
  comments (`CoverPreview.tsx:25`, `useCoverRender.ts:21`,
  `useCoverRender.ts:70`). There is **no** static `import 'html-to-image'`
  anywhere, so the report's claim that webpack resolves the *dynamic*
  specifier statically (and therefore still fails the build) is the actual
  load-bearing mechanism. This was checked again here.
- `start.sh` — `grep "npm (install|ci)" start.sh` returns no matches.
  `grep "^\s*(npm|yarn|pnpm)" start.sh` shows only `npm run dev` (line 351)
  and `npm start` (line 353). The script genuinely never installs deps.
- `install.sh:274-280` — confirmed as the only place `npm install` runs
  in the lifecycle scripts. (The Chinese success string in the report quotes
  "前端依赖已安装"; the actual file says "前端依赖安装完成". This is a
  transcription nit, not an evidence defect.)

The cited evidence chain is therefore **airtight** and explains the
observed symptom: stale `node_modules/` after pulling `d82de4d`, plus a
`start.sh` that does not detect dependency drift.

No counter-explanation survives:

- It is not a registry / mirror problem — `package-lock.json` already pins
  the resolved tarball.
- It is not a TypeScript / module-resolution config problem — webpack's
  error is a Node module-resolution miss (filesystem lookup), not a
  TS-aliased path miss.
- It is not specific to production mode — dev mode would fail the same way
  at first request, because Next.js still has to resolve the dynamic import
  to chunk-split it. (The reporter only happened to hit the production
  build path.)

### 7.2 Candidate-fix audit

- **Fix A (docs only)** — does not prevent recurrence. Every future dep
  addition re-arms the same trap. Insufficient on its own.
- **Fix B (auto-install in `start.sh`)** — covers the reported symptom and
  any future occurrence. One **gap in the report's placement guidance**
  surfaced during review: the report says "insert before step `[3/5]`",
  but step `[3/5]` is wrapped in `if [ "$DEV_MODE" = false ] || [
  "$FORCE_REBUILD" = true ]` (`start.sh:287`). In dev mode the build is
  skipped and `npm run dev` runs at `start.sh:351` — and dev mode would
  fail identically (Next.js compiles the page on demand and still cannot
  resolve `html-to-image`). The install check must therefore sit
  **before that conditional** (i.e. between the `.next` freshness check at
  `start.sh:269-284` and the `if [ "$DEV_MODE" = false ]` branch at line
  287), so that both `--dev` and production starts are covered.
  Boundary cases:
  - Concurrency: two simultaneous `start.sh` invocations could race on
    `node_modules/`, but that is a pre-existing footgun in the script
    (parallel `.next` rebuilds would race the same way) and out of scope.
  - Offline machines: when `node_modules/` is fresh, the timestamp check
    short-circuits and no network call is made — so currently-working
    deployments stay working. Only stale trees attempt the install, which
    is the exact case the operator would have run by hand.
  - `npm ci` vs `npm install`: `npm ci` is the right call when the lockfile
    is in sync (faster, deterministic, wipes drift); fall back to
    `npm install` only if `npm ci` fails. The report's "(or `npm install`)"
    parenthetical already permits this.
- **Fix C (move install into deploy pipeline)** — does not help any operator
  who runs `start.sh` by hand, including the reporter. It is also a
  larger change that touches deployment infrastructure outside this repo
  (`dev/deploy_dev_*.py`, CI). Not minimal.

### 7.3 Final recommended fix

**Adopt Fix B**, with the placement correction above.

Specifically: insert a "Step 2.6: Sync Node dependencies" block in
`start.sh` between line 284 (end of `.next` freshness check) and line 286
(start of the build step), running:

1. If `node_modules/` does not exist → `npm ci` (fall back to
   `npm install` on failure).
2. Else if `package-lock.json` is newer than
   `node_modules/.package-lock.json` (or that file is missing) →
   `npm ci` (fall back to `npm install`).
3. Else → no-op.

Justification:

- **Minimum change that resolves the reported symptom.** The reporter's
  exact command (`./start.sh`) succeeds; no other code paths are touched.
- **Symmetric with the existing `.next` freshness check at
  `start.sh:269-284`.** Same script, same idiom (compare timestamp of a
  marker file produced by the toolchain), so future maintainers do not
  have to learn a new mental model.
- **Covers both dev and prod modes** thanks to the placement correction —
  closing the dev-mode gap implicit in the report's wording.
- **Low regression risk.** On fresh trees the check is a single `stat`
  call; on stale trees it runs the exact command the operator would have
  run anyway. Failure mode (no network) is the same as today's manual
  `npm install` failure.
- **Documentation pairing (Fix A) optional but cheap** — adding a one-line
  note to `CLAUDE.md` / `README.md` ("`start.sh` now auto-syncs Node deps;
  no need to remember `install.sh` between pulls") is a freebie. Fix C is
  not required and should be deferred unless / until a separate CI/CD
  initiative subsumes it.

The next node should implement Fix B at the placement specified above and
update operator-facing docs accordingly. No other files in this report's
scope require changes.
