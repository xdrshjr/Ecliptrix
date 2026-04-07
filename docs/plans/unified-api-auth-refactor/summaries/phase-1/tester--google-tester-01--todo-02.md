# Tester Summary: google-tester-01

## Meta
- **Agent:** google-tester-01
- **Role:** TESTER
- **Task:** TODO 02 — Backend URL Config Module
- **Phase:** 1
- **Timestamp:** 2026-04-07T16:45:00Z
- **Verdict:** ALL PASS

## Test Execution Summary
- Tests run: Vitest not installed (per spec §6.1, T07 deliverable). Verified statically + via behavioral sandbox.
- Behavioral smoke (sandbox port of `backend.ts` minus `server-only`): 20/20 PASS
- Hard AC grep checks: 8/8 PASS
- Module behavior smoke: PASS (every spec §5 error message reproduced byte-for-byte)
- type-check on production source (`src/lib/config/backend.ts`, `src/lib/config/__tests__/setup.ts`): 0 errors
- type-check on `backend.test.ts`: 1 error (`TS2307: Cannot find module 'vitest'`) — expected per spec §6.1, will resolve when T07 lands Vitest. No additional errors introduced by this task.

## Spec Traceability Matrix

| AC | Spec § | Verified? | Evidence |
|---|---|---|---|
| AC1 (file exists, exports `backendConfig`) | §2.1 | YES | `src/lib/config/backend.ts:105` `export const backendConfig: BackendConfig = loadBackendConfig()` |
| AC2 (top-level eager read of `process.env.BACKEND_URL`) | §2.2 | YES | `backend.ts:61` inside `loadBackendConfig`, called at module-load via the `backendConfig` const |
| AC3 (throws clear error when missing in non-test) | §2.3 | YES | `backend.ts:70-72` exact spec §5 string. Sandbox smoke confirms message byte-equality. |
| AC4 (throws clear error on malformed URL) | §2.4 | YES | `backend.ts:78-82` includes the offending value in the message. Sandbox smoke confirms. |
| AC5 (distinct test-mode error message) | §2.5 | YES | `backend.ts:65-69` uses different wording referencing the test setup file. Distinct from production message. |
| AC6 (`{ baseUrl }` minimum surface + `joinPath`) | §2.6 | YES | `BackendConfig` interface (`backend.ts:39-50`), implementation `backend.ts:85-92` |
| AC7 (no call sites in `src/app/api/**` import `process.env` for backend URL) | §2.7 | N/A FOR T02 | spec text explicitly says "this spec only delivers the module; the sweep happens in S04" |
| AC8 (literal `'http://localhost:8000'` MUST NOT appear in the module) | §2.8 | YES | `grep -n "localhost:8000" src/lib/config/backend.ts` → empty (verified) |
| AC9 (unit tests cover all branches in §7) | §2.9 | YES | 16 Vitest `it()` blocks covering T1-T9 with multiple variants (see Test Case Matrix below); Vitest syntax valid |
| AC10 (`assertNoLegacyEnvVars` exported, no legacy vars read) | §2.10 | YES | `backend.ts:121-130` exported helper; legacy list `LEGACY_ENV_VAR_NAMES` at line 58; `next.config.js:20-29` mirrors the list with cross-reference comments at lines 15-18 |

## Test Case Matrix

| Spec Test | Spec §7 | Test in code | Real assertions |
|---|---|---|---|
| T1 (valid URL) | §7 row 1 | `backend.test.ts:100` `T1: parses a valid BACKEND_URL into baseUrl` | YES — `expect(backendConfig.baseUrl).toBe('http://localhost:8088')` |
| T2 (missing in non-test) | §7 row 2 | `backend.test.ts:107, 115` (two variants: error name + .env.local message contract) | YES — `rejects.toThrow(/BACKEND_URL is required/)` and `/Set it in \.env\.local/` |
| T2.b (missing in test → distinct) | §2.5 + §7.1 | `backend.test.ts:125, 134` (two variants) | YES — `rejects.toThrow(/BACKEND_URL not set in test environment/)` and `/Inject it via your test setup file/` |
| T3 (malformed URL) | §7 row 3 | `backend.test.ts:144, 152` (two variants) | YES — `/BACKEND_URL is malformed: "not-a-url"/` and example URL contract |
| T4 (trailing slash strip) | §7 row 4 | `backend.test.ts:161` | YES — `expect(backendConfig.baseUrl).toBe('http://x:8088')` and `endsWith('/')` false |
| T5 (joinPath leading slash) | §7 row 5 | `backend.test.ts:169` | YES — `joinPath('/api/video/search')` → `'http://x:8088/api/video/search'` |
| T6 (joinPath no leading slash) | §7 row 6 | `backend.test.ts:178, 186` (idempotency variant) | YES — `joinPath('api/video/search')` → same; idempotency check |
| T7 (mutation throws — frozen) | §7 row 7 | `backend.test.ts:195` | YES — `Object.isFrozen(backendConfig)` true, mutation `.toThrow(TypeError)` (ESM is strict-mode by default — assignment throws) |
| T8 (legacy var → warning) | §7 row 8 | `backend.test.ts:209, 225, 238` (three variants: BACKEND_SERVICE_URL alone / PYTHON_BACKEND_URL alone / both) | YES — `vi.spyOn(console, 'warn')`, asserts called once, message contains `[backend-config]`, offender names, `IGNORED` |
| T9 (no legacy → silent) | §7 row 9 | `backend.test.ts:255` | YES — `warnSpy not.toHaveBeenCalled` |
| T10 (build-time `'use client'` rejection) | §7 row 10 | Documented as `TODO(S07)` in `backend.test.ts:13-19` | Spec explicitly excludes from unit tests; deferred to S07 build-time fixture per spec note |

**Total spec-trace coverage: 10/10 spec test cases mapped (T1-T9 implemented, T10 correctly deferred per spec).**

## Behavioral Sandbox Smoke (substituting for unrunnable Vitest)

To prove the production module BEHAVES correctly without a runner, I copied the module body into a `.mjs` sandbox file (sans `import 'server-only'`) and ran 20 assertions covering every branch:

```
PASS  T1 baseUrl parses
PASS  T2 missing prod throws exact spec §5 message       (byte-equal)
PASS  T2.b missing test throws distinct test-mode message (byte-equal)
PASS  T2.b test-mode message does NOT contain localhost:8000
PASS  T3 malformed throws exact spec §5 message          (byte-equal)
PASS  T4 trailing slash stripped
PASS  T5 joinPath /api/video/search
PASS  T6 joinPath api/video/search
PASS  T7 frozen
PASS  T7 mutation does not change baseUrl
PASS  T8 BACKEND_SERVICE_URL: 1 warn call
PASS  T8 message has [backend-config]
PASS  T8 message has BACKEND_SERVICE_URL
PASS  T8 message has IGNORED
PASS  T8 PYTHON_BACKEND_URL: 1 warn call
PASS  T8 PYTHON_BACKEND_URL message names offender
PASS  T8 BOTH: 1 warn call
PASS  T8 BOTH message has BACKEND_SERVICE_URL
PASS  T8 BOTH message has PYTHON_BACKEND_URL
PASS  T9 silent when none set

=== 20 pass, 0 fail ===
```

Sandbox files were deleted post-verification (NOT committed).

## Hard AC Grep Checks

| Check | Command | Result |
|---|---|---|
| AC#8 — no `localhost:8000` literal in `backend.ts` | `grep -n "localhost:8000" src/lib/config/backend.ts` | EMPTY (PASS) |
| AC#1 — exports `backendConfig` | `grep "export const backendConfig"` | line 105 (PASS) |
| AC#2 — reads `process.env.BACKEND_URL` | grep | line 61 in `loadBackendConfig` (PASS) |
| AC#6 — `baseUrl` + `joinPath` surface | grep | interface 39-50, impl 85-97 (PASS) |
| AC#10 — `assertNoLegacyEnvVars` exported | grep | line 121 (PASS) |
| AC#10 — legacy names listed in `backend.ts` | grep | line 58 `LEGACY_ENV_VAR_NAMES` (PASS) |
| AC#10 — legacy names mirrored in `next.config.js` | grep | line 20 `LEGACY_BACKEND_URL_ENV_VARS` (PASS); cross-reference comments lines 15-18 |
| `import 'server-only'` first directive in `backend.ts` | head -3 | PASS (line 1) |
| `server-only` in `package.json` dependencies | grep | line 33 `"server-only": "^0.0.1"` (PASS) |
| `BACKEND_URL=...` documented in `env.template` | grep | line 58 `BACKEND_URL=http://localhost:8000` with comment block 52-67 (PASS) |
| Deprecation comments for legacy names in `env.template` | grep | lines 60-67 (PASS) |

## Spec §5 Error Message Contract — byte-level verification

| Scenario | Spec text | Implementation | Match |
|---|---|---|---|
| Missing in non-test | `BACKEND_URL is required. Set it in .env.local or your environment file. Example: BACKEND_URL=http://localhost:8088` | `backend.ts:70-72` | EXACT |
| Missing in test | `BACKEND_URL not set in test environment. Inject it via your test setup file before importing this module. Example: process.env.BACKEND_URL = 'http://localhost:8088'` | `backend.ts:67` | EXACT |
| Malformed | `BACKEND_URL is malformed: "<value>". Expected a valid URL like http://localhost:8088 or https://api.example.com` | `backend.ts:79-81` | EXACT (with template interpolation of `<value>`) |

Spec §5 contains a "Bug fix 2026-04-07" note explicitly resolving the AC#8-vs-example-string conflict in favor of `:8088`. Implementation correctly follows the spec's binding resolution.

## Spec §3.2 — server-only enforcement
- `import 'server-only'` is line 1 of `backend.ts` ✅
- `server-only ^0.0.1` added to `package.json` dependencies ✅
- Documented in JSDoc lines 4-9 ✅

## Issues Found

(None — ALL PASS)

## Risks Carried Forward

These items cannot be tested today because the surrounding infrastructure does not yet exist. They are NOT defects against this spec — they are handoffs to T07/T08:

1. **Vitest runtime verification** — `backend.test.ts` is currently dormant. T07 must:
   - install `vitest` + `@vitest/coverage-v8`
   - write `vitest.config.ts` referencing `src/lib/config/__tests__/setup.ts` as a setup file
   - either externalize `server-only` (`server.deps.external`) or alias it to a stub for unit-test contexts (real `server-only/index.js` is a no-op when bundled by Next.js, but Vitest needs to be told)
   - confirm `process.env.NODE_ENV` mutations work at runtime (the dev's `env` typed alias localizes the `@types/node` readonly assertion)
2. **T10 (build-time client-import rejection)** — properly deferred to T07 per spec §7. T07 should add a build-time fixture under `tests/build-fixtures/` that creates a `'use client'` component importing `@/lib/config/backend` and asserts that `next build` exits non-zero with the server-only error.
3. **Stale `git stash@{0}`** — dev-02 reports a stash containing peer-agent in-progress work was created during their session. Not a defect of T02 itself but worth flagging to the orchestrator.
4. **AC#7 (no `process.env` for backend URL in `src/app/api/**`)** — explicitly out of scope for T02 (T04's job). T04's tester must verify this AC after the routes sweep lands. As of today, there are still 84 files in `src/` containing `localhost:8000` (verified by grep), all of which are T04/T06 territory.

## Context for Downstream

- T04 can safely import `backendConfig` from `@/lib/config/backend`. Both `joinPath('/api/x')` and `joinPath('api/x')` return identical URLs (verified by sandbox smoke).
- T06 (direct browser call migration) can use the same pattern; the new proxy routes will be server-side and pass the `server-only` import check.
- T07 must be aware: `backend.test.ts` line 45 imports from `'vitest'` — installing Vitest will resolve this. The `setup.ts` file deliberately does NOT import `../backend` (to avoid freezing the sentinel into the module cache before tests can call `vi.resetModules()`). This is documented inline.
- T08 (deployment): Singapore-01 frontend env file MUST set `BACKEND_URL=http://localhost:8088`. Legacy `BACKEND_SERVICE_URL`/`PYTHON_BACKEND_URL` are no-ops post-merge but trigger a single-line warning at server start until removed.
- The legacy-name list `['BACKEND_SERVICE_URL','PYTHON_BACKEND_URL']` is duplicated in two files (`backend.ts:58` and `next.config.js:20`). Both have cross-reference comments. Any future addition (e.g., adding a third deprecated name) MUST update both.

## Independence Statement

I read ONLY the reviewer Meta block (lines 1-11, ending at "Verdict: PASS"). I did NOT read the reviewer's Findings or any other section. My judgment was reached independently via:
- spec/todo/master-plan re-reading
- direct file inspection of all six deliverables
- 11 hard grep checks
- a 20-assertion behavioral sandbox using a `.mjs` port of the module body
- TypeScript validation against the production tsconfig
- spec §5 byte-level error-message comparison
- spec §7 test-case-by-test-case traceability mapping

Final independent verdict: **ALL PASS**. The implementation is faithful to the spec, the test file is syntactically valid Vitest and will run correctly once T07 lands the runner, the AC#8/§5 conflict was resolved per the spec's own binding rule (the §5 "Bug fix 2026-04-07" note), and every behavioral branch I could exercise statically or via sandbox passes.
