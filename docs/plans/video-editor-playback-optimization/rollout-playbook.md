# Playback v2 — Rollout Playbook

> Owner: Playback v2 dogfood squad
> Last updated: 2026-05-16
> Tracking spec: `docs/plans/video-editor-playback-v2-phase4/spec.md` §3.2.7 / §4.1 / G5
> Companion docs: `master-plan.md` §九 / §十一, `specs/08-telemetry-feature-flag-rollout.md` §八

This document is the operational checklist used to take Playback v2 from
local dogfood to a 100% rollout. Every section has at least one concrete
command, SQL, or curl call so the on-call engineer can run it without
context-switching to a wiki.

---

## 1. dogfood 启动 checklist（pre-flight）

The aggregator behind `/api/admin/playback-metrics` is in-process. Spec
§3.2.7 forbids running more than one worker until the redis backend
(Round 5) lands. Treat the items below as a release gate.

**Required steps before flipping `PLAYBACK_V2_ROLLOUT_PERCENT` above 0.**

- [ ] `uvicorn` / `gunicorn` configured with `-w 1`. The production
      reference command is documented in `backend-services/basic-service/README.md`
      §"Run"; replace `-w 4` with `-w 1` during dogfood.
      ```bash
      # dogfood / first wave only — multi-worker degrades the aggregator
      gunicorn app.main:app -w 1 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
      ```
- [ ] Confirm worker count from the startup log; the lifespan hook prints
      a WARNING when multi-worker is detected (see `app/main.py` lifespan
      block, Phase 4 §3.2.7).
- [ ] Sanity-check the admin endpoint returns `degraded: false`:
      ```bash
      curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
        "http://localhost:8000/api/admin/playback-metrics?window=15m" | jq .degraded
      ```
- [ ] Confirm the env defaults match spec §4.3:
      ```bash
      grep -E "PLAYBACK_V2_(ROLLOUT_PERCENT|FORCE_ENABLED_USER_IDS|TELEMETRY_AGG_)" \
        backend-services/basic-service/.env
      ```
- [ ] Front-end `.env.local` has the kill-switch thresholds set or accepts
      the defaults (50 / 30):
      ```bash
      grep PLAYBACK_V2_KILLSWITCH .env.local || echo "(defaults will apply)"
      ```
- [ ] At least one admin user can hit `/api/admin/playback-proxies` (the
      role assignment is propagated via DB — see `app/dependencies/auth.py`).
- [ ] Run the unit test gates locally so a stale build is not promoted:
      ```bash
      npm run lint
      npm run type-check
      npm run test -- src/components/video/playback src/lib/__tests__/playbackFlags
      pushd backend-services/basic-service && pytest tests/test_admin_playback*.py \
        tests/test_playback_metrics_aggregator.py tests/test_playback_telemetry_pii.py -q && popd
      ```

---

## 2. 监控位置（observation surfaces）

Phase 4 explicitly defers Prometheus / Grafana. The on-call workflow
relies on structured log scraping plus the admin endpoints.

- **Structured logs**
  - File: `backend-services/basic-service/logs/app.log`
  - Key metric lines:
    - `playback.telemetry` (per ingested event, with
      `metric`, `value`, `flag_variant`, `session_id`, optional
      `unknown_metric=true`).
    - `media_proxy.serve` (cache_state, upstream_latency_ms,
      bytes_total).
    - `preview_proxy.enqueue` / `preview_proxy.status` /
      `preview_proxy.file` (status, tasks_queued, transcode_duration_ms,
      failure_total).
  - Quick grep for one metric:
    ```bash
    grep '"metric": "playback.swap_latency_ms"' logs/app.log | tail -200 \
      | jq -r '.value' | sort -n | awk '
        { a[NR]=$1 } END {
          n=NR; idx=int(n*0.95);
          printf "samples=%d  p50=%.2f  p95=%.2f\n", n, a[int(n/2)+1], a[idx]
        }'
    ```
- **Admin endpoints**
  - `GET /api/admin/playback-metrics?window=15m` — aggregator snapshot.
    Reply includes `worker_pid` and `degraded` (spec §3.2.7).
  - `GET /api/admin/playback-proxies?status=running` — in-flight
    transcode queue. Status enum: `absent | queued | running | cached | failed`.
- **Frontend**
  - DevTools console — `localStorage.getItem('ecliptrix-playback-v2-killswitch')`
    surfaces the trip reason (encoded as `reason:trippedAt`).
  - Phase 4 dev variant switcher (top-right of preview panel in
    dev/staging) — toggles `ecliptrix-playback-v2-variant-override`.

---

## 3. 灰度推进流程（progression)

Once dogfood is green, advance `PLAYBACK_V2_ROLLOUT_PERCENT` in steps.
Each step requires the §4.4 thresholds to clear for ≥ 24 h.

| Step | rolloutPercent | Worker requirement | Forced users | Gate |
|------|----------------|--------------------|--------------|------|
| 0 | 0 | -w 1 | dogfood usernames | unit tests + manual M1/M3/M5 |
| 1 | 5 | -w 1 | dogfood + 5 employees | `/api/admin/playback-metrics?window=1h` `degraded=false` 持续 24 h |
| 2 | 25 | -w 1 | dogfood + 20 employees | swap_latency_ms P95 < 30ms 持续 24 h |
| 3 | 50 | -w 1 (or redis-backed once Round 5 ships) | dogfood + 50 employees | click_to_first_frame P95 < 300ms 持续 48 h |
| 4 | 100 | redis-backed aggregator preferred | n/a | 1 周内 0 kill-switch trip 事件 |

Update the rollout percent in `.env`:

```bash
sed -i 's/^PLAYBACK_V2_ROLLOUT_PERCENT=.*/PLAYBACK_V2_ROLLOUT_PERCENT=25/' \
  backend-services/basic-service/.env
systemctl reload basic-service   # or whichever supervisor you use
```

For per-user opt-in (force users into v2 regardless of bucketing), set
`PLAYBACK_V2_FORCE_ENABLED_USER_IDS` to a comma-separated list of UUIDs.
The frontend resolver hits `/api/config/playback-flag` and reads the
returned bucket. The endpoint already exists from Round 1 — no
additional work is required.

---

## 4. 回滚 SOP（rollback)

Rollback is uniform across the §4.4 thresholds. Pick the heaviest
intervention that matches the symptom; lighter steps are non-destructive.

1. **Soft rollback (preferred)** — drop the percent back to 0 without
   restarting the server. Resolver TTL is 10 min, so user impact is
   bounded.
   ```bash
   sed -i 's/^PLAYBACK_V2_ROLLOUT_PERCENT=.*/PLAYBACK_V2_ROLLOUT_PERCENT=0/' \
     backend-services/basic-service/.env
   systemctl reload basic-service
   ```
2. **Forced legacy for ALL** — flip the environment flag off and roll
   the service:
   ```bash
   sed -i 's/^PLAYBACK_V2_ENABLED=.*/PLAYBACK_V2_ENABLED=false/' \
     backend-services/basic-service/.env
   systemctl restart basic-service
   ```
3. **Client-side kill-switch** — instruct affected users to paste this
   into DevTools, which forces legacy locally until they clear it
   manually:
   ```js
   localStorage.setItem('ecliptrix-playback-v2-killswitch', 'manual:' + Date.now());
   location.reload();
   ```
4. **Verify the §4.4 thresholds are no longer breached**:
   ```bash
   curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://localhost:8000/api/admin/playback-metrics?window=1h" | jq .
   ```

§4.4 rollback triggers (any single condition for ≥ 30 min):

- `playheadRegressionLast24h` ≥ 1000
- 7-day baseline `stalled` rate ↑ by ≥ 50% (compare via grep on
  `app.log`).
- `clickToFirstFramePct95Ms` > 800 sustained 30 min.

When `degraded: true`, **do not auto-rollback** based on these
thresholds — the aggregator is sampling 1/N of traffic. Confirm via
`grep` over the raw logs first.

---

## 5. 已知 issues / 注意事项（known caveats)

- The aggregator is process-local; the admin endpoint flags
  `degraded: true` whenever `GUNICORN_WORKERS`/`UVICORN_WORKERS` > 1.
  Round 5 replaces this with a redis backend (see
  `master-plan.md` §11.2).
- `selectPlaybackUrl` is intentionally pure. Adding `recordTier(...)`
  inside it will inflate hit-rate counts (R-P1-6). Use
  `PlaybackEngine.attachActiveMaterial` instead.
- Hashed userIds use 12 hex chars (~48 bits). Acceptable for dogfood
  (< 100 users); revisit at 1M users (R-P2-6).
- The dev variant switcher (`PlaybackVariantSwitcher`) renders `null`
  in production. If a future bundle audit shows it leaking, wrap the
  import in `next/dynamic({ ssr: false })` (see spec R-P2-4).
- Unknown metric names are tagged `unknown_metric=true` rather than
  dropped (R-P1-5). Add new names to `PLAYBACK_EVENTS` in
  `src/components/video/playback/telemetry.ts` — TypeScript will then
  block typos at compile time.
- The kill-switch storage key (`ecliptrix-playback-v2-killswitch`)
  encodes its reason as `reason:trippedAt`. Use
  `readKillSwitchReason()` to parse — never introduce a second key
  (R-P1-4).

---

## 6. 反馈渠道（feedback)

- **Bug reports** — file under the `playback-v2` GitHub label with a
  description plus the contents of `localStorage.ecliptrix-playback-v2-killswitch`
  (if tripped) and the most recent 200 lines of `logs/app.log`.
- **Performance regressions** — capture a 1 h window via the
  `/api/admin/playback-metrics` endpoint and attach the JSON to the
  bug report; include the `worker_pid` and `degraded` fields.
- **Dogfood survey** — distribute the master-plan §八 subjective rating
  form to dogfood users weekly. Target ≥ 4.5 / 5 before promoting to
  step 3.
- **Slack channel** — `#ecliptrix-playback` (admin pings should @-the
  dogfood squad; non-admin can drop kill-switch screenshots).

---

## 7. Appendix — quick-reference commands

```bash
# Resolve the current flag value as seen by the browser:
curl -sS http://localhost:8000/api/config/playback-flag

# Inspect an admin's view of the queue:
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/admin/playback-proxies?status=running&limit=20"

# Reset a runaway kill-switch state for one user in DevTools:
localStorage.removeItem('ecliptrix-playback-v2-killswitch');
location.reload();

# Sample 1000 regression events for an end-to-end sanity check:
for i in $(seq 1 1000); do
  curl -sS -X POST http://localhost:8000/api/telemetry/playback \
    -H 'Content-Type: application/json' \
    -d '{"sessionId":"sanity","flagVariant":"v2","events":[{"name":"playback.playhead_regression","ts":'$(date +%s%3N)'}]}' > /dev/null
done
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8000/api/admin/playback-metrics?window=15m" \
  | jq .data.playheadRegressionLast24h
```
