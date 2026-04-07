# Unified API & Auth Refactor — Production Deployment Runbook

> **Target:** Singapore-01 (`47.245.126.128`, root) — frontend `:3088`, backend `:8088`
> **PR:** unified-api-auth-refactor (8 specs, T01-T08)
> **Risk class:** HIGH (atomic single-PR migration that touches every backend HTTP request and every frontend HTTP call site)
> **Owner of this runbook:** human deploy operator + on-call engineer
> **Spec:** [`specs/08-deployment-rollout.md`](specs/08-deployment-rollout.md)
> **Last updated:** 2026-04-07

---

## 0. What this deploy ships

A single atomic PR that:

1. **Backend** — registers `SessionAuthMiddleware` in `app/main.py` so every non-allowlisted request must carry a valid `Authorization: Bearer <token>` (or `x-session-token`) header. Returns 401 otherwise. Allowlist (10 paths) covers `/api/auth/login`, `/api/auth/register`, `/api/auth/validate-session`, `/api/health`, `/api/health/`, `/docs`, `/redoc`, `/openapi.json`, `/static/`, `/api/storage/files/`.
2. **Frontend (Next.js BFF)** — collapses 3 backend-URL env var names (`BACKEND_URL`, `BACKEND_SERVICE_URL`, `PYTHON_BACKEND_URL`) into the single canonical `BACKEND_URL`, read once at boot via the new `src/lib/config/backend.ts` module (fails fast if unset). 81 of 95 `route.ts` files refactored to the new `createPassthroughRoute` helper. Net **-6614 LoC**.
3. **Frontend (lib/api clients)** — all 12 existing typed clients + 2 new typed clients (`auth.ts`, `workflowPreferences.ts`) consume `src/lib/api/http-client.ts`, which auto-injects `Authorization`, debounces parallel 401s into a single redirect to `/login?reason=session-expired`, and exposes typed errors.
4. **Frontend (browser direct calls)** — 3 files that previously used `NEXT_PUBLIC_BACKEND_URL` / `NEXT_PUBLIC_API_BASE_URL` to call the backend directly are migrated to BFF proxy routes. Both `NEXT_PUBLIC_*` env vars are removed.
5. **`/login` page** — new at `src/app/login/page.tsx`; the wrapper's `redirect /login?reason=session-expired` no longer 404s.
6. **Tests** — Vitest 4.1.3 installed, **22 files / 150 tests / 0 failures**, plus **19 backend pytest cases / 98% middleware coverage**.
7. **Smoke script** — `scripts/smoke-api-auth.sh` exercises 10 allowlist + 24 protected + 6 auth-OK endpoints.

**No DB migrations. No infra changes. No new secrets.**

---

## 1. Pre-flight checklist

**The operator must check every box BEFORE running any command in §3 below.** Print this section, copy it to a local notes file, or check the boxes inline. Do NOT skip a single item.

```markdown
## Pre-flight (operator ticks each box)

- [ ] PR is merged to `main` and the merge commit SHA is recorded:
        MERGE_SHA=__________________________
- [ ] Local validation against the merge commit (no CI yet — run locally on the merge SHA):
      - [ ] `npm test` exits 0 (expected: 22 files / 150 tests / 0 failures)
      - [ ] `npm run type-check` exits 0
      - [ ] `BACKEND_URL=http://localhost:8088 npm run build` exits 0 (expected: 95 routes built including `/login`)
      - [ ] `cd backend-services/basic-service && python -m pytest tests/test_auth_middleware.py -v` exits 0 (expected: 19 passed)
      - [ ] `bash -n scripts/smoke-api-auth.sh` exits 0
      - [ ] `bash scripts/preflight.sh --full` exits 0 (the bundled sanity-check script runs all **5** grep guards including the Phase 3.6 hardened G5 guard, plus required-file existence, middleware registration, smoke script syntax, env.template cleanup, and the full test+build suite). **G5 widens the original AC#3 grep to all of `src/`, not just `src/lib/api/` — this catches the 31-component-fetch-bypass class of bug that was found on the dev server on 2026-04-07.**
- [ ] Singapore-01 is healthy RIGHT NOW (run from local machine):
      `curl -fsS https://ecliptrix.com/api/health`
      Expected: `{"success":true, ... }`
- [ ] No concurrent deploy in flight on Singapore-01:
      `ssh root@47.245.126.128 'systemctl is-active ecliptrix-backend.service ecliptrix-frontend.service'`
      Expected: both lines print `active`
- [ ] Current production HEAD is recorded (for rollback reference):
        PROD_PRE_SHA=__________________________
        Get it with: `ssh root@47.245.126.128 'git -C /root/ecliptrix rev-parse HEAD'`
- [ ] Dry-run was completed against the dev server (192.168.1.7) within the last 24h, result: PASS
        (See §11 for the dry-run procedure.)
- [ ] No active merge freeze (verify in team chat or wiki)
- [ ] Smoke credentials are available locally:
        `export SMOKE_USER='<real-user>'`
        `export SMOKE_PASS='<real-pass>'`
- [ ] Maintenance window communicated to users if applicable
- [ ] On-call engineer is aware and reachable
- [ ] Operator has the rollback procedure (§7) open in another tab

ONLY when EVERY box above is checked, proceed to §2.
```

---

## 2. The `.env` migration diff

The runbook ships exactly **one** edit to `/root/ecliptrix/.env` on Singapore-01. Apply this diff verbatim:

```diff
# /root/ecliptrix/.env  (frontend env loaded by ecliptrix-frontend.service)

- BACKEND_SERVICE_URL=http://localhost:8088
- PYTHON_BACKEND_URL=http://localhost:8088
- NEXT_PUBLIC_BACKEND_URL=https://ecliptrix.com
- NEXT_PUBLIC_API_BASE_URL=https://ecliptrix.com
  BACKEND_URL=http://localhost:8088     # unchanged — surviving canonical var

# Other vars (LLM_API_URL, LLM_API_KEY, FAST_LLM_*, ARK_API_KEY, OSS_*, etc.)
# remain UNCHANGED. Do not touch them.
```

**Important properties of this diff:**

1. `BACKEND_URL=http://localhost:8088` is already set on Singapore-01 from the 2026-04-07 :8000→:8088 incident. Verify it; do not re-add.
2. The 4 deprecated lines may not all exist on the current production `.env` — only remove the ones that exist. `grep` first, then `sed`/`$EDITOR`.
3. The backend's own `.env` at `/root/ecliptrix/backend-services/basic-service/.env` is NOT touched. The backend does not read any of these variables.
4. After the edit, the verification grep below MUST return exactly **one line** (the surviving `BACKEND_URL`).

```bash
# Verification (must print exactly ONE line — the surviving BACKEND_URL)
grep -n 'BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL\|NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL' /root/ecliptrix/.env
# Expected output (exactly one line):
#   N:BACKEND_URL=http://localhost:8088
# where N is the current line number.
```

If the grep prints zero lines, `BACKEND_URL` is missing — the Next.js server WILL refuse to start (per `src/lib/config/backend.ts` fail-fast contract from S02). ADD THE LINE before continuing.

If the grep prints more than one line, one of the deprecated names was not removed. Re-run the edit.

---

## 3. Deployment sequence

Run these commands in order, in a single SSH session, on Singapore-01. Do NOT run them in parallel. Do NOT skip the wait loops.

```bash
# Step 1 — connect
ssh root@47.245.126.128

# Step 2 — pull latest main
cd /root/ecliptrix
git fetch origin main
git checkout main
git pull --ff-only origin main
NEW_SHA=$(git rev-parse HEAD)
echo "Deploying SHA: $NEW_SHA"
# Sanity: $NEW_SHA must equal MERGE_SHA from §1. If not, abort.

# Step 3 — backup the current .env
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
cp /root/ecliptrix/.env /root/ecliptrix/.env.backup-${TIMESTAMP}
echo "Backed up .env to .env.backup-${TIMESTAMP}"

# Step 4 — apply the env diff (manual edit)
$EDITOR /root/ecliptrix/.env
# Apply the diff from §2: remove the 4 deprecated lines, keep BACKEND_URL=http://localhost:8088.
# Save and exit.

# Step 5 — verify the env diff applied (MUST print exactly ONE line)
grep -n 'BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL\|NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL' /root/ecliptrix/.env
# Expected: exactly 1 line: "BACKEND_URL=http://localhost:8088"

# Step 6 — run the existing deploy script
# This handles: backup snapshot, npm install, NODE_OPTIONS=--max-old-space-size=4096 npm run build,
# install systemd units, restart backend (90s readiness), restart frontend (60s readiness),
# restart watchdog timer.
sudo bash ops/deploy.sh

# Step 7 — wait for systemd to settle (poll loop, 60s ceiling)
for i in $(seq 1 30); do
  if systemctl is-active --quiet ecliptrix-backend.service \
     && systemctl is-active --quiet ecliptrix-frontend.service; then
    echo "Both services active after ${i} polls"
    break
  fi
  sleep 2
done

# If the loop completes without printing "Both services active":
#   journalctl -u ecliptrix-backend.service --since "5 minutes ago" | tail -50
#   journalctl -u ecliptrix-frontend.service --since "5 minutes ago" | tail -50
# Look for `BACKEND_URL is required` (S02 fail-fast) or `FATAL` lines.
# If genuine failure → §7 Rollback.

# Step 8 — local backend health check (from the production server)
curl -fsS https://ecliptrix.com/api/health
# Expected: {"success":true,"message":"Healthy",...}

# Step 9 — frontend health check (from the production server)
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' https://ecliptrix.com/
# Expected: HTTP 200
```

**The existing `ops/deploy.sh` script is REUSED unchanged.** This refactor introduces ZERO changes to deploy infrastructure — only application code and one env var diff.

**Checkpoint:** Steps 1-9 complete. Both services `active`. `/api/health` returns 200. Frontend root returns 200.

If ANY check above fails → §7 Rollback IMMEDIATELY. Do not attempt forward fixes inside the deploy window.

---

## 4. Verification sequence (V1-V4)

Run these from a **local machine** (NOT from Singapore-01). The smoke script targets `https://ecliptrix.com` over the public internet — that exercises Cloudflare + Nginx + the new auth middleware in one shot.

### V1 — Smoke script

```bash
cd ~/dev/ecliptrix     # or wherever the local repo is checked out

# Credentials must be set BEFORE running.
# (`:?...` makes bash refuse to run with empty values — defensive.)
SMOKE_USER="${SMOKE_USER:?SMOKE_USER must be set first}" \
SMOKE_PASS="${SMOKE_PASS:?SMOKE_PASS must be set first}" \
bash scripts/smoke-api-auth.sh https://ecliptrix.com

# Expected output (last lines):
#   Passed:  N
#   Failed:  0
#   Skipped: 0
#   All checks passed.
# Exit code: 0
```

The smoke script runs three phases:

| Phase | What | Expected |
|---|---|---|
| 1 | Anonymous calls to allowlisted endpoints (login, validate-session) | Non-401 (200/422/4xx but not 401) |
| 2 | Anonymous calls to 24 protected endpoints | All 401 |
| 3 | Authenticated calls to 6 GET endpoints (using SMOKE_USER/SMOKE_PASS to log in first) | All non-401, non-403 |

**If any phase reports a failure, capture the output verbatim and either rollback (§7) or — only if the failure is obvious, single-endpoint, and <10 LoC — hot-fix forward.**

### V2 — Manual browser checks

Open `https://ecliptrix.com` in a fresh browser window (use incognito to ensure no stale tokens):

```markdown
- [ ] Landing page loads, no console errors, no 401s in DevTools > Network
- [ ] Login with a real account succeeds (token captured into localStorage)
- [ ] Open the video editor — videos/timeline load
- [ ] Model selector populates (was a NEXT_PUBLIC_* direct call before — now BFF)
- [ ] Intent detection runs on a sample chat input (was direct call — now BFF)
- [ ] Audio transcription works on a small test file (was direct call — now BFF)
- [ ] Logout — user is redirected, localStorage is cleared
- [ ] Try to navigate back to a protected page after logout — observe redirect to /login?reason=session-expired (the new Phase 4.5 page renders, not a 404)
- [ ] In another tab, revoke the session via DB (or wait for force-logout from another device) — verify the open tab redirects to /login on the next API call
```

If any item fails, capture a screenshot + the relevant DevTools network trace and either rollback (§7) or hot-fix.

### V3 — Watchdog & backend log review

```bash
# From local machine, query Singapore-01:
ssh root@47.245.126.128 'journalctl -u ecliptrix-watchdog.service --since "5 minutes ago" | grep -i error || echo "No watchdog errors"'

ssh root@47.245.126.128 'journalctl -u ecliptrix-backend.service --since "5 minutes ago" | grep -iE "error|traceback|critical" || echo "No backend errors"'

ssh root@47.245.126.128 'journalctl -u ecliptrix-frontend.service --since "5 minutes ago" | grep -iE "error|fatal" || echo "No frontend errors"'
```

Expected: each command prints `No * errors` or trivial benign warnings.

### V4 — Record results

Open `docs/plans/unified-api-auth-refactor/audit/deployment-audit.md` and fill in:

- Production deploy timestamp (UTC)
- Deploying SHA = `$NEW_SHA`
- Smoke script counts: Passed / Failed / Skipped
- V2 manual check results (per-item PASS/FAIL)
- V3 log review summary
- Anomalies, if any
- Operator name + handoff notes

---

## 5. Success criteria for the deploy

The deploy is **declared successful** when ALL of:

1. `ops/deploy.sh` exits 0 with both `OK 后端健康` and `OK 前端健康` lines
2. `curl https://ecliptrix.com/api/health` returns 200 with `{"success":true}`
3. `curl -o /dev/null -w '%{http_code}' https://ecliptrix.com/` returns 200
4. Smoke script (`scripts/smoke-api-auth.sh https://ecliptrix.com`) exits 0 with **0 failed**
5. All 9 V2 manual checks PASS
6. V3 log review shows no errors in the last 5 minutes
7. The deployment-audit.md (§4 V4) is filled in

If 1-7 all hold, mark the deploy `SUCCESS` and proceed to §6 (24h monitoring). Otherwise, §7 Rollback.

---

## 6. Post-deploy 24h monitoring

The deploy is not declared **STABLE** until 24h pass without anomalies. The 24h monitoring is the operator's responsibility. The first hour is the highest-risk window.

```markdown
## 24h monitoring schedule

- [ ] T+0:00 — deploy completes, V1-V4 PASS, audit recorded
- [ ] T+0:15 — `ssh root@47.245.126.128 'journalctl -u ecliptrix-watchdog --since "15 minutes ago" | tail -50'`
              Look for: any `[FAIL]`, any `[RESTART]`, any unexpected restart
- [ ] T+0:30 — same check, plus `journalctl -u ecliptrix-backend --since "30 minutes ago" | grep -iE 'error|traceback'`
- [ ] T+0:45 — same checks
- [ ] T+1:00 — same checks + `curl -fsS https://ecliptrix.com/api/health`
              + sanity grep on any user complaints in support channels
- [ ] T+2:00 — spot check: watchdog log + health curl
- [ ] T+6:00 — spot check: watchdog log + backend traceback grep + frontend error grep
- [ ] T+24:00 — final review:
              - `journalctl -u ecliptrix-watchdog --since "24 hours ago" | grep -iE 'ERROR|CRITICAL|401|500'`
              - `journalctl -u ecliptrix-backend --since "24 hours ago" | grep -i traceback`
              - `journalctl -u ecliptrix-frontend --since "24 hours ago" | grep -iE 'error|warn'`
              - Re-run smoke script: `bash scripts/smoke-api-auth.sh https://ecliptrix.com`
                Expected: still 0 failed
              - Verify zero user complaints in support channels
- [ ] If T+24:00 review is clean → mark deployment STABLE in audit
- [ ] If anomalies appear at any checkpoint → triage; rollback (§7) if critical
```

Anomalies that justify immediate rollback:
- Repeated 401s on previously-working endpoints
- Watchdog log shows `[RESTART]` (indicates a hard service failure)
- 5xx rate above baseline
- User complaints about login/logout/auth flow
- Memory usage climbing (potential leak from middleware DB lookup)

Anomalies that DO NOT require rollback:
- A single 5xx on a third-party LLM endpoint (likely upstream issue)
- A pre-existing test warning that surfaces in logs
- Cosmetic issues in the new `/login` page (hot-fix forward)

---

## 7. Rollback procedure (R1-R7)

**When to roll back:**
- Smoke script reports any failures and the cause is not obviously a 1-line fix
- A V2 manual check fails (login broken, video editor broken, etc.)
- Watchdog log fills with `[RESTART]`
- The backend or frontend systemd unit refuses to come up
- ANY user-reported regression in the first 60 minutes

**When NOT to roll back:**
- Single endpoint returns 5xx and the cause is a 5-line typo → hot-fix forward
- A non-critical lint warning surfaces → ignore for now, file follow-up

The rollback is intentionally MANUAL (not automated). A human verifies the failure is real before the revert lands.

```bash
ssh root@47.245.126.128
cd /root/ecliptrix

# ============================================================
# Step R1 — restore the .env backup
# ============================================================
# Find the backup created in §3 step 3:
ls -t /root/ecliptrix/.env.backup-* | head -1
# Copy the most recent one back over .env:
LATEST_BACKUP=$(ls -t /root/ecliptrix/.env.backup-* | head -1)
cp "$LATEST_BACKUP" /root/ecliptrix/.env
echo "Restored .env from $LATEST_BACKUP"

# ============================================================
# Step R2 — revert the merge commit (preferred path)
# ============================================================
# Find the merge commit (it should be the most recent):
git log --oneline -5
# Identify the unified-api-auth-refactor merge commit. Note its SHA.

# Revert it (preserves history, generates a new commit):
git revert -m 1 <merge-commit-sha> --no-edit
# `-m 1` selects the first parent (main) — required for merge commits.

# Push the revert to main so future deploys/pulls stay consistent:
git push origin main
# If push is rejected (someone else pushed in between), pull --rebase first
# and re-push. Do NOT force push to main.

# ============================================================
# Step R3 — redeploy with the reverted code
# ============================================================
# `ops/deploy.sh` will git-pull (which fast-forwards to the revert commit),
# rebuild, and restart everything. This is the canonical "go back to known-
# good" path.
sudo bash ops/deploy.sh

# ============================================================
# Step R3' — ALTERNATIVE: backup-based local rollback (no remote push)
# ============================================================
# If you do NOT want to push to the remote yet (e.g., the revert needs to
# be reviewed first, or you want to debug the failure first), use the
# deploy script's built-in backup-restore mode:
#
#   sudo bash ops/deploy.sh --rollback
#
# This restores the most recent snapshot taken automatically by the prior
# `ops/deploy.sh` call (under .deploy-backups/). Note: this does NOT
# restore the .env backup from R1 — the .env restore in R1 is still
# required separately. The deploy.sh --rollback only restores code state
# and config.env (the ops config), not the application's .env.

# ============================================================
# Step R4 — wait for services to settle
# ============================================================
for i in $(seq 1 30); do
  if systemctl is-active --quiet ecliptrix-backend.service \
     && systemctl is-active --quiet ecliptrix-frontend.service; then
    echo "Both services active after rollback"
    break
  fi
  sleep 2
done

# ============================================================
# Step R5 — verify rollback worked: health check
# ============================================================
curl -fsS https://ecliptrix.com/api/health
# Expected: {"success":true,...}

curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' https://ecliptrix.com/
# Expected: HTTP 200

# ============================================================
# Step R6 — manual browser verification of rolled-back state
# ============================================================
# Open https://ecliptrix.com in a fresh browser and confirm:
# - Login works (using the OLD pre-refactor flow)
# - Video editor loads
# - The features previously broken (whatever triggered the rollback) now work

# ============================================================
# Step R7 — record the rollback in the audit
# ============================================================
# Open docs/plans/unified-api-auth-refactor/audit/deployment-audit.md and add:
# - Rollback timestamp (UTC)
# - The merge SHA that was reverted
# - The failure that triggered the rollback (verbatim error message + screenshot)
# - Verification that rollback restored functionality
# - Whether R3 (push revert) or R3' (local backup-restore) was used
# - Owner + next steps (file a bug ticket against the failing component)
```

**Why `git revert`, not `git reset --hard`:** revert preserves history, makes the rollback auditable, and is safe to push to a shared branch. `git reset --hard` rewrites history, breaks anyone with the same branch checked out, and corrupts the audit trail. Always revert.

**`.env.backup-*` cleanup:** After 5 successful deploys, prune old backups:
```bash
ls -t /root/ecliptrix/.env.backup-* | tail -n +6 | xargs rm 2>/dev/null
```

---

## 8. Edge cases & failure modes

| # | Edge case | Handling |
|---|---|---|
| E1 | `git pull` fails because of local uncommitted changes on the server | `git stash && git pull && git stash pop`. If conflicts arise, abort and investigate why prod has uncommitted changes (separate process bug). |
| E2 | `npm install` fails partway (network/registry hiccup) | Re-run `sudo bash ops/deploy.sh`. The script is idempotent. If it consistently fails, abort and fix the underlying network issue first. |
| E3 | `npm run build` runs out of memory on the 7GB box | Existing mitigation: `NODE_OPTIONS=--max-old-space-size=4096` (already in `ops/deploy.sh` line 150) + 4GB swap file. Verify swap is mounted: `swapon --show`. If swap is missing, add it before retrying. |
| E4 | Smoke script reports a single failing endpoint | Investigate that one endpoint immediately. If it's a real bug → rollback. If it's a smoke-script bug (wrong URL, stale endpoint) → fix the script and re-run. |
| E5 | `BACKEND_URL` typo after the §3 step 4 edit | The frontend service refuses to start with `Error: BACKEND_URL is required at module load`. Operator notices in step 7 (services not active), greps the journal, fixes the typo, re-runs `sudo bash ops/deploy.sh`. |
| E6 | `git revert` produces a merge conflict | This should not happen on a recently-merged commit. If it does, abort with `git revert --abort` and fall back to manual rollback: `git checkout $PROD_PRE_SHA -- .` then commit. |
| E7 | Watchdog timer fires mid-deploy and restarts a service prematurely | The watchdog has a 60s timer and a 3-fail threshold (`ops/healthcheck.sh`). `ops/deploy.sh` stops/starts the watchdog timer at the end (line 193), so a stale watchdog cannot race. Belt-and-suspenders: manually `systemctl stop ecliptrix-watchdog.timer` before deploy, `start` it after V3. |
| E8 | The 4 deprecated env var lines are not all present in `.env` (only some) | Only remove the lines that exist. Do not add lines just to delete them. The verification grep is the source of truth — it must end with exactly one line. |
| E9 | The frontend `/login` page renders but the form does not work | Verify that `LoginModal` is actually mounted (DOM inspector) — it should always render in open state on this route. If broken, check the Suspense boundary and `useSearchParams` import in `src/app/login/page.tsx`. Hot-fix forward (it's <60 LoC). |
| E10 | Backend tests fail post-deploy when re-run on Singapore-01 | The 19 auth-middleware pytest cases use SQLite in-memory; they should always pass. Pre-existing 96 backend test failures are unrelated to this refactor — see Phase 1 digest. Do NOT attribute them to this deploy. |
| E11 | Background workers / cron jobs make in-process self-calls to API endpoints | Audited in S01 — none expected. Services use direct DB / function calls, not HTTP self-calls. If any are discovered post-deploy, file a follow-up to migrate them to call the service layer directly. |
| E12 | The `.env.backup-*` file accumulates indefinitely | Operator prunes after 5 deploys: `ls -t /root/ecliptrix/.env.backup-* | tail -n +6 | xargs rm`. |

---

## 9. Smoke script reference

`scripts/smoke-api-auth.sh` is the production verification primitive. It runs against any base URL and exits 0 only when all checks pass.

```bash
# Production
bash scripts/smoke-api-auth.sh https://ecliptrix.com

# Production with auth phase
SMOKE_USER='alice' SMOKE_PASS='hunter2' bash scripts/smoke-api-auth.sh https://ecliptrix.com

# Dry-run target (dev server, frontend on :3010)
bash scripts/smoke-api-auth.sh http://192.168.1.7:3010

# CI-friendly (no ANSI colors)
bash scripts/smoke-api-auth.sh https://ecliptrix.com --no-color
```

| Phase | Endpoint count | Expected status | Failure indicates |
|---|---|---|---|
| 1 — Allowlist anonymous | 2 | non-401 | Allowlist regression in `app/middleware/auth_middleware.py` |
| 2 — Protected anonymous | 24 | exactly 401 | Auth middleware not enforcing OR Next.js route not forwarding `Authorization` |
| 3 — Authenticated | 6 (skipped if no creds) | non-401 / non-403 | Token issuance broken OR client-server contract drift |

The endpoint lists are checked into the script (lines 151-195). To add a new endpoint, edit the array directly.

---

## 10. References

- **Spec:** [`specs/08-deployment-rollout.md`](specs/08-deployment-rollout.md)
- **TODO:** [`todos/08-deployment-rollout.md`](todos/08-deployment-rollout.md)
- **Master plan:** [`master-plan.md`](master-plan.md) §11 (Rollout Plan) and §10 (Success Criteria)
- **Backend middleware:** `backend-services/basic-service/app/middleware/auth_middleware.py`
- **Frontend config module:** `src/lib/config/backend.ts`
- **Frontend HTTP wrapper:** `src/lib/api/http-client.ts`
- **Backend proxy helper:** `src/lib/api/server/backend-proxy.ts`
- **Login page:** `src/app/login/page.tsx`
- **Smoke script:** `scripts/smoke-api-auth.sh`
- **Pre-deploy sanity check:** `scripts/preflight.sh` (this runbook's bundled validator)
- **Deploy script:** `ops/deploy.sh` (reused unchanged)
- **Watchdog:** `ops/healthcheck.sh`
- **Audit:** [`audit/deployment-audit.md`](audit/deployment-audit.md)

---

## 11. Pre-production dry-run

Before touching production, the entire deployment sequence is rehearsed against the dev server (192.168.1.7). The dry-run is **mandatory** — no production deploy without a passing dry-run within the last 24h.

### Dev server topology

- Host: `192.168.1.7`, user `kt`, Ubuntu 22.04
- Project path: `/home/kt/tako/Ecliptrix`
- Backend port: `:8000` (NOT prod's `:8088`)
- Frontend port: `:3010` (NOT prod's `:3088`)
- Systemd units: dev server may NOT have systemd-managed Ecliptrix; fall back to `bash start.sh 3010 --dev`

### Dry-run procedure

```bash
# Step DR1 — SSH to dev
ssh kt@192.168.1.7
cd /home/kt/tako/Ecliptrix

# Step DR2 — fetch the merge commit
git fetch origin main
git checkout main
git pull --ff-only origin main

# Step DR3 — back up dev .env (if it exists) and verify BACKEND_URL is set
[ -f .env ] && cp .env .env.backup-$(date +%Y%m%d-%H%M%S)
grep -n 'BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL\|NEXT_PUBLIC_BACKEND_URL' .env || true
# Edit .env to ensure BACKEND_URL=http://localhost:8000 (dev port)

# Step DR4 — deploy / restart
# Option A — if dev has systemd Ecliptrix units:
#   sudo bash ops/deploy.sh
# Option B — if not (more common on dev):
bash kill.sh
bash start.sh 3010 --dev &

# Step DR5 — wait for services
for i in $(seq 1 60); do
  curl -fsS http://192.168.1.7:8000/api/health >/dev/null 2>&1 && \
  curl -fsS -o /dev/null -w '%{http_code}\n' http://192.168.1.7:3010/ | grep -q 200 && \
  echo "Both services up after ${i}s" && break
  sleep 1
done

# Step DR6 — health check
curl -fsS http://192.168.1.7:8000/api/health
curl -fsS -o /dev/null -w 'HTTP %{http_code}\n' http://192.168.1.7:3010/

# Step DR7 — smoke script from local machine against dev URL
# (Run this from your laptop, NOT from the dev server.)
bash scripts/smoke-api-auth.sh http://192.168.1.7:3010
# Expected: 0 failed (Phase 3 will skip without SMOKE_USER/SMOKE_PASS)

# Step DR8 — manual browser smoke
# Open http://192.168.1.7:3010 in a browser, exercise:
#   - login flow
#   - video editor load
#   - model selector
#   - intent detection
#   - audio transcription (small file)
#   - logout
#   - /login?reason=session-expired renders cleanly

# Step DR9 — INTENTIONAL ROLLBACK TEST
# The dry-run MUST exercise the rollback path so the operator is confident
# the rollback will work in production. Do this LAST so dev ends up clean.
ssh kt@192.168.1.7
cd /home/kt/tako/Ecliptrix
git log --oneline -3
# Identify the merge commit. Revert it locally only (no push):
git revert -m 1 <merge-sha> --no-edit
bash kill.sh
bash start.sh 3010 --dev &
# Verify the dev server still comes up on the reverted code.
# Then UNDO THE LOCAL REVERT so dev returns to main:
git reset --hard origin/main
bash kill.sh
bash start.sh 3010 --dev &

# Step DR10 — record the dry-run in deployment-audit.md
# - Dry-run timestamp (UTC)
# - Result: PASS / FAIL
# - Smoke counts (from DR7)
# - Manual checks (from DR8)
# - Rollback test result (from DR9)
```

**No production deploy without DR10 marked PASS within the last 24h.**

---

## 12. Out of scope

Explicitly NOT covered by this runbook (each is a separate ticket):

- Blue-green / canary deployment infrastructure (Singapore-01 is single-node)
- Automated rollback on smoke-script failure (rollback is manual by design — a human verifies the failure)
- Database migrations / Alembic upgrades (this refactor does not touch the DB schema)
- DNS / CDN changes (Cloudflare config is unchanged)
- TLS cert renewal (handled by certbot independently)
- New monitoring / alerting setup (separate ticket — backlog)
- CI pipeline setup to run smoke on every deploy (separate ticket — there is no CI yet)
- Public wiki documentation (this runbook is the canonical source for THIS refactor; future generic docs reference it)
- Signed-URL storage for `/api/storage/files/` (R3 in master-plan §9 — accepted gap, follow-up ticket)
- CSRF / refresh token / token rotation (master-plan §3 explicitly out of scope)

---

## 13. Operator handoff

When the deploy is declared SUCCESS at §5 and 24h monitoring is mid-flight:

1. Post in #ops or #deploys: "unified-api-auth-refactor deployed at <timestamp>, smoke 0 failed, monitoring 24h. Audit: docs/plans/unified-api-auth-refactor/audit/deployment-audit.md"
2. Tag the on-call engineer
3. Set a 24h reminder for the final stability check

When the 24h monitoring window passes cleanly, mark the audit `STABLE` and close the deploy ticket.

---

**End of runbook.**
