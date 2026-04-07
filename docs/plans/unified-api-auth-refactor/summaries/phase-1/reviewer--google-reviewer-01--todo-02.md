# Reviewer Summary: google-reviewer-01

## Meta
- **Agent:** google-reviewer-01
- **Role:** REVIEWER
- **Task:** TODO 02 — Backend URL Config Module
- **Phase:** 1
- **Timestamp:** 2026-04-07T16:35:00Z
- **Verdict:** PASS

## Findings

### Correctness
1. **PASS** — `import 'server-only'` is the literal first line of `backend.ts` (line 1, verified by grep).
2. **PASS** — `loadBackendConfig()` is invoked at module top level via `export const backendConfig: BackendConfig = loadBackendConfig()` (line 105). The `process.env.BACKEND_URL` read happens inside `loadBackendConfig` once at module evaluation, not per request.
3. **PASS** — Production-mode missing-var error message at line 70-72 byte-matches spec §5: `'BACKEND_URL is required. Set it in .env.local or your environment file. Example: BACKEND_URL=http://localhost:8088'`.
4. **PASS** — Test-mode missing-var error message at line 66-68 byte-matches the post-fix spec §5 (uses `:8088`, not `:8000`): `"BACKEND_URL not set in test environment. Inject it via your test setup file before importing this module. Example: process.env.BACKEND_URL = 'http://localhost:8088'"`.
5. **PASS** — Malformed URL handled via `try { new URL(raw) } catch { throw ... }` (line 75-82). Error message at line 79-81 byte-matches spec §5: `` `BACKEND_URL is malformed: "${raw}". Expected a valid URL like http://localhost:8088 or https://api.example.com` ``. Offending value is included verbatim.
6. **PASS** — Trailing slash normalization via `parsed.toString().replace(/\/$/, '')` (line 85), exactly as the spec pseudocode prescribes.
7. **PASS** — `Object.freeze({ baseUrl, joinPath })` at line 94-97. Frozen object prevents both `baseUrl` reassignment and method replacement.
8. **PASS** — `joinPath('/api/x')` returns `baseUrl + path` (line 88-90).
9. **PASS** — `joinPath('api/x')` (no leading slash) returns `baseUrl + '/' + path` (line 91), producing the same result as the leading-slash variant. T6 idempotency test confirms.
10. **PASS** — `assertNoLegacyEnvVars()` exported as named binding (line 121). Uses `console.warn`, NOT throw. Returns void early when no legacy vars are set.
11. **PASS** — Both legacy lists are byte-identical: `LEGACY_ENV_VAR_NAMES = ['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL']` in `backend.ts` line 58 and `LEGACY_BACKEND_URL_ENV_VARS = ['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL']` in `next.config.js` line 20. Both files cross-reference each other in comments (backend.ts line 53-57, next.config.js line 15-18).

### AC Verification (hard checks)
12. **PASS** — `grep -n "localhost:8000" src/lib/config/backend.ts` returns EMPTY (verified by Bash). AC#8 satisfied. Also confirmed for `backend.test.ts` and `setup.ts` — neither file contains the literal `localhost:8000` (test file uses `http://stale:8000` as a different host for the legacy-var fixture, which does NOT match the AC#8 grep pattern).
13. **PASS** — Test-mode branch in `loadBackendConfig` (line 64-69) checks `isTest` BEFORE the production-mode throw. Message text matches the post-fix spec §5 byte-for-byte.
14. **PASS** — `assertNoLegacyEnvVars` is a top-level `export function`, importable as a named binding.
15. **PASS** — `next.config.js` legacy check is at top level (lines 20-29), runs unconditionally during `next dev`/`next build`/`next start` config load. Verified the code path: `require('./next.config.js')` executes the top-level statements, the `LEGACY_BACKEND_URL_ENV_VARS.filter(...)` runs, and `console.warn` fires if any legacy var is set. This is Spec §4.1 Option A variant (a) correctly implemented.

### Code Quality
16. **PASS** — Zero TypeScript `any` types in `backend.ts`. The 7 grep hits for "any" are all in JSDoc/comment text ("any attempt", "any future", etc.), not type annotations. The test file uses one localized `Record<string, string | undefined>` cast on `process.env` to work around `@types/node`'s readonly `NODE_ENV` declaration, which is the correct minimal-scope workaround (not `any`).
17. **PASS** — Error messages are operator-actionable: each one names the env var, suggests where to set it, and provides a concrete copy-pastable example. Production message says "Set it in .env.local"; test message says "Inject it via your test setup file"; malformed message includes the offending value plus an example URL. All three pass the "operator can fix this in 30 seconds" bar.
18. **PASS** — No dead code, no commented-out blocks. JSDoc is dense but purposeful; every comment block documents either contract, gotcha, or cross-reference.
19. **PASS** — `backend.ts` is 130 lines (well within the ~150 ceiling). The spec's ~80-line estimate was for code only; the additional 50 lines are all JSDoc which the spec encourages for the operator-facing surface.
20. **PASS** — Naming consistent: `backendConfig` (camelCase named export), `BackendConfig` (PascalCase interface), `LEGACY_ENV_VAR_NAMES` (SCREAMING_CASE for the source-of-truth constant), `loadBackendConfig` / `assertNoLegacyEnvVars` (camelCase functions).

### Test Quality
21. **PASS** — `backend.test.ts` line 45: `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'`. Valid Vitest import.
22. **PASS** — All T1-T9 from spec §7 are covered. Coverage matrix:
   - T1 → line 100-104
   - T2 → line 107-122 (two assertion variants — error matches and message text)
   - T2.b (test-mode error, an extra branch dev-02 added per spec §2 AC#5) → line 125-141
   - T3 → line 144-158 (two assertion variants)
   - T4 → line 161-166
   - T5 → line 169-175
   - T6 → line 178-192 (with idempotency check)
   - T7 → line 195-204 (frozen check + mutation throws TypeError)
   - T8 → line 209-252 (three variants — BACKEND_SERVICE_URL alone, PYTHON_BACKEND_URL alone, both together)
   - T9 → line 255-266
   - T10 → correctly excluded (build-time fixture, S07's deliverable) — documented as `TODO(S07)` in the test file header (line 17-19).
23. **PASS** — Every test has real assertions against module behavior. No tautologies. T7 uses `expect(Object.isFrozen(...)).toBe(true)` plus an actual mutation attempt that should throw `TypeError`. T8 uses `vi.spyOn(console, 'warn').mockImplementation(...)` and asserts the warning text contains the expected substrings.
24. **PASS** — `vi.resetModules()` is called in the global `beforeEach` (line 65) BEFORE each test, and every test that exercises the module uses `await import('../backend')` (dynamic import) to force a fresh top-level evaluation. The pattern is correct for the eager-evaluation constraint.
25. **PASS** — `setup.ts` line 54: `process.env.BACKEND_URL = 'http://localhost:8088'`. Sentinel set BEFORE any test imports. Comments at line 56-58 explicitly forbid importing `../backend` from setup, which would freeze the sentinel into the module cache and defeat `vi.resetModules()`.

### Integration / Contract
26. **PASS** — Exported `backendConfig` exposes exactly `{ baseUrl: string, joinPath: (path) => string }`. No extra fields. T04/T06 will not need to update if they import only these two.
27. **PASS** — `export const backendConfig: BackendConfig = loadBackendConfig()` (line 105) is a NAMED export. T04/T06 will use `import { backendConfig } from '@/lib/config/backend'` exactly as the spec §3.1 prescribes.

### Security / G3 / G4
28. **PASS** — `import 'server-only'` is line 1, verified installed at `node_modules/server-only/`. Any client component that transitively imports `backend.ts` will fail `next build` with the canonical server-only error. G4 is enforced.
29. **PASS** — No hardcoded URLs in `backend.ts`. The literal default-URL footgun pattern (`process.env.X || 'http://localhost:...'`) is absent.

### Completeness
30. **PASS** — All 6 deliverables from spec §6 are present:
   - `src/lib/config/backend.ts` ✓
   - `src/lib/config/__tests__/backend.test.ts` ✓
   - `src/lib/config/__tests__/setup.ts` ✓
   - `next.config.js` ✓ (modified, legacy var inline check at lines 1-29)
   - `env.template` ✓ (modified, lines 51-68 document the canonical and deprecated names)
   - `package.json` ✓ (modified, `server-only ^0.0.1` added at line 33)
31. **PASS** — Re-read spec §6: T02 has no audit deliverable. The spec only requires the implementation + test files + the next.config.js / env.template / package.json modifications. dev-02 correctly delivered all of them.

## Excellence Notes (D10 candidates)

- **Caught and resolved a real spec contradiction.** dev-02 identified that spec §5 originally referenced `'http://localhost:8000'` in the test-mode error example, which directly contradicted spec §2 AC#8's hard grep guard. Rather than silently breaking AC#8 OR silently breaking the §5 byte-match contract, dev-02 surfaced the conflict in the dev summary, made the principled call (verifier wins, port substitution preserves diagnostic value), and explicitly flagged it for review. The orchestrator subsequently ratified the substitution and updated spec §5. This is exactly the "disclose conflicts upstream" behavior the Three-Powers governance is supposed to incentivize. **D10 candidate: yes.**
- **Source-of-truth list discipline.** dev-02 recognized that the legacy-var list MUST be duplicated in two places (TS module + CommonJS config) and added cross-referencing comments in BOTH files explicitly calling out the sync requirement. This is the kind of forward-looking maintenance hint that a careless implementer would skip.
- **Documented the eager-evaluation gotcha in three places** (`setup.ts` header, `backend.test.ts` header, and the `vi.resetModules()` `beforeEach` itself). Future maintainers wiring up Vitest in T07 will have a clear "why" for the pattern.
- **Smoke-tested the module behavior via a `.mjs` mirror** before declaring done — verified all five error/success branches by hand, then deleted the harness. This is the right move when the test runner is not yet wired up.
- **Documented the `server-only` Vitest gotcha for T07** (the package needs to be externalized or stubbed in `vitest.config.ts`). This unblocks T07 from a half-day debug session.

## Risks for Tester

1. **Vitest not yet installed** — `npm test` does not exist. The tester cannot run `backend.test.ts` until T07 lands. This is per spec §6.1 and is NOT a defect. The tester should EXECUTE the test file only after T07's `vitest.config.ts` is in place. When that happens, ensure the Vitest config either externalizes `server-only` or aliases it to its no-op stub at `node_modules/server-only/index.js`.
2. **`process.env.NODE_ENV` mutation in tests** — dev-02 worked around `@types/node`'s readonly typing via `const env = process.env as Record<string, string | undefined>`. The runtime is mutable, but if a future Node/`@types/node` version changes `process.env`'s actual mutability semantics (vanishingly unlikely but theoretically possible), the tests could behave unexpectedly. Tester should verify `process.env.NODE_ENV = 'production'` actually takes effect under the Vitest runner.
3. **`Object.freeze` strict-mode dependency** — T7 asserts `expect(...).toThrow(TypeError)` for the mutation attempt. This requires strict mode, which Vitest enables by default for ESM. If T07's `vitest.config.ts` somehow disables strict mode, T7 will fail because non-strict mode silently swallows the assignment instead of throwing. Tester should confirm Vitest's strict-mode default is preserved.
4. **`git stash@{0}` in working tree** — dev-02's report disclosed that an earlier `git stash` operation captured peer agents' in-progress work (T01 backend middleware files, T03 http-client + AuthContext) along with dev-02's own files. I verified the working tree currently contains all of T01's files (`backend-services/basic-service/app/middleware/auth_middleware.py`, modified `auth.py`, modified `main.py`) and T03's files (`src/lib/api/http-client.ts`, `src/contexts/AuthContext.tsx`). **No data loss occurred** — the stash is a backup snapshot, but the working tree has the live versions. The orchestrator should still own the stash cleanup decision; do NOT drop it without orchestrator approval.

## Context for Downstream

- **Spec changed since first issue:** Spec §5's test-mode example was updated from `:8000` to `:8088` to resolve a contradiction with AC#8. Dev-02's implementation matches the post-fix spec exactly. This is the only spec drift in this task.
- **Contract for T04/T06:** Import `import { backendConfig } from '@/lib/config/backend'`. Use `backendConfig.baseUrl` for raw concatenation (avoid this) or `backendConfig.joinPath('/api/...')` for URL construction (preferred — handles both leading-slash and bare-path inputs). The module throws fast at boot if `BACKEND_URL` is missing, so dev/CI environments MUST set it. There is no fallback by design.
- **Contract for T07:** S07's `vitest.config.ts` must (a) wire `src/lib/config/__tests__/setup.ts` as a setup file, (b) externalize `server-only` (or alias it to a stub), and (c) preserve strict-mode ESM defaults so the frozen-object mutation test throws. The 17 dormant tests in `backend.test.ts` will then run automatically with no edits.
