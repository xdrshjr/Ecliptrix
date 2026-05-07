# Bug Analysis: `start.sh` auto-sync skips `npm ci` because the lockfile mtime check is a false negative under SFTP deploy

> Slug: `start-sh-npm-sync-mtime-false-negative`
> Reported: 2026-05-08 00:35:29 (dev server `kt@kt-NF5568M4`, working dir `~/tako/Ecliptrix`)
> Reporter command: `./start.sh` (production mode, port 3010)
> Symptom: `Module not found: Can't resolve 'html-to-image'`
>
> **Relationship to prior diagnosis.** The earlier report
> `docs/diagnoses/html-to-image-missing-on-build/analysis.md` (2026-05-07 23:40)
> identified that `start.sh` had no dependency-sync step at all. That was fixed
> in commit `0fbd757` ("fix(start): auto-sync node_modules when
> package-lock.json drifts"). The current failure occurs **after** that fix
> landed, with the *same surface symptom* but a different root cause: the new
> sync block at `start.sh:286-317` is in place yet does not fire. The
> recommendation in the prior report (Fix B) was implemented as written; this
> report explains why that implementation is insufficient on this server.

---

## 1. Problem description

`./start.sh` aborts during step `[3/5] Building Frontend` with the same
webpack module-resolution error reported on 2026-05-07:

```
./src/components/video/components/VideoCoverModal/hooks/useCoverRender.ts
Module not found: Can't resolve 'html-to-image'

Import trace for requested module:
./src/components/video/components/VideoCoverModal/VideoCoverModal.tsx
...
./src/app/page.tsx

> Build failed because of webpack errors
[ERROR] 2026-05-08 00:35:44 - Frontend build failed / 前端构建失败
```

What is **new** is what the log does *not* show. Between `[2/5] Checking
Database` and `[3/5] Building Frontend` there is no `Node dependencies out of
sync` warning and no `Running npm ci to sync dependencies` step. That output
is emitted by the new sync block (`start.sh:303-307`) only when
`NEED_NPM_INSTALL=true`. Its silence proves the block evaluated
`NEED_NPM_INSTALL` to `false` — i.e. the mtime drift check at
`start.sh:296` returned "in sync" even though `node_modules/` is missing
the recently-added `html-to-image` package.

---

## 2. Reproduction steps

The bug is environment-shaped: it requires the operator's deploy workflow
to set `package-lock.json`'s mtime to a value *older than* the server's last
`npm install` time. The deploy script in this repo
(`dev/deploy_dev_20260420.py`) does exactly that. Local reproduction below
recreates the same condition with `touch -d`.

### 2.1 Linux / dev-server reproduction (matches the actual failure)

Run on a Linux host (Node 22, npm 10, conda env `ecliptrix`) holding a
checkout that includes commits `d82de4d` (the cover feature) and `0fbd757`
(the auto-sync fix):

```bash
cd ~/tako/Ecliptrix

# Step 1 — simulate a previous successful install (creates the marker file
# with mtime = "now").
rm -rf node_modules
npm ci          # installs everything that the OLD package-lock.json had

# Step 2 — overwrite package-lock.json with a NEWER version (one that adds
# html-to-image), but stamp it with an OLDER mtime (mimicking what
# sftp.utime does in the deploy script — see deploy_dev_20260420.py:177,
# :203).
git checkout d82de4d -- package.json package-lock.json
touch -d "2026-05-07 01:49:12" package.json package-lock.json
# Confirm the trap:
ls -l --time-style=full-iso \
    package-lock.json node_modules/.package-lock.json

# Step 3 — simulate the operator running ./start.sh.
./start.sh
```

The script reaches `[3/5]`, runs `npm run build`, and fails with the
quoted `Module not found: Can't resolve 'html-to-image'`. No
`Running npm ci` line appears in the output — confirming the mtime check
did not fire.

### 2.2 Minimal repro (no shell wrapper)

```bash
# After step 1 above
ls -l package-lock.json node_modules/.package-lock.json
# package-lock.json: 2026-05-07 01:49 (older)
# node_modules/.package-lock.json: 2026-05-08 (newer)

# Drop in the NEW lockfile content with the OLDER mtime preserved
cp /path/to/new/package-lock.json package-lock.json
touch -d "2026-05-07 01:49:12" package-lock.json

# This mimics start.sh:296
if [ package-lock.json -nt node_modules/.package-lock.json ]; then
    echo "would install"
else
    echo "would skip"     # <-- this branch
fi
```

The `-nt` test returns false, so the start.sh sync block falls through
and the build runs against stale `node_modules/`.

### 2.3 Confirmed manual recovery

```bash
cd ~/tako/Ecliptrix
npm ci                  # or `npm install`
npm run build           # builds successfully
```

After this, `node_modules/.package-lock.json` mtime updates to "now" and
`node_modules/html-to-image/` exists. Subsequent `./start.sh` runs
succeed — until the next SFTP deploy re-creates the same mtime inversion.

---

## 3. Root cause analysis

### 3.1 The auto-sync block uses an mtime comparison

`start.sh:286-317` (the block added in commit `0fbd757`) decides whether to
run `npm ci` based purely on file modification times:

```bash
# ============ Step 2.6: Sync Node dependencies ============
NEED_NPM_INSTALL=false
NPM_INSTALL_REASON=""
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    NEED_NPM_INSTALL=true
    NPM_INSTALL_REASON="node_modules/ missing"
elif [ -f "$SCRIPT_DIR/package-lock.json" ]; then
    if [ ! -f "$SCRIPT_DIR/node_modules/.package-lock.json" ]; then
        NEED_NPM_INSTALL=true
        NPM_INSTALL_REASON="node_modules/.package-lock.json missing"
    elif [ "$SCRIPT_DIR/package-lock.json" -nt "$SCRIPT_DIR/node_modules/.package-lock.json" ]; then
        NEED_NPM_INSTALL=true
        NPM_INSTALL_REASON="package-lock.json newer than node_modules/.package-lock.json"
    fi
fi
```

The third branch — the only one that catches the "lockfile content drifted"
case once both files exist — relies on the assumption that
`package-lock.json`'s mtime monotonically advances every time its content is
updated by an upstream process. That assumption holds for `git
checkout`/`git pull` (which write files with mtime ≈ now) and for an
operator running `npm install` directly in-place. **It does not hold when
the file arrives over SFTP from the deploy script.**

### 3.2 The deploy script overwrites the remote mtime with the local mtime

`dev/deploy_dev_20260420.py` is the only documented path for getting code
onto this server (per memory: "192.168.1.123 ... no git on path — SFTP sync
+ paramiko only"). It uploads `package-lock.json` via the
`SYNC_FILES` list:

`dev/deploy_dev_20260420.py:44-60` declares `package-lock.json` as one of
the unconditionally-uploaded files.

`dev/deploy_dev_20260420.py:194-204` (the `upload_file` helper) is what
actually transfers it:

```python
def upload_file(sftp: paramiko.SFTPClient, local_rel: str) -> None:
    local_path = LOCAL_ROOT / local_rel
    if not local_path.exists():
        log(f"SKIP (missing): {local_rel}")
        return
    remote_path = posixpath.join(REMOTE_ROOT, local_rel)
    sftp_mkdir_p(sftp, posixpath.dirname(remote_path))
    sftp.put(str(local_path), remote_path)
    mt = int(local_path.stat().st_mtime)
    sftp.utime(remote_path, (mt, mt))                     # <-- here
    log(f"FILE: {local_rel}")
```

The `sftp.utime(remote_path, (mt, mt))` call (line 203) explicitly stamps
the remote file's mtime with the **local** file's mtime. The directory
mirror code does the same at `dev/deploy_dev_20260420.py:177`:

```python
sftp.put(str(p), remote_path)
sftp.utime(remote_path, (local_mtime, local_mtime))
```

So after deploy, the remote `package-lock.json` mtime equals the
mtime of the file on the developer's Windows workstation, **not** the
upload time.

### 3.3 The local mtime can easily predate the last server-side `npm install`

On the developer's workstation right now:

```
$ stat package-lock.json
  ...
  Modify: 2026-05-07 01:49:12.000000000 +0800
```

That timestamp is *before* commit `d82de4d`'s author date
(`Thu May 7 01:59:53 2026 +0800`) — Git on Windows preserved the
write time produced by `npm install` during the developer's local feature
work, ~10 minutes before the commit landed.

Meanwhile the server's `node_modules/.package-lock.json` mtime equals
"the last time `npm install`/`npm ci` finished on the server" (npm rewrites
this marker on success). Any prior successful install between
2026-05-07 01:49 and 2026-05-08 00:35 — including the one
`dev/deploy_dev_20260420.py:247-249` runs as part of every deploy
(`npm install --no-audit --no-fund --prefer-offline && npm run build`) —
will leave that marker with mtime > 2026-05-07 01:49.

So the end state on the server, when the operator next runs `./start.sh`,
is:

| File | mtime | Source |
|------|-------|--------|
| `package-lock.json` | 2026-05-07 01:49 | local mtime, copied via `sftp.utime` |
| `node_modules/.package-lock.json` | any time after that | last server-side `npm install` |

`[ package-lock.json -nt node_modules/.package-lock.json ]` returns
**false**, so `NEED_NPM_INSTALL` stays `false`, the sync block prints
nothing, and the build proceeds against stale `node_modules/`.

### 3.4 Why this *also* appears in the failure output as "no Step 2.6 logs"

`start.sh:286-300` only emits `warn`/`step` lines when
`NEED_NPM_INSTALL=true`:

```bash
if [ "$NEED_NPM_INSTALL" = true ]; then
    warn "Node dependencies out of sync ($NPM_INSTALL_REASON) / 前端依赖不同步"
    cd "$SCRIPT_DIR"
    step "Running npm ci to sync dependencies / 运行 npm ci 同步依赖..."
    ...
fi
```

So a perfectly-fresh tree and a *false-negative* tree look identical from
the log: both jump straight from `[2/5]` to `[3/5]`. The reporter's
transcript shows exactly that gap, which by elimination tells us the
check fired and answered "in sync" — i.e. the false-negative path. No
other branch of the script can produce the observed log.

### 3.5 Why the dynamic `import('html-to-image')` does not protect us

`useCoverRender.ts:54` uses a dynamic `await import('html-to-image')`.
Next.js / webpack still resolves the specifier at build time so it can
emit the lazy chunk. With the package missing from `node_modules/`, the
resolver throws `Module not found` during `next build`. (This was already
established in §3.3 of the prior report and re-verified here — nothing
about the fix in `0fbd757` changed that.)

### 3.6 Evidence summary

| Evidence | What it shows |
|----------|---------------|
| Build log `Module not found: Can't resolve 'html-to-image'` (task prompt) | Webpack cannot resolve the package on disk. |
| Failure log shows `[2/5]` → `[3/5]` with no Step 2.6 lines | The new sync block at `start.sh:286-317` evaluated `NEED_NPM_INSTALL=false`. |
| `start.sh:296` — `[ package-lock.json -nt node_modules/.package-lock.json ]` | The drift detector is mtime-only, not content-based. |
| `dev/deploy_dev_20260420.py:177` and `:203` — `sftp.utime(..., (mt, mt))` | Deploy preserves the **local** mtime on the remote, breaking the assumption that mtime advances on every content change. |
| Local `stat package-lock.json` → `Modify: 2026-05-07 01:49:12` | Local mtime is 10 min before commit `d82de4d`'s author date, and ~22 hours before the failing run. Older than any plausible server-side `npm install` time on 2026-05-07. |
| `package.json:31` lists `"html-to-image": "^1.11.13"` | Dependency is correctly declared in source; the bug is install-side, not source-side. |
| Memory note `reference_dev_server.md` — "no git on path — SFTP sync + paramiko only" | The deploy path that triggers the mtime bug is the *only* code-sync path on this server. |

**Conclusion**: the `start.sh` auto-sync added in `0fbd757` uses an mtime
comparison whose precondition (mtime advances on each content change)
is violated by this repo's only deploy path. The result is a silent
false negative: the script believes `node_modules/` is in sync,
runs `npm run build`, and fails on the first newly-added dependency
(currently `html-to-image`; any future new dep will reproduce this).
This is a defect in the sync check, not a defect in
`html-to-image` or the cover feature.

---

## 4. Impact surface

- **Affected feature**: every Next.js page that statically reaches a
  module importing a dependency added since the last successful
  server-side `npm install`. Today that is `html-to-image` via
  `useCoverRender.ts` → `VideoCoverModal` → `VideoPlayerPanel` →
  `VideoEditorContainer` → `Container` → `src/app/page.tsx`. So the
  build fails *globally*, not just for the cover feature.
- **Affected environments**:
  - **Dev server `kt@kt-NF5568M4` (192.168.1.123)** — observed. The
    `dev/deploy_dev_*.py` workflow always reproduces the mtime
    inversion on the next `./start.sh`.
  - **Singapore-01 production server (47.245.126.128)** — at risk. Per
    memory `project_deploy_env_footgun.md`, the production deploy is a
    tarball extract that "reverts prod's BACKEND_URL every time".
    Tarball extraction (`tar -x` without `-m`) restores file mtimes
    from the archive, so the same false-negative pattern applies if
    `start.sh` is the entrypoint there. (Note: the deploy_dev script
    also runs `npm install` itself at line 247 before `npm run build`,
    which masks the bug *during the deploy itself*. The trap fires the
    *next* time someone calls `./start.sh` directly without redeploying
    — which is exactly the reporter's scenario.)
  - **Any future operator** who edits the repo on machine A, syncs to
    machine B with mtime preservation (rsync `-a`, `scp -p`, the
    paramiko script, tar restoration), and then runs `./start.sh` on
    machine B.
- **Severity**: High for any operator on the upgrade path — the app
  cannot start at all until deps are installed manually. Independent of
  whether the operator remembered to redeploy, because the bug is in
  the *startup* path, not the deploy path.
- **Data / runtime risk**: none. `start.sh` aborts cleanly via its
  `handle_error` trap; backend and frontend services are not left in a
  half-running state.
- **Recurrence cadence**: every time a new npm dependency lands in
  `package.json` / `package-lock.json` between two `./start.sh`
  invocations. The 2026-05-07 / 2026-05-08 incidents are the first
  two known cases, with `html-to-image` as the trigger both times.

---

## 5. Candidate fixes

| # | Fix | Where | Invasiveness | Risk | Effort | Notes |
|---|------|-------|--------------|------|--------|-------|
| A | **Replace mtime check with content comparison.** Use `cmp -s package-lock.json node_modules/.package-lock.json` (npm 7+ writes the marker as a verbatim copy of the lockfile). Differing content → run `npm ci` (fall back to `npm install`). | `start.sh:296` (replace the `-nt` test) | Small (~3 lines) | Very low — `cmp -s` is a trivial reads-and-compares; both files are <1 MB. Robust against any mtime semantics. | ~5 min | Solves the exact failure mode. Same idiom as the rest of the script (no new tools). |
| B | **Always run `npm ci` before build.** Drop the drift detection entirely. | `start.sh:286-317` (simplify) | Medium (rewrites the whole block) | Medium — `npm ci` deletes and re-creates `node_modules/` every time, costing ~20-60 s on the dev server even when nothing changed. Also fails hard offline; today's check short-circuits in that case. | ~10 min | Bulletproof but slow. Inconsistent with the existing `[Step 2.5]` `.next` freshness short-circuit, which deliberately avoids unnecessary work. |
| C | **Stop preserving local mtimes in the deploy script.** Remove the `sftp.utime(...)` calls in `dev/deploy_dev_20260420.py:177` and `:203`. Remote files then take "now" as their mtime, restoring the assumption start.sh relies on. | `dev/deploy_dev_20260420.py` (2 lines) | Small | Medium — also breaks the script's own "skip-if-unchanged" optimisation at line 170 (`int(remote_attr.st_mtime) >= local_mtime`), because freshly-uploaded files would always look "newer" than local ones and hence never get skipped. Would need a redesign of the skip logic (size + content hash, not mtime). And it leaves the *trap* in `start.sh` for any other deploy mechanism (tarball, rsync `-a`, scp `-p`). | ~30 min + redesign | Treats the symptom in one tool while leaving the underlying fragility in `start.sh`. Does not protect prod (tarball deploy) or future contributors. |
| D | **Always run `npm install --prefer-offline --no-audit --no-fund`** unconditionally before build. Idempotent on a fresh tree (no rebuild of `node_modules/`), only installs what's missing. | `start.sh:286-317` (simplify) | Medium | Low — `npm install` on a fresh tree is fast (~3-5 s on this hardware). Slightly less deterministic than `npm ci`. | ~10 min | Compromise between A and B. Loses the "0 ms" no-op of the current check on a fresh tree, but cheaper than B. |

Fixes A and C address different layers — A makes the startup script
robust to *any* mtime-perturbing transport; C only patches the one tool
that the team currently uses. They can coexist (defense in depth), but
A alone resolves the reported failure for every transport (SFTP, rsync,
tar, scp, future tooling).

---

## 6. Recommended fix

**Adopt Fix A** — replace the mtime comparison at `start.sh:296` with a
content comparison.

Concretely, the third branch of the existing block becomes:

```bash
elif ! cmp -s "$SCRIPT_DIR/package-lock.json" "$SCRIPT_DIR/node_modules/.package-lock.json"; then
    NEED_NPM_INSTALL=true
    NPM_INSTALL_REASON="package-lock.json content differs from node_modules/.package-lock.json"
fi
```

(The existing two earlier branches — `node_modules/` missing and
`node_modules/.package-lock.json` missing — stay as-is; both already
short-circuit before the comparison.)

Justification:

- **Fixes the reported symptom directly.** The reporter's exact command
  (`./start.sh`) would have detected the drifted `package-lock.json`,
  run `npm ci`, installed `html-to-image`, and built successfully —
  *regardless* of how the file arrived on the server.
- **Robust against every code-sync mechanism**, not just the current
  paramiko script. Tarball deploys on the Singapore-01 production box
  (per memory `reference_singapore_01_server.md` and
  `project_deploy_env_footgun.md`) get the same protection for free.
  Future deploy tooling (rsync, scp -p, manual tar) cannot reintroduce
  the bug.
- **Symmetric with `npm` itself.** npm 7+ writes
  `node_modules/.package-lock.json` as a literal copy of
  `package-lock.json`; the script is now asking the same question npm
  does internally ("did the lockfile contents change?"), instead of a
  proxy question that only correlates by accident.
- **Minimal change.** One line modified, no new tooling. `cmp -s` is in
  every POSIX environment the script targets (Linux dev server, macOS,
  Git-Bash on Windows).
- **Low risk on the fast path.** On an in-sync tree, `cmp -s` reads
  ~488 KB twice — single-digit milliseconds. Negligible compared to the
  multi-second `npm run build` that follows. On a stale tree, it does
  exactly what the operator would have done by hand.
- **Better diagnostic message.** The reason string changes from
  "package-lock.json newer than ..." (which is misleading when mtime
  is the same or older but content differs) to "package-lock.json
  content differs from ..." — helping the next debugger.
- **Pairs with Fix C if desired.** Fixing the deploy script's
  `sftp.utime` calls is still a worthwhile cleanup for unrelated
  reasons (the skip-if-unchanged optimisation needs a content-hash
  rewrite anyway), but it is no longer load-bearing once Fix A is in
  place. Defer Fix C to a separate task.

Out of scope for this report (per the diagnosis-only constraint, no fix
code is being written here): the actual one-line bash edit in
`start.sh`, any documentation update, and the optional follow-up to
`dev/deploy_dev_20260420.py`.

---

## 7. Open questions for the implementer

- **Marker file format on older npm.** This report assumes npm 7+ (the
  reporter is on npm 10.9.3, confirmed in the failure log
  `[OK] npm 10.9.3`). On npm 6 the marker file does not exist — but the
  existing branch at `start.sh:293-295` already covers that case
  ("`node_modules/.package-lock.json` missing → install"), so Fix A
  composes correctly.
- **Whitespace-only drift.** `cmp -s` is byte-for-byte. If npm ever
  rewrites the marker with normalised whitespace (it does not, as of
  npm 10), the script would over-trigger `npm ci`. Acceptable failure
  mode (false positive runs an idempotent install) and far preferable
  to the current false negative (skips a needed install).
- **Concurrency.** Two simultaneous `start.sh` invocations could race
  on `node_modules/` during the `npm ci` step. This is a pre-existing
  footgun (the same race exists for parallel `.next` rebuilds at
  `start.sh:269-284`) and out of scope for this report.

---

## 8. 评审结论 (Review Verdict)

### 8.1 Audit results — what holds up

The root-cause chain is **correct and re-verified** against the working
tree:

| Claim in the report | Audit result |
|---|---|
| `start.sh:286-317` is the new sync block, `:296` is the `-nt` test | ✅ confirmed verbatim |
| `dev/deploy_dev_20260420.py:177` and `:203` call `sftp.utime((mt, mt))` | ✅ confirmed verbatim |
| `dev/deploy_dev_20260420.py:44-60` declares `package-lock.json` in `SYNC_FILES` | ✅ confirmed (line 46) |
| Local `package-lock.json` mtime is `2026-05-07 01:49:12` | ✅ confirmed via `Get-Item .LastWriteTime` |
| Commit `d82de4d` author date is `2026-05-07 01:59:53 +0800` | ✅ confirmed via `git log`; mtime predates commit by ~10 min |
| `package.json:31` declares `"html-to-image": "^1.11.13"` | ✅ confirmed |
| `useCoverRender.ts:54` does `await import('html-to-image')` (dynamic but build-resolved) | ✅ confirmed |
| The "[2/5] → [3/5] with no Step 2.6 lines" log shape can only come from the false-negative branch | ✅ confirmed: §3.4's elimination argument is sound — none of the other branches in `start.sh:286-300` exit silently |

### 8.2 Audit results — what is broken

> ⚠️ The original report's **Fix A** (use
> `cmp -s package-lock.json node_modules/.package-lock.json`) is
> empirically false on this codebase, and a literal implementation of it
> would regress the script to "always run npm ci".

The §5/§6 justification asserts that "npm 7+ writes the marker as a
verbatim copy of the lockfile" / "npm 7+ writes
`node_modules/.package-lock.json` as a literal copy of
`package-lock.json`". Direct measurement on a fresh tree (npm 10.9.3,
the same version on the failing host per the failure log) refutes this:

```
$ ls -l package-lock.json node_modules/.package-lock.json
-rw-r--r-- 488,177 bytes  May  7 01:49  package-lock.json
-rw-r--r-- 445,924 bytes  May  7 01:49  node_modules/.package-lock.json

$ cmp -s package-lock.json node_modules/.package-lock.json && \
    echo IDENTICAL || echo DIFFER
DIFFER

$ grep -c '^    "":'                   package-lock.json
1                                                               # root project entry
$ grep -c '^    "":'                   node_modules/.package-lock.json
0                                                               # NO root entry

$ grep -c '"node_modules/'             package-lock.json                  # 922
$ grep -c '"node_modules/'             node_modules/.package-lock.json    # 849
```

The hidden lockfile is generated by npm/Arborist's `_loadActual` walk of
`node_modules/`. By design it omits the root project's package metadata
(the `""` key — name, version, license, declared
dependencies/devDependencies) and only describes packages physically
present under `node_modules/`. Even immediately after a clean
`npm ci` the two files differ by tens of KB and dozens of entries.

**Consequence:** had the next node implemented the original Fix A
verbatim, every `./start.sh` invocation — even on a perfectly-synced
tree — would set `NEED_NPM_INSTALL=true` and run `npm ci`. That is
functionally equivalent to Fix B, which the report itself rejected as
too slow (~20-60 s on the dev server). The logged reason string would
also be misleading (it would always read
"package-lock.json content differs from ...").

### 8.3 Recommended fix (single, final)

**Hash-sentinel variant of the content-comparison approach.** Replace
the mtime test at `start.sh:296` with a comparison between the current
content hash of `package-lock.json` and a sentinel file written *by
`start.sh` itself* on the previous successful install. The sentinel
lives inside `node_modules/` so it is naturally invalidated whenever
`node_modules/` is rebuilt or removed.

Contract for the implementing node (no code written here per task
constraint):

1. **At `start.sh:296`** (replacing the `-nt` branch — the two earlier
   branches at `:289-295` stay as-is):
   - if `node_modules/.start-sh-lock-hash` does not exist, **or**
   - if its content does not match
     `sha256sum < package-lock.json | awk '{print $1}'`,
   - then set `NEED_NPM_INSTALL=true` and
     `NPM_INSTALL_REASON="package-lock.json content differs from last successful install"`.
2. **In the install-success arms at `start.sh:307` and `start.sh:311`**
   (after the `success` log line, only on the success path):
   - write the sha256 of `package-lock.json` into
     `node_modules/.start-sh-lock-hash`.
3. The two existing earlier branches (`node_modules/` missing,
   `node_modules/.package-lock.json` missing) remain — they correctly
   short-circuit without consulting the sentinel.

Justification — why this dominates every other option:

- **Closes the actual bug under every transport.** The hash is a pure
  function of `package-lock.json`'s bytes; mtime semantics of the
  underlying transport (SFTP-with-utime, tarball restore, rsync -a,
  scp -p, Windows-Git) cannot perturb it. The reporter's exact failure
  scenario would have triggered `npm ci`, installed `html-to-image`,
  and built successfully.
- **Works on a clean tree** — unlike the cmp-based variant. The sentinel
  is written *by start.sh* immediately after a known-good install, so
  when present its content is by construction the hash of whatever
  lockfile was actually installed.
- **Preserves the fast-path no-op.** sha256 of a 488 KB file is well
  under 10 ms on this hardware — same order of magnitude as the
  current `-nt` test.
- **Minimal change.** ~5 lines: one hash-comparison branch, two
  sentinel-write lines (one in each success arm). No new dependencies
  (`sha256sum` ships with coreutils on the dev server, the prod
  Singapore-01 box, macOS dev machines, and Git-Bash on Windows).
- **Self-healing.** A missing or corrupted sentinel triggers one extra
  `npm ci` — safe, idempotent. A concurrency race on the sentinel is
  bounded by the existing race on `node_modules/` itself and not made
  worse.
- **Better diagnostic.** The reason string accurately describes the
  observed condition ("content differs from last install") rather than
  the misleading mtime-flavored string the original block emits.

Why not the report's other candidates:

- **Original Fix A (`cmp -s` against the hidden lockfile)** — fails the
  precondition empirically; see §8.2. Would over-trigger every run.
- **Fix B (unconditional `npm ci`)** — slow (~20-60 s wasted per
  startup) and inconsistent with the existing "skip-if-fresh"
  optimisation at `start.sh:269-284`.
- **Fix C (drop `sftp.utime` in `dev/deploy_dev_20260420.py`)** —
  patches only the dev SFTP transport; leaves the trap in place for
  the prod tarball deploy (per memory `project_deploy_env_footgun.md`,
  prod is tarball-based) and for any future tooling. Also breaks the
  deploy script's own size+mtime "skip-if-unchanged" optimisation at
  `dev/deploy_dev_20260420.py:170`. Worth doing as a separate cleanup
  but **not load-bearing** once the start.sh fix is in.
- **Fix D (unconditional `npm install --prefer-offline`)** — viable
  fallback if the team prefers fewer moving parts than a sentinel
  file, but loses the no-op fast path and slightly less deterministic
  than `npm ci`.

### 8.4 Out of scope for the implementing node

- The actual bash edits (per task constraint).
- Any change to `dev/deploy_dev_20260420.py` (separate task; defer).
- `.next` cache-freshness logic at `start.sh:269-284` (orthogonal).
- Concurrency hardening of `node_modules/` against parallel
  `start.sh` invocations (pre-existing).
