# TODO 07: Testing Suite (Unit + Integration + Smoke)

> **Spec:** [specs/07-testing-suite.md](../specs/07-testing-suite.md)

## Dependencies

```yaml
depends_on: [01, 02, 03, 04, 05, 06]
blocks: [08]
parallel_group: D
```

- **Depends on T01-T06** — sets up the runner that runs the unit tests delivered by sister specs, AND adds integration tests that exercise the full stack
- **Blocks T08 (deployment)** — deploy is gated by passing tests + the smoke script must exist for verification
- **Parallel group D** — runs in Phase 4 alone (single test infra spec)

## Tasks

- [ ] Read sibling spec `07-testing-suite.md` end to end
- [ ] **Step 1: Install Vitest + dom helpers**
  - [ ] `npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/jest-dom @testing-library/react`
  - [ ] Verify install: `npm ls vitest`
- [ ] **Step 2: Create `vitest.config.ts`** at repo root with: `environment: 'jsdom'`, `setupFiles: ['./src/test/setup.ts']`, `globals: true`, `resolve.alias: { '@': './src' }`
- [ ] **Step 3: Create `src/test/setup.ts`** that:
  - [ ] Sets `process.env.BACKEND_URL = 'http://localhost:8000'` BEFORE any imports
  - [ ] Mocks `window.localStorage` with an in-memory store
  - [ ] Imports `@testing-library/jest-dom`
  - [ ] Resets all mocks via `beforeEach`
- [ ] **Step 4: Add `package.json` scripts:**
  - [ ] `"test": "vitest run"`
  - [ ] `"test:watch": "vitest"`
  - [ ] `"test:coverage": "vitest run --coverage"`
  - [ ] `"test:integration": "vitest run --config vitest.integration.config.ts"`
- [ ] **Step 5: Run `npm test`** — should execute every Vitest file delivered by T02-T06 (~88-94 cases). If any fail, escalate to the owning agent
- [ ] **Step 6: Verify backend tests still pass** — `cd backend-services/basic-service && pytest tests/ -v` exits 0
- [ ] **Step 7: Create `vitest.integration.config.ts`** with:
  - [ ] `testTimeout: 90000`
  - [ ] `include: ['tests/integration/**/*.test.ts']`
  - [ ] Same alias config as `vitest.config.ts`
  - [ ] No setup file (integration tests boot real services)
- [ ] **Step 8: Create `tests/integration/helpers/spawn-stack.ts`**
  - [ ] Function `getFreePort()` using `net.createServer().listen(0)`
  - [ ] Function `spawnBackend(port)` that spawns `uvicorn app.main:app --port <port>` with `DATABASE_URL=sqlite+aiosqlite:///:memory:` env
  - [ ] Function `spawnFrontend(port, backendUrl)` that spawns `next dev -p <port>` with `BACKEND_URL=<backendUrl>` env
  - [ ] Readiness probe with 30s ceiling polling `/api/health`
  - [ ] Teardown via `process.kill('SIGTERM')` then SIGKILL fallback after 5s
  - [ ] Use suite-level `beforeAll`/`afterAll` to amortize boot cost
  - [ ] **Fallback**: if spawn proves flaky, document the alternative ESM-handler-import approach in a comment block (per spec §2.4 realism guardrails)
- [ ] **Step 9: Create `tests/integration/helpers/test-user.ts`**
  - [ ] Fixture to register a test user via `/api/auth/register` and capture the session token
  - [ ] Cleanup after suite completes
- [ ] **Step 10: Create `tests/integration/auth-flow.test.ts`** with all 15 cases (I1-I15) from spec §5
- [ ] **Step 11: Create `tests/integration/backend-proxy-integration.test.ts`** that calls the proxy helper against a real backend (not mocked)
- [ ] **Step 12: Run `npm run test:integration`** — must pass
- [ ] **Step 13: Create `scripts/` directory** (does not exist yet — `mkdir scripts`)
- [ ] **Step 14: Create `scripts/smoke-api-auth.sh`** per spec §6
  - [ ] Pseudocode → real bash, ensure shebang `#!/usr/bin/env bash`
  - [ ] Three phases: allowlist anonymous, protected anonymous, authenticated success
  - [ ] Define `ALLOWLIST_ENDPOINTS`, `PROTECTED_ENDPOINTS` (≥20 entries), `AUTH_OK_ENDPOINTS` arrays
  - [ ] Reads `SMOKE_USER`, `SMOKE_PASS` env vars, skips Phase 3 gracefully if unset
  - [ ] Colored ANSI output with `--no-color` flag
  - [ ] Exit code 0 only if all checks pass
  - [ ] Endpoint list synced with `audit/backend-route-protection.md` (T01 deliverable)
  - [ ] `chmod +x scripts/smoke-api-auth.sh`
- [ ] **Step 15: Smoke-test the smoke script locally:**
  - [ ] Start dev stack: `bash start.sh --dev`
  - [ ] Run `bash scripts/smoke-api-auth.sh http://localhost:3000` — should pass without `SMOKE_USER` set
  - [ ] Set `SMOKE_USER`/`SMOKE_PASS` to a real test account, re-run — full pass
- [ ] **Step 16: Create test-coverage audit** at `docs/plans/unified-api-auth-refactor/audit/test-coverage-audit.md` listing:
  - [ ] Total Vitest cases per file
  - [ ] Total pytest cases for `test_auth_middleware.py`
  - [ ] Coverage percentages for `http-client.ts`, `backend-proxy.ts`, `auth_middleware.py`
  - [ ] Integration test results (PASS/FAIL counts)
  - [ ] Smoke script results from local dev stack
- [ ] Run `npm run type-check` — must pass (test files included)
- [ ] Sync `vitest.config.ts`, `vitest.integration.config.ts`, `src/test/`, `tests/integration/`, `scripts/smoke-api-auth.sh`, `package.json`, `package-lock.json`, audit doc to Singapore-01 staging area
- [ ] Write execution summary at `summaries/phase-4/dev--<agent-id>--todo-07.md`
- [ ] Mark TODO complete in the agent's completion report
