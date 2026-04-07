# TODO 08: Deployment & Rollout Playbook

> **Spec:** [specs/08-deployment-rollout.md](../specs/08-deployment-rollout.md)

## Dependencies

```yaml
depends_on: [07]
blocks: []
parallel_group: E
```

- **Depends on T07** — needs `scripts/smoke-api-auth.sh` for the verify step
- **Blocks nothing** — terminal step
- **Parallel group E** — runs in Phase 5 alone (sequential, irreversible action)

## Tasks

- [ ] Read sibling spec `08-deployment-rollout.md` end to end
- [ ] **Step 1: Write the runbook** at `docs/plans/unified-api-auth-refactor/runbook.md` per spec §3-§8:
  - [ ] Section: Pre-flight checklist (operator-facing, with checkboxes)
  - [ ] Section: `.env` migration diff
  - [ ] Section: Deployment sequence (literal command list)
  - [ ] Section: Verification sequence (V1-V4)
  - [ ] Section: Rollback procedure (R1-R7)
  - [ ] Section: Post-deploy 24h monitoring checklist
- [ ] **Step 2: Verify all prior dependencies are sync-ready on Singapore-01 staging:**
  - [ ] T01 backend middleware files
  - [ ] T02 backend URL config module
  - [ ] T03 HTTP client wrapper
  - [ ] T04 routes sweep deliverables
  - [ ] T05 lib/api refactor deliverables
  - [ ] T06 direct call migration deliverables
  - [ ] T07 testing suite + `scripts/smoke-api-auth.sh`
- [ ] **Step 3: Dry-run on dev server (192.168.1.7):**
  - [ ] **Note:** dev server uses backend `:8000` + frontend `:3010` (NOT prod's `:8088`/`:3088`); project path is `/home/kt/tako/Ecliptrix`. Spec §10 sample commands show prod ports — adjust to dev reality below
  - [ ] SSH to dev server (`kt@192.168.1.7`)
  - [ ] `cd /home/kt/tako/Ecliptrix && git fetch && git checkout <feature-branch> && git pull`
  - [ ] Run `bash ops/deploy.sh` (dev server may not have systemd-managed Ecliptrix; if not, fall back to `bash start.sh 3010 --dev` per dev-server reference)
  - [ ] If systemd is configured, wait: `systemctl is-active ecliptrix-backend ecliptrix-frontend`
  - [ ] Health check: `curl -fsS http://192.168.1.7:8000/api/health`
  - [ ] Run smoke from local against dev: `bash scripts/smoke-api-auth.sh http://192.168.1.7:3010`
  - [ ] Manual: open `http://192.168.1.7:3010`, login, exercise key flows
  - [ ] **Test rollback**: intentionally fail one verification, then `sudo bash ops/deploy.sh --rollback`, verify recovery
  - [ ] Record dry-run timestamp + result in audit
- [ ] **Step 4: Pre-production checks (operator follows runbook §3 checklist):**
  - [ ] PR merged to `main` and all tests green locally
  - [ ] Singapore-01 currently healthy
  - [ ] No concurrent deploy in flight
  - [ ] Backup taken
  - [ ] Maintenance window communicated
- [ ] **Step 5: Production deploy on Singapore-01 (47.245.126.128):**
  - [ ] SSH `root@47.245.126.128`
  - [ ] `cd /root/ecliptrix && git pull origin main`
  - [ ] Backup `.env`: `cp .env .env.backup-$(date +%Y%m%d-%H%M%S)`
  - [ ] Apply env diff per spec §4 (remove `BACKEND_SERVICE_URL`, `PYTHON_BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_API_BASE_URL`; verify `BACKEND_URL=http://localhost:8088` is the sole backend var)
  - [ ] Verify env: `grep -n 'BACKEND_URL\|BACKEND_SERVICE_URL\|PYTHON_BACKEND_URL\|NEXT_PUBLIC_BACKEND_URL\|NEXT_PUBLIC_API_BASE_URL' /root/ecliptrix/.env`
  - [ ] `sudo bash ops/deploy.sh`
  - [ ] Wait for systemd to settle (poll loop, 60s ceiling)
  - [ ] Health check: `curl -fsS https://ecliptrix.com/api/health`
- [ ] **Step 6: Production verification (V1-V4):**
  - [ ] V1: From local repo, `SMOKE_USER=… SMOKE_PASS=… bash scripts/smoke-api-auth.sh https://ecliptrix.com` — must exit 0
  - [ ] V2: Manual browser checks at `https://ecliptrix.com`:
    - [ ] Login works
    - [ ] Video editor loads, no 401s in console
    - [ ] Model selector loads (was direct call)
    - [ ] Intent detection runs (was direct call)
    - [ ] Audio transcription works (was direct call)
    - [ ] Logout redirects correctly
    - [ ] Post-logout protected page → /login redirect
  - [ ] V3: Watchdog log clean: `journalctl -u ecliptrix-watchdog --since "5 minutes ago" | grep -i error`
  - [ ] V4: Record everything in `docs/plans/unified-api-auth-refactor/audit/deployment-audit.md`
- [ ] **Step 7: Post-deploy monitoring (24h checklist from spec §8):**
  - [ ] Hour 0-1: 4 watchdog log checks at 15 min intervals
  - [ ] Hour 2, 6: spot checks
  - [ ] Hour 24: final review (watchdog + backend + frontend logs grep + smoke script re-run)
  - [ ] Mark deployment STABLE in audit
- [ ] **If ANY verification fails:** execute Rollback procedure from spec §7 immediately, then debug afterwards
- [ ] Write execution summary at `summaries/phase-5/dev--<agent-id>--todo-08.md`
- [ ] Mark TODO complete in the agent's completion report
