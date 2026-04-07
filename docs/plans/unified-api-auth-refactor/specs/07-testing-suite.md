# Spec 07: Testing Suite (Unit + Integration + Production Smoke)

> **Owner role:** Full-stack developer (test infra)
> **Layer:** Backend (`backend-services/basic-service/tests/`) + Frontend (`src/` + new `tests/` dir) + scripts (`scripts/`)
> **Depends on:** S01, S04, S05, S06 (everything needs to exist before tests can run end-to-end)
> **Blocks:** S08 (deployment is gated by passing tests)

---

## 1. Purpose

Build the three-tier safety net that locks the refactor's invariants in place forever:

1. **Unit tests** — verify each new module's contract in isolation (FastAPI middleware, backend-proxy helper, http-client wrapper, lib/api migrated clients)
2. **Integration tests** — verify the layers work together (browser → Next.js → backend with real auth flow)
3. **Production smoke tests** — verify the deployed app actually enforces the rules (anonymous → 401, login → 200) for every protected endpoint

The unit tests catch logic bugs. The integration tests catch contract drift. The smoke tests catch deployment / config bugs.

---

## 2. Acceptance Criteria

### 2.1 Test infrastructure
1. **Vitest** is installed and configured at the repo root: `vitest`, `@vitest/coverage-v8`, `jsdom`, `@testing-library/jest-dom` are added to `package.json` devDependencies (verified at spec time: the current `package.json` declares NO test runner — see Section 6.1 of S02 — so this is a green-field add). Vitest is the canonical choice per S02 §6.1 and S03/S04/S05/S06 all author their tests in Vitest syntax (`import { describe, it, expect, vi } from 'vitest'`); no other frontend test runner is implied anywhere in the refactor
2. `vitest.config.ts` exists at the repo root with: `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `globals: true`, alias `@/*` → `./src/*` matching `tsconfig.json`
3. `src/test/setup.ts` exists and:
   - Sets `process.env.BACKEND_URL = 'http://localhost:8000'` BEFORE any imports load `backend.ts` (the S02 module reads at top level)
   - Mocks `window.localStorage` with a stable in-memory store
   - Imports `@testing-library/jest-dom` for matchers
   - Resets all mocks via `beforeEach`
4. `package.json` has these scripts:
   - `"test": "vitest run"`
   - `"test:watch": "vitest"`
   - `"test:coverage": "vitest run --coverage"`
   - `"test:integration": "vitest run --config vitest.integration.config.ts"`
5. A separate `vitest.integration.config.ts` exists for the integration suite (different timeout, different test root)

### 2.2 Backend unit tests
6. `backend-services/basic-service/tests/test_auth_middleware.py` exists and passes (delivered by S01 — this spec only verifies CI runs it). At least 12 test cases per S01 §6
7. The full backend test suite continues to pass: `pytest tests/ -v` exits 0 (no regressions in existing tests)
8. Coverage of `app/middleware/auth_middleware.py` is ≥ 90%

### 2.3 Frontend unit tests
9. `src/lib/config/__tests__/backend.test.ts` (delivered by S02) passes under Vitest
10. `src/lib/api/__tests__/http-client.test.ts` (delivered by S03) passes under Vitest with all 18 test cases (T1-T18 from S03 §6)
11. `src/lib/api/server/__tests__/backend-proxy.test.ts` (delivered by S04) passes under Vitest with all 20 test cases (T1-T20 from S04 §6)
12. Per-client smoke tests from S05 (15 files: 12 modified `src/lib/api/*.ts` clients + the migrated `src/components/AdminSettings/components/useSettingsPanel.ts` hook + 2 new clients `src/lib/api/auth.ts` and `src/lib/api/workflowPreferences.ts`, target 30-34 tests per S05 §6) and S06 (3 migrated files: `src/lib/__tests__/intent-detection-service.test.ts`, `src/lib/api/__tests__/llm.test.ts`, `src/lib/api/__tests__/audioTranscription.test.ts`) all pass
13. `npm test` exits 0
14. Coverage of `src/lib/api/http-client.ts` is ≥ 85%
15. Coverage of `src/lib/api/server/backend-proxy.ts` is ≥ 85%

### 2.4 Integration tests
16. New file `tests/integration/auth-flow.test.ts` covers the full end-to-end auth flow against a real Next.js test server + a real FastAPI backend (or a mock backend that behaves identically — see Section 5)
17. The integration test exercises ALL of these scenarios — see Section 5 test matrix for the full list
18. Integration tests run via `npm run test:integration` and exit 0
19. Integration tests use a fixture that boots the backend on a random free port (using a Node helper like `get-port` or `net.createServer().listen(0)` to claim a free port atomically), sets `BACKEND_URL` to match, then boots Next.js dev server on another random free port, runs the test cases, and tears down both. Backend uses SQLite in-memory — verified at spec time, `backend-services/basic-service/tests/conftest.py` already defines the pattern: `TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"` with a `db_session` fixture and a `Base.metadata.create_all` setup. The integration test fixture spawns the backend with `DATABASE_URL=sqlite+aiosqlite:///:memory:` exported in its env, ensuring no PostgreSQL dependency
20. **Realism guardrails:** Booting the full stack is heavy (~15-30s per test file boot) and risks port collisions on shared CI runners. The fixture MUST: (a) use truly random free ports (not hardcoded), (b) pass the chosen ports to the spawned processes via env (`PORT` for Next.js, `--port` for uvicorn), (c) wait on a readiness probe (`GET /api/health` returning 200) with a 30s ceiling and a clear failure message, (d) tear down via `process.kill('SIGTERM')` followed by a 5s SIGKILL fallback, (e) reuse a SINGLE booted stack across all tests in `auth-flow.test.ts` (suite-level setup, not per-test boot — Vitest `beforeAll`/`afterAll`), so the boot cost is amortized. **Simpler fallback:** If the spawn-based fixture proves flaky on Windows (the dev environment) the implementer MAY substitute a Vitest-only setup that imports Next.js route handlers directly as ESM functions and calls them with constructed `Request` objects, while pointing them at a real backend already running on `:8000` from `start.sh`. This trades isolation for simplicity. The decision is documented in the audit deliverable

### 2.5 Production smoke script
20. New script `scripts/smoke-api-auth.sh` exists and is executable
21. The script accepts a base URL argument: `bash scripts/smoke-api-auth.sh https://ecliptrix.com`
22. The script tests every protected endpoint with NO auth → expects 401
23. The script tests every allowlisted endpoint → expects 200/204 or whatever the route normally returns
24. The script tests every protected endpoint with valid auth → expects 200 (or non-401)
25. The script outputs a colored summary: PASS / FAIL counts, with the failing endpoints listed
26. The script's exit code is 0 only if ALL checks pass
27. The script reads optional credentials from env vars: `SMOKE_USER`, `SMOKE_PASS`. If unset, only the anonymous-rejection part runs (still useful, but the auth-success part is skipped with a clear note)
28. The endpoint list inside the script is generated from the router-protection audit (`docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md` from S01) — the script and the audit must agree

### 2.6 CI hookup (out of scope for THIS spec — see §10)
The repo currently has no CI pipeline. Setting one up is OUT OF SCOPE for S07 — but this spec ensures all tests are runnable locally with a single command per tier. CI hookup is a follow-up ticket.

---

## 3. Test Tier Architecture

```
┌─────────── Unit Tests (Vitest, pytest) ─────────────┐
│                                                      │
│  • backend.test.ts        (S02 module)              │
│  • http-client.test.ts    (S03 wrapper)             │
│  • backend-proxy.test.ts  (S04 helper)              │
│  • <client>.test.ts × 15  (S05 lib/api clients)     │
│  • <migrated>.test.ts × 3 (S06 migrated files)      │
│  • test_auth_middleware.py (S01 backend middleware) │
│                                                      │
│  Run: npm test  (frontend)                           │
│       pytest tests/  (backend)                       │
│  Speed: <5 seconds total                             │
│  Catches: logic bugs in single modules              │
└──────────────────────────────────────────────────────┘
                       ↓
┌──────── Integration Tests (Vitest + spawn) ─────────┐
│                                                      │
│  • auth-flow.test.ts                                 │
│    - boot real backend + frontend                    │
│    - exercise login → API → logout                   │
│    - verify 401 for anonymous, 200 for auth          │
│  • backend-proxy-integration.test.ts                 │
│    - boot real backend                               │
│    - call actual proxy helper against real backend   │
│                                                      │
│  Run: npm run test:integration                       │
│  Speed: 30-90 seconds                                │
│  Catches: contract drift across layers              │
└──────────────────────────────────────────────────────┘
                       ↓
┌──────── Production Smoke (bash + curl) ─────────────┐
│                                                      │
│  • smoke-api-auth.sh <base-url>                      │
│    - hit every protected endpoint anonymously → 401  │
│    - login → get token                               │
│    - hit every protected endpoint with token → 200   │
│    - hit every allowlist endpoint → expected status  │
│                                                      │
│  Run: bash scripts/smoke-api-auth.sh https://...     │
│  Speed: ~15 seconds                                  │
│  Catches: deployment / env / config bugs            │
└──────────────────────────────────────────────────────┘
```

---

## 4. Test Inventory (cross-spec)

This spec is the AGGREGATOR of all test files contributed by the other specs. It does not write the unit tests directly — they come from S01-S06. S07's job is:

1. **Set up the runner** so the tests can actually execute
2. **Verify each prior spec's tests run** (smoke check during S07 implementation)
3. **Add the integration tests** (the cross-layer ones nobody else owns)
4. **Add the smoke script**

| Test file | Author spec | Test framework | Owned by S07? |
|---|---|---|---|
| `backend-services/basic-service/tests/test_auth_middleware.py` (≥12 cases per S01 §6, T1-T15) | S01 | pytest | No (S01 writes it) |
| `src/lib/config/__tests__/backend.test.ts` (10 cases T1-T10 per S02 §7) | S02 | Vitest | No (S02 writes it) |
| `src/lib/api/__tests__/http-client.test.ts` (18 cases T1-T18 per S03 §6) | S03 | Vitest | No (S03 writes it) |
| `src/lib/api/server/__tests__/backend-proxy.test.ts` (20 cases T1-T20 per S04 §6) | S04 | Vitest | No (S04 writes it) |
| `src/lib/api/__tests__/<each-client>.test.ts` × 14 (covers `config.ts`, `userMaterials.ts`, `videoComposition.ts`, `videoCut.ts`, `workflow.ts`, `arkImage.ts`, `userManagement.ts`, `promptPolish.ts`, `arkVideo.ts`, `systemSettings.ts`, `tts.ts`, `storyboard.ts`, plus the 2 new clients `auth.ts`, `workflowPreferences.ts`) | S05 | Vitest | No (S05 writes them) |
| `src/components/AdminSettings/components/__tests__/useSettingsPanel.test.ts` (the 15th S05 file — lives outside `src/lib/api/__tests__/` because the hook lives outside `src/lib/api/`) | S05 | Vitest | No (S05 writes it) |
| `src/lib/__tests__/intent-detection-service.test.ts` | S06 | Vitest | No (S06 writes it) |
| `src/lib/api/__tests__/llm.test.ts` | S06 | Vitest | No (S06 writes it) |
| `src/lib/api/__tests__/audioTranscription.test.ts` (covers BOTH `transcribeAudioFromPath` and `transcribeAudioFromFile`) | S06 | Vitest | No (S06 writes it) |
| **`tests/integration/auth-flow.test.ts`** | **S07** | **Vitest** | **Yes** |
| **`tests/integration/backend-proxy-integration.test.ts`** | **S07** | **Vitest** | **Yes** |
| **`scripts/smoke-api-auth.sh`** | **S07** | **bash + curl** | **Yes** |
| **`vitest.config.ts`** | **S07** | — | **Yes** |
| **`vitest.integration.config.ts`** | **S07** | — | **Yes** |
| **`src/test/setup.ts`** | **S07** | — | **Yes** |
| **`package.json` test scripts** | **S07** | — | **Yes** |

**Cross-spec test count summary:** S01 ≥12 pytest cases · S02 10 Vitest cases · S03 18 Vitest cases · S04 20 Vitest cases · S05 ~30-34 Vitest cases across 15 files (target: ≥2 per file — one positive path, one error path) · S06 3 Vitest files with ~7 client cases (C1-C7 from S06 §7.2) plus 9 proxy-route smoke cases (T1-T9 from S06 §7.1, which may be co-located with S04's helper tests). **Frontend Vitest total: ~88-94 cases. Backend pytest total: ≥12 new cases (existing pytest suite continues to pass unchanged).**

> **Important — `scripts/` directory does not yet exist.** Verified at spec time: there is no `scripts/` directory at the repo root. S07 creates it as part of delivering `smoke-api-auth.sh` (the parent dir must be `mkdir -p`'d before the file is written).

---

## 5. Integration Test Matrix

`tests/integration/auth-flow.test.ts` MUST cover:

| # | Scenario | Expected |
|---|---|---|
| I1 | Boot backend + Next.js, no user logged in, GET `/api/health` directly against the BACKEND base URL (NOT via Next.js — verified at spec time, `src/app/api/health/route.ts` does NOT exist; per S04 §5 the smoke script and integration tests hit the backend `/api/health` directly via the backend port) | 200 |
| I2 | Boot backend + Next.js, no user, GET `/api/video/search` via Next.js | 401 |
| I3 | Boot backend + Next.js, no user, POST `/api/intent-detection/detect` via Next.js | 401 |
| I4 | Boot backend + Next.js, register user → POST `/api/auth/register` | 200 + user object |
| I5 | After registration, POST `/api/auth/login` with same credentials | 200 + session_token |
| I6 | After login, GET `/api/video/search` with `Authorization: Bearer <token>` | 200 |
| I7 | After login, GET `/api/llm/models` with valid token | 200 + model list |
| I8 | After login, POST `/api/audio/transcribe-local` with file | 200 (or expected backend response) |
| I9 | After login, POST `/api/auth/logout` | 200, token invalidated |
| I10 | After logout, GET `/api/video/search` with the OLD token | 401 |
| I11 | Two simultaneous logins for the same user | the second invalidates the first (single-device) |
| I12 | Direct call to backend bypassing Next.js proxy with wrong origin → CORS rejects | (verify CORS still works after middleware change) |
| I13 | All `BACKEND_*` env vars unset → server fails to start (S02 fail-fast) | startup error |
| I14 | Routes that previously used `BACKEND_SERVICE_URL` / `PYTHON_BACKEND_URL` (e.g., `/api/workflow/ai-video-generate`, `/api/config`, `/api/workflow-preferences/save`) work end-to-end with only `BACKEND_URL` set | 200 |
| I15 | Cross-tab logout: simulate localStorage clearing in one tab; the next call from the "other tab" returns 401 and triggers the wrapper redirect | redirect to `/login` |

---

## 6. Smoke Script Design

`scripts/smoke-api-auth.sh`:

```bash
#!/usr/bin/env bash
# Usage: bash scripts/smoke-api-auth.sh <base-url>
# Optional env: SMOKE_USER, SMOKE_PASS
# Returns: 0 on all-pass, 1 on any failure
```

Pseudocode:
```
base_url = $1
fail_count = 0
pass_count = 0

# Phase 1: anonymous calls to allowlist
for endpoint in ALLOWLIST_ENDPOINTS:
    status = curl -s -o /dev/null -w '%{http_code}' "$base_url$endpoint"
    if status in [200, 204, 405]:  # 405 if method differs
        pass_count++
    else:
        fail_count++; echo "FAIL: $endpoint expected 2xx, got $status"

# Phase 2: anonymous calls to protected endpoints
for endpoint in PROTECTED_ENDPOINTS:
    status = curl -s -o /dev/null -w '%{http_code}' "$base_url$endpoint"
    if status == 401:
        pass_count++
    else:
        fail_count++; echo "FAIL: $endpoint expected 401, got $status"

# Phase 3: authenticated calls (only if SMOKE_USER and SMOKE_PASS are set)
if [ -n "$SMOKE_USER" ] && [ -n "$SMOKE_PASS" ]:
    token = $(curl -s -X POST "$base_url/api/auth/login" \
              -H 'Content-Type: application/json' \
              -d "{\"username\":\"$SMOKE_USER\",\"password\":\"$SMOKE_PASS\"}" \
              | jq -r '.data.session_token')
    if [ -z "$token" ] || [ "$token" == "null" ]:
        echo "FAIL: login did not return token"; exit 1
    for endpoint in AUTH_OK_ENDPOINTS:
        status = curl -s -o /dev/null -w '%{http_code}' \
                  -H "Authorization: Bearer $token" \
                  "$base_url$endpoint"
        if status not in [401, 403]:
            pass_count++
        else:
            fail_count++; echo "FAIL: $endpoint with auth got $status"
else:
    echo "SKIP: Phase 3 (set SMOKE_USER + SMOKE_PASS to enable)"

echo "==== $pass_count passed / $fail_count failed ===="
exit $fail_count == 0 ? 0 : 1
```

### 6.1 Endpoint lists inside the script

The script defines three bash arrays:

1. `ALLOWLIST_ENDPOINTS` — the 10 entries from the S01 allowlist, sent as the method appropriate for each (GET for `/api/health`, `/docs`, `/redoc`, `/openapi.json`; POST with empty/dummy body for `/api/auth/login`, `/api/auth/register`, `/api/auth/validate-session`; GET for prefix-mounted `/static/<sample>` and `/api/storage/files/<sample>` — these prefix paths use a known sample file or accept 404 as a "passthrough success" if the file is absent)
2. `PROTECTED_ENDPOINTS` — sample of representative protected endpoints across modules. Concrete starter list (≥20 entries — implementer expands if the audit shows additional high-traffic routes):
   - `/api/video/search` (POST)
   - `/api/video/compose` (POST)
   - `/api/llm/models` (GET)
   - `/api/intent-detection/detect` (POST)
   - `/api/user/profile` (GET)
   - `/api/user/list` (GET, admin)
   - `/api/system-settings/categories` (GET, admin)
   - `/api/system-settings/items` (GET, admin)
   - `/api/model-settings/list` (GET)
   - `/api/workflow/ai-video-generate` (POST — was `BACKEND_SERVICE_URL`)
   - `/api/workflow-preferences/save` (POST — was `PYTHON_BACKEND_URL`)
   - `/api/workflow-preferences/load` (GET)
   - `/api/audio/transcribe-local` (POST)
   - `/api/audio/transcribe` (POST)
   - `/api/storyboard/generate` (POST)
   - `/api/tts/synthesize` (POST)
   - `/api/timeline-export/start` (POST — was `BACKEND_SERVICE_URL`)
   - `/api/config` (GET — was `BACKEND_SERVICE_URL`)
   - `/api/ai-mixed-editing/start` (POST — was `BACKEND_SERVICE_URL`)
   - `/api/youtube/download` (POST)
   - `/api/image/generate` (POST)
   - `/api/video-understanding-script/generate` (POST)
   - `/api/user-materials/list` (GET)
   - `/api/workflow/list` (GET)
   - `/api/arkimage/status/<sample-id>` (GET)
   The selection deliberately includes one route per major module so any module-level auth regression is caught. The exact list in the shipped script is **derived from** `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md` (S01 audit); the implementer cross-checks the audit before finalizing the array. Note that **path correctness matters** — some Next.js routes do not 1:1 mirror the backend (e.g., `/api/admin/users/[userId]/toggle-status` → backend `/api/user/toggle-status/${userId}`). The smoke script always hits the **frontend / Nginx-fronted** URL (the same URL a real browser would use), not the backend port directly, so the script uses the Next.js route shape.
3. `AUTH_OK_ENDPOINTS` — same list as PROTECTED_ENDPOINTS but only those that are GET-able without parameters (or have a known-safe POST body). For POST endpoints with required bodies, the script uses minimal valid bodies stored as heredocs. The script accepts a 4xx **business** error (e.g., 422 validation) as PASS for Phase 3 — it only fails if the response is 401/403, which would indicate auth was not accepted

The lists are maintained in sync with `docs/plans/unified-api-auth-refactor/audit/backend-route-protection.md` (S01 audit). If a new router is added in the future, both files MUST be updated.

### 6.2 Output format

Colored output via ANSI codes (with a `--no-color` flag):
- ✓ green for pass
- ✗ red for fail
- — gray for skip
- Final summary block with totals

---

## 7. Test Infrastructure Setup Sequence

The S07 implementer follows this order:

1. Install Vitest + jsdom + dom helpers via `npm install -D`
2. Create `vitest.config.ts`
3. Create `src/test/setup.ts`
4. Add the `test` / `test:watch` / `test:coverage` / `test:integration` scripts to `package.json`
5. Run `npm test` — should pass (because S02/S03/S04/S05/S06 all wrote their tests as Vitest deliverables)
6. If any test fails, the failure is a real bug in the corresponding spec's deliverable — escalate to the owning agent for fix
7. Create `vitest.integration.config.ts`
8. Write `tests/integration/auth-flow.test.ts`
9. Write `tests/integration/backend-proxy-integration.test.ts`
10. Run `npm run test:integration` — should pass
11. Write `scripts/smoke-api-auth.sh` and make it executable
12. Run `bash scripts/smoke-api-auth.sh http://localhost:3000` against a local dev stack — should pass
13. Document the test commands in the audit deliverable

---

## 8. Files to Create / Modify

| File | Action | LoC est |
|---|---|---|
| `package.json` | Modify (add devDeps + scripts) | +15 |
| `vitest.config.ts` | Create | ~30 |
| `vitest.integration.config.ts` | Create | ~25 |
| `src/test/setup.ts` | Create | ~30 |
| `tests/integration/auth-flow.test.ts` | Create | ~400 |
| `tests/integration/backend-proxy-integration.test.ts` | Create | ~200 |
| `tests/integration/helpers/spawn-stack.ts` | Create (utilities to boot backend + frontend) | ~150 |
| `tests/integration/helpers/test-user.ts` | Create (fixture for creating + cleaning a test user) | ~80 |
| `scripts/smoke-api-auth.sh` | Create + chmod +x | ~250 |
| `docs/plans/unified-api-auth-refactor/audit/test-coverage-audit.md` | Create | ~100 |

**Estimated total: ~1280 LoC** (mostly the integration tests + smoke script). The unit tests come from sister specs and are NOT counted here.

---

## 9. Failure Modes & Edge Cases

| Edge case | Handling |
|---|---|
| Vitest install conflicts with existing devDeps | Use exact pinned versions; verify after install via `npm ls vitest` |
| Integration test backend boot is slow | Use `--reporter=verbose` and a fixture that times the boot, fail with a clear message if >30s |
| Backend uses absolute file paths for SQLite | Force in-memory: `DATABASE_URL=sqlite+aiosqlite:///:memory:` in test fixtures |
| Smoke script run from Windows | Provide a PowerShell sibling `scripts/smoke-api-auth.ps1` IF the team uses Windows in CI; otherwise WSL is fine. Verify with the team — if not needed, document `Run from WSL or Linux` in the script header |
| Vitest setup loads `backend.ts` before `process.env.BACKEND_URL` is set | The `setupFiles` config ensures setup runs before any test imports. Verify via a sentinel test that asserts `BACKEND_URL` is set BEFORE importing `backend.ts` |
| `npm test` runs the integration tests too | Use Vitest project filtering (`include` / `exclude`) so `npm test` runs only unit, `npm run test:integration` runs only integration |
| Test files share state across runs | Vitest isolates per-file by default; explicit `beforeEach` resets in setup file |
| Smoke script is run against a brand-new prod with no users | The script's Phase 3 SKIPs gracefully with `SMOKE_USER`/`SMOKE_PASS` unset — Phase 1 + 2 still run |
| The same proxy route exists multiple times in the codebase (S04 created it, S06 also created it) | The orchestration ordering (S04 → S06) prevents this. Verify with a grep in the audit |

---

## 10. Coordination Notes for Other Agents

- **For S01-S06:** Each prior spec writes its OWN unit tests. S07 only sets up the runner and verifies the tests execute. If S01-S06 deliverables don't include their tests, S07 implementation BLOCKS until the missing tests are produced
- **For S08 (deployment):** S07 produces the smoke script. S08 invokes it as part of the deployment playbook (Section 11.2 of the master plan). S08 cannot ship without S07 complete
- **For Inspector / Tester agents (Phase 5):** The tester agents in tripower governance use this test infrastructure to verify task completion. Each task's tester agent runs `npm test` + `pytest` + (after deploy) `bash scripts/smoke-api-auth.sh`
- **For future work:** CI pipeline setup (GitHub Actions / GitLab CI) is a follow-up ticket. The test commands defined here are CI-ready

---

## 11. Out of Scope

- CI pipeline configuration (GitHub Actions, GitLab CI, etc.) — separate ticket
- E2E browser tests (Playwright / Cypress) — the integration tests cover the critical flows without needing a real browser
- Visual regression tests — UI is unchanged by this refactor (except the login redirect on 401)
- Load testing / performance benchmarks — separate ticket
- Mutation testing — overkill for this scope
- Test result historical tracking / dashboards — separate ticket
- Backend test framework changes — pytest is kept; only the frontend gets a new runner
- Deleting or rewriting any existing backend tests — only the new middleware tests are added; existing tests must continue to pass unchanged
