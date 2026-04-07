# Spec 08: Deployment & Rollout Playbook

> **Owner role:** DevOps / Deploy engineer
> **Layer:** Production server (Singapore-01) + repo deploy scripts (root `ops/` directory: `ops/deploy.sh`, `ops/status.sh`, `ops/healthcheck.sh`, `ops/logs.sh`; root `start.sh`)
> **Depends on:** S01-S07 (everything must be implemented and tested before deploy)
> **Blocks:** Nothing (terminal step)

**Verified at spec time (2026-04-07):** the ops toolkit lives at the repo root under `ops/` (NOT under `backend-services/basic-service/ops/`). The repo files match the production layout at `/root/ecliptrix/ops/` on Singapore-01. Files present: `ops/{config.env,deploy.sh,install.sh,install-deps.sh,uninstall.sh,status.sh,logs.sh,healthcheck.sh}` plus `ops/templates/`. `deploy.sh` already supports `--skip-deps`, `--skip-build`, `--skip-pull`, `--skip-backup`, `--branch=<name>`, `--rollback`.

---

## 1. Purpose

Codify the **exact, reproducible** sequence to ship the unified-api-auth-refactor to the Singapore-01 production environment, verify it works, and roll back cleanly if anything goes wrong. This spec converts the high-level plan in `master-plan.md §11` into a concrete, copy-paste-ready playbook with no ambiguity.

The playbook is the difference between "we deployed and hoped" and "we deployed and *know* every endpoint enforces auth". The smoke script from S07 is the proof.

---

## 2. Acceptance Criteria

1. New file `docs/plans/unified-api-auth-refactor/runbook.md` exists with the full deployment playbook (sections: pre-flight, deploy, verify, rollback, post-deploy)
2. The runbook is reproducible by any engineer with SSH access to Singapore-01 and the SSH key — no tribal knowledge required
3. The runbook includes the exact `.env` diff for `/root/ecliptrix/.env`
4. The runbook includes the exact ops commands (which all already exist — `ops/deploy.sh`, `ops/status.sh`, `ops/healthcheck.sh`, `ops/logs.sh`)
5. The smoke script from S07 (`scripts/smoke-api-auth.sh`) is invoked at the verify step with the production base URL `https://ecliptrix.com`
6. The runbook contains a `Rollback` section with verbatim commands (`git revert <merge-commit>`, redeploy, re-verify)
7. The runbook explicitly covers the env var migration: removal of `BACKEND_SERVICE_URL`, `PYTHON_BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_API_BASE_URL`; addition / verification of `BACKEND_URL=http://localhost:8088`
8. The runbook contains a "Pre-flight" checklist that an engineer ticks off before SSH-ing into prod (Singapore-01 healthy now, last backup taken, no concurrent deploy in flight, no merge freeze active)
9. The runbook contains a "Health verification" section that runs `ops/healthcheck.sh`, manually curls the auth endpoint, runs the smoke script, and visually checks the frontend at `https://ecliptrix.com`
10. A dry-run is performed against the dev server (192.168.1.7) BEFORE the production deploy. The dry-run is documented in the audit deliverable as "Dry-run executed on YYYY-MM-DD against 192.168.1.7, result: PASS/FAIL"
11. The audit deliverable `docs/plans/unified-api-auth-refactor/audit/deployment-audit.md` records: dry-run result, production deploy timestamp, smoke script output (PASS/FAIL counts), deploy duration, post-deploy 24h watchdog log review, any anomalies
12. NO destructive operations in the runbook are run automatically (no `git push --force`, no `rm -rf`, no DB drops). The runbook is idempotent — running it twice is safe

---

## 3. Pre-Deployment Checklist

The runbook's pre-deployment section MUST require operator confirmation of EACH item below before proceeding. Each item is a Markdown checkbox the operator literally checks off in their copy of the runbook:

```markdown
## Pre-flight checklist (operator must check each box)

- [ ] PR #<num> is merged to `main` and CI is green (note: no CI yet — verify locally that `npm test`, `npm run test:integration`, `pytest` all pass on the merge commit)
- [ ] Singapore-01 is currently healthy: `curl -fsS https://ecliptrix.com/api/health` returns `{success:true,...}`
- [ ] No other deploy is in flight: `ssh root@47.245.126.128 'systemctl is-active ecliptrix-backend.service ecliptrix-frontend.service'` returns `active` for both
- [ ] Backup of current `.env`: `ssh root@47.245.126.128 'cp /root/ecliptrix/.env /root/ecliptrix/.env.backup-$(date +%Y%m%d-%H%M%S)'`
- [ ] Backup of current code state: noted commit SHA `git -C /root/ecliptrix rev-parse HEAD` → record it for rollback
- [ ] Dry-run completed against dev server (192.168.1.7) within the last 24h, result: PASS
- [ ] No active merge freeze (check team chat or wiki)
- [ ] Smoke script credentials available: `SMOKE_USER` and `SMOKE_PASS` env vars set locally for the verify step
- [ ] Maintenance window communicated to users (if applicable)
```

---

## 4. The `.env` Migration Diff

The runbook includes the literal before/after for `/root/ecliptrix/.env`:

```diff
# /root/ecliptrix/.env (frontend env loaded by ecliptrix-frontend.service)

- BACKEND_SERVICE_URL=http://localhost:8088
- PYTHON_BACKEND_URL=http://localhost:8088
- NEXT_PUBLIC_BACKEND_URL=https://ecliptrix.com
- NEXT_PUBLIC_API_BASE_URL=https://ecliptrix.com
  BACKEND_URL=http://localhost:8088     # unchanged — this is the surviving canonical var

# Other vars (LLM_API_URL, LLM_API_KEY, etc.) unchanged
```

**Note:** `BACKEND_URL=http://localhost:8088` is already set on Singapore-01 from the 2026-04-07 :8000 → :8088 incident. If for some reason it is missing, the operator MUST add it — the Next.js process refuses to boot without it (per S02 fail-fast contract).

The runbook commands the operator to:
1. Edit `/root/ecliptrix/.env` removing the deprecated lines
2. Verify `BACKEND_URL=http://localhost:8088` is the only backend-URL line: `grep -n 'BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL\|NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL' /root/ecliptrix/.env` should print exactly ONE line: the new `BACKEND_URL`
3. NOT touch `BACKEND_URL` in `/root/ecliptrix/backend-services/basic-service/.env` (the backend's own env file is unchanged — it doesn't read these vars)

**Note about the backend's own env:** The FastAPI backend reads its own `.env` from its directory, but it does NOT read `BACKEND_URL` (that's a frontend-side var). The backend's `.env` only needs `DATABASE_URL`, `LLM_API_*`, and other backend-specific vars — none of which change.

---

## 5. Deployment Sequence

The runbook's deploy section is a literal command list:

```bash
# Step 1 — connect
ssh root@47.245.126.128

# Step 2 — pull latest
cd /root/ecliptrix
git fetch origin main
git checkout main
git pull origin main
NEW_SHA=$(git rev-parse HEAD)
echo "Deploying SHA: $NEW_SHA"

# Step 3 — backup .env
cp /root/ecliptrix/.env /root/ecliptrix/.env.backup-$(date +%Y%m%d-%H%M%S)

# Step 4 — apply env diff
$EDITOR /root/ecliptrix/.env
# (operator manually applies the diff from §4)

# Step 5 — verify env diff applied
grep -n 'BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL\|NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL' /root/ecliptrix/.env

# Step 6 — run the existing deploy script (it handles npm install, build, systemd restart)
sudo bash ops/deploy.sh

# Step 7 — wait for systemd to settle (polled, with 60s ceiling)
for i in {1..30}; do
  if systemctl is-active --quiet ecliptrix-backend.service \
     && systemctl is-active --quiet ecliptrix-frontend.service; then
    echo "Both services active"
    break
  fi
  sleep 2
done

# Step 8 — local health check
curl -fsS https://ecliptrix.com/api/health
# expected: {"success":true,"message":"Healthy",...}

# Step 9 — frontend health check
curl -fsS -o /dev/null -w '%{http_code}\n' https://ecliptrix.com/
# expected: 200
```

**The existing `ops/deploy.sh` script is REUSED unchanged.** This refactor does not require any change to the deploy infrastructure — only the application code.

---

## 6. Verification Sequence

After deploy completes, run from a local machine (not from the production server):

```bash
# Step V1 — run the smoke script (from local repo, against production)
cd ~/dev/ecliptrix    # or wherever the local repo is
SMOKE_USER="${SMOKE_USER:?set first}" \
SMOKE_PASS="${SMOKE_PASS:?set first}" \
bash scripts/smoke-api-auth.sh https://ecliptrix.com

# Expected output:
# ==== <N> passed / 0 failed ====
# Exit code: 0

# Step V2 — manual: open the app in a browser
# Visit https://ecliptrix.com
# - Login with a real account
# - Open the video editor
# - Verify no 401s in the browser console (DevTools > Network)
# - Verify the model selector loads (was a NEXT_PUBLIC_* direct call before)
# - Verify intent detection runs (was a NEXT_PUBLIC_* direct call before)
# - Verify audio transcription works on a small test file (was a NEXT_PUBLIC_* direct call before)
# - Logout — verify the redirect works
# - Try to navigate back to a protected page after logout — should redirect to /login

# Step V3 — check ecliptrix-watchdog logs for errors in the last 5 minutes
ssh root@47.245.126.128 'journalctl -u ecliptrix-watchdog.service --since "5 minutes ago" | grep -i error || echo "No errors"'

# Step V4 — record results in deployment-audit.md
```

**Failure during V1-V2:** Trigger rollback (Section 7).

**Success criteria for the entire deploy:** ALL of:
- V1 smoke script exits 0
- V2 manual checks all PASS
- V3 watchdog log clean

---

## 7. Rollback Procedure

If any verification step fails, rollback IMMEDIATELY. Do not attempt forward fixes during the deploy window — get back to a known-good state first, debug afterwards.

```bash
ssh root@47.245.126.128
cd /root/ecliptrix

# Step R1 — restore the backup .env
cp /root/ecliptrix/.env.backup-<timestamp> /root/ecliptrix/.env

# Step R2 — revert the merge commit
# Find the merge commit
git log --oneline -5
# Revert it
git revert -m 1 <merge-commit-sha> --no-edit
# Push the revert (or pull if revert was pushed remotely first)
git push origin main

# Step R3 — redeploy with the reverted code
# (deploy.sh internally runs `git pull` first; after R2 already pushed the revert,
# this will fast-forward to the reverted commit and rebuild/restart cleanly.)
sudo bash ops/deploy.sh

# Alternative R3' — if the operator prefers NOT to touch the remote (e.g., revert
# wasn't pushed yet, or the failure must be diagnosed first), use the deploy
# script's built-in backup-restore mode to revert to the LAST successful local
# build/state without re-pulling. This requires that the pre-deploy backup step
# of the prior `ops/deploy.sh` ran successfully (it does by default):
#   sudo bash ops/deploy.sh --rollback
# This restores the most recent backup snapshot taken by deploy.sh (NOT the same
# as restoring the .env backup from R1 — that's still required separately).

# Step R4 — wait for services
for i in {1..30}; do
  systemctl is-active --quiet ecliptrix-backend.service \
    && systemctl is-active --quiet ecliptrix-frontend.service \
    && break
  sleep 2
done

# Step R5 — verify rollback worked
curl -fsS https://ecliptrix.com/api/health
# expected: {"success":true,...}

# Step R6 — verify the app loads in browser as before
# (manual)

# Step R7 — record the rollback in deployment-audit.md with the failure reason
```

**Why `git revert`, not `git reset`:** revert preserves history, makes the rollback auditable, and is safe to push. `git reset --hard` rewrites history and breaks anyone with the same branch checked out.

**Alternative — fast hot-fix:** If the failure is small (single endpoint, obvious cause), the engineer MAY hot-fix forward instead of reverting, but ONLY if the fix is <10 lines and obvious. Otherwise rollback wins.

---

## 8. Post-Deploy Monitoring (24h)

The runbook ends with a 24-hour monitoring section:

```markdown
## Post-deploy monitoring (24h after merge)

- [ ] Hour 0-1: Check watchdog logs every 15 min
      `ssh root@47.245.126.128 'journalctl -u ecliptrix-watchdog --since "15 minutes ago" | tail -50'`
- [ ] Hour 2-6: Spot-check at hour 2, hour 6
- [ ] Hour 24: Final review:
      - Watchdog logs grep for `ERROR\|CRITICAL\|401\|500`
      - Backend logs for tracebacks: `journalctl -u ecliptrix-backend --since "24 hours ago" | grep -i traceback`
      - Frontend logs for build errors: `journalctl -u ecliptrix-frontend --since "24 hours ago" | grep -iE 'error|warn'`
      - No user complaints in support channels
- [ ] Run smoke script one more time at hour 24: `bash scripts/smoke-api-auth.sh https://ecliptrix.com`
- [ ] Mark deployment as STABLE in deployment-audit.md
```

If anomalies appear during the 24h window, the engineer triages and decides whether to rollback or hot-fix.

---

## 9. Files to Create / Modify

| File | Action | LoC est |
|---|---|---|
| `docs/plans/unified-api-auth-refactor/runbook.md` | Create — the full deployment playbook (sections 3-8) | ~400 |
| `docs/plans/unified-api-auth-refactor/audit/deployment-audit.md` | Create — populated AFTER deploy with timestamps, results, anomalies | ~150 |
| `env.template` (root) | Verify — already cleaned up by S02 / S06 | (already done) |
| `ops/deploy.sh` | NOT MODIFIED — reuse existing | 0 |
| `ops/healthcheck.sh` | Verify it still works (it should — no contract changes) | 0 |

**Estimated total: ~550 LoC of documentation. No production code changes.**

---

## 10. Pre-Production Dry-Run

Before touching production, the entire deployment sequence is rehearsed against the dev server (192.168.1.7). The dry-run validates that:
- The deploy script runs cleanly
- The new code builds
- The services start
- The smoke script passes
- The rollback procedure works (intentionally fail one verification, run rollback, verify recovery)

The dry-run is mandatory. The deployment-audit.md records the dry-run timestamp and result. **No production deploy without a passing dry-run within the last 24h.**

```bash
# Dry-run script (run from local machine)
ssh kt@192.168.1.7 'cd ~/ecliptrix && git pull && bash ops/deploy.sh'
# Wait for services
ssh kt@192.168.1.7 'systemctl is-active ecliptrix-backend ecliptrix-frontend'
# Smoke against the dev URL
SMOKE_USER=test SMOKE_PASS=test bash scripts/smoke-api-auth.sh http://192.168.1.7:3088
# Manual: open http://192.168.1.7:3088 and test the same flows as production
```

**Note:** the dev server's port and base URL differ from prod — the smoke script accepts the URL as an argument so this works.

---

## 11. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| `git pull` fails because of local changes on the server | Stash or reset; if dirty repo, abort and investigate WHY there are uncommitted changes on prod (that's a separate process bug) |
| `ops/deploy.sh` fails mid-way (e.g., npm install fails due to network) | Re-run; the script is idempotent. If it consistently fails, abort and fix the underlying issue (network, disk space) |
| `npm run build` runs out of memory (the 7GB box) | Existing mitigation in place: `NODE_OPTIONS=--max-old-space-size=4096` + 4GB swap. Verify before deploy that swap is mounted: `swapon --show` |
| Smoke script reports 1 failing endpoint | Investigate that one endpoint immediately. If it's a real bug, rollback. If it's a smoke-script bug (e.g., wrong endpoint URL), fix the script and re-run |
| `BACKEND_URL` typo after edit | The backend dependency on `backend.ts` (S02) throws at boot, so the frontend service fails to start with a clear error in journalctl. Operator notices in Step 7, applies fix |
| `git revert` produces a merge conflict | Should not happen on a recently-merged commit; if it does, abort the revert (`git revert --abort`) and apply manual rollback using `git checkout <previous-sha> -- .` then commit |
| Production DB schema differs from dev | This refactor does NOT touch the DB. If schema differs, that's an unrelated bug to investigate separately |
| Watchdog timer triggers a restart mid-deploy | Existing watchdog has a 60s timer (`ecliptrix-watchdog.timer`); `ops/deploy.sh` calls `systemctl restart` on backend, frontend, and the watchdog timer in sequence (verified at spec time, deploy.sh lines 168/181/193). Restart is atomic from systemd's perspective so a stale watchdog cannot race with the new build. If the operator wants belt-and-suspenders, they can `systemctl stop ecliptrix-watchdog.timer` before deploy and `start` it after V3 |
| `.env.backup-*` files accumulate | After 5 successful deploys, the operator deletes old backups: `ls -t /root/ecliptrix/.env.backup-* | tail -n +6 | xargs rm` |

---

## 12. Coordination Notes for Other Agents

- **For S07 (testing):** This spec depends on `scripts/smoke-api-auth.sh` existing and being executable. If S07 hasn't shipped the smoke script, this spec cannot complete — escalate to the orchestrator
- **For Inspector / Tester agents (Phase 5):** This is the LAST spec executed. The Inspector verifies the deployment-audit.md exists and is filled in with real timestamps, not placeholders
- **For Token Economy:** Successful deploy → Inspector applies a `D12: Integration test pass` bonus to the entire team. Failed deploy → root-cause analysis per master plan §11.3 / token-economy-rules
- **For future deploys:** This runbook BECOMES the standard deploy playbook for any future Ecliptrix deploys involving env var or auth changes. Save it under `ops/runbooks/` once the refactor is stable

---

## 13. Out of Scope

- Blue-green deployment infrastructure — Singapore-01 has only one node, no blue-green possible without provisioning
- Canary deployment / traffic splitting — same constraint
- Automated rollback on failure — the rollback is manual by design (a human verifies the failure is real before reverting)
- Database migration / Alembic upgrade — this refactor does not touch the DB
- DNS / CDN changes — out of scope, the existing Cloudflare/DNS setup is unchanged
- TLS certificate renewal — handled by certbot independently
- New monitoring / alerting setup — separate ticket
- Documentation in the public wiki — this runbook is the canonical source for THIS refactor; future generic docs can reference it
- Setting up CI to run the smoke script on every deploy — separate ticket once a CI pipeline exists
