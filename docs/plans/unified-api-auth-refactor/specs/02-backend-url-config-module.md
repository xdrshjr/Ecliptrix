# Spec 02: Backend URL Config Module (Server-Side)

> **Owner role:** Frontend developer (Next.js BFF layer)
> **Layer:** Next.js server-side (`src/lib/config/`)
> **Depends on:** None (Phase 1 — independent)
> **Blocks:** S04 (route handlers will import from this), S06 (new proxy routes will import from this)

---

## 1. Purpose

Eliminate the 84+ scattered `process.env.BACKEND_URL || 'http://localhost:8000'` reads across `src/app/api/**/route.ts` by creating a single, server-side TypeScript module that:

1. Reads `process.env.BACKEND_URL` **exactly once** at module load
2. Validates the URL format
3. Throws fast at boot if missing in non-test environments
4. Exports a typed object that route handlers and proxy helpers consume

This makes adding a new env var name (or changing the default) a one-line, one-place change — and forces fail-fast behavior so the next port migration doesn't silently fall back to a wrong URL.

---

## 2. Acceptance Criteria

1. New file `src/lib/config/backend.ts` exists and exports a typed object (e.g., `backendConfig`)
2. The module reads `process.env.BACKEND_URL` at top-level (module evaluation time), not lazily per call
3. If `BACKEND_URL` is missing AND `process.env.NODE_ENV !== 'test'`: the module **throws** a clear error (`Error: BACKEND_URL is required (got: undefined). Set it in .env.local or environment.`)
4. If `BACKEND_URL` is malformed (cannot be parsed by `new URL(...)`): the module throws a clear error including the offending value
5. If `process.env.NODE_ENV === 'test'` AND `BACKEND_URL` is unset: the module throws a **distinct, test-specific error** (different message from production-mode missing — see Section 5) instructing the developer to inject `BACKEND_URL` via the test runner's setup file BEFORE the first import. There is NO code-level fallback in either mode. The reason for the distinct test message is purely diagnostic — it points the developer at the right fix (the test setup file) instead of `.env.local`
6. The exported object has at minimum `{ baseUrl: string }`. Additional convenience helpers MAY be added (e.g., `joinPath(path: string): string`) but the minimum surface is `baseUrl`
7. NO call sites in `src/app/api/**/route.ts` import `process.env` for backend URL after S04 completes (this spec only delivers the module; the sweep happens in S04)
8. The literal string `'http://localhost:8000'` MUST NOT appear anywhere inside the new module
9. Unit tests in `src/lib/config/__tests__/backend.test.ts` cover: missing var throws, malformed URL throws, valid URL parses, trailing-slash normalization, frozen-object immutability, and the legacy-env-var warning helper. Tests are written using Vitest syntax and become live once S07 installs the runner (see Section 6.1 for the deliberate split). Coverage MUST include every branch enumerated in Section 7 (Test Matrix)
10. The deprecated environment variable names `BACKEND_SERVICE_URL` and `PYTHON_BACKEND_URL` are NOT read by this module. The module exports an optional helper `assertNoLegacyEnvVars()` that **logs a console warning** (not throws) if either is set. Note: per Section 4.1 the recommended invocation site is `next.config.js`, which is CommonJS and cannot directly import a `.ts` ESM module — so the helper exists in `backend.ts` for completeness and for any future TypeScript caller (e.g., `instrumentation.ts`), while `next.config.js` inlines an equivalent check. Both implementations MUST share the exact same legacy-name list (`['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL']`) and emit the same warning text

---

## 3. Module Surface (pseudocode)

```ts
// src/lib/config/backend.ts
// SERVER-SIDE ONLY — must not be imported from any file under src/app/(client) or any 'use client' module

interface BackendConfig {
  readonly baseUrl: string         // e.g., "http://localhost:8088" — no trailing slash
  joinPath(path: string): string   // backendConfig.joinPath('/api/video/search')
                                   //   → "http://localhost:8088/api/video/search"
}

function loadBackendConfig(): BackendConfig {
  const raw = process.env.BACKEND_URL
  const isTest = process.env.NODE_ENV === 'test'

  if (!raw && !isTest) {
    throw new Error('BACKEND_URL is required ...')
  }
  if (!raw && isTest) {
    throw new Error('BACKEND_URL not set in test env. Inject via setup file ...')
  }

  // validate
  let parsed: URL
  try { parsed = new URL(raw) } catch { throw new Error(`BACKEND_URL is malformed: ${raw}`) }

  // normalize: strip trailing slash
  const baseUrl = parsed.toString().replace(/\/$/, '')

  return Object.freeze({
    baseUrl,
    joinPath: (path) => baseUrl + (path.startsWith('/') ? path : '/' + path),
  })
}

export const backendConfig = loadBackendConfig()
```

### 3.1 Naming and import convention

- Always import as the named binding: `import { backendConfig } from '@/lib/config/backend'`
- Never re-export under a different name; this creates audit ambiguity
- Path alias: uses `@/lib/config/backend` (matches existing `tsconfig.json` `@/*` → `./src/*`)

### 3.2 Server-only enforcement

The module MUST be safe ONLY on the server. To prevent accidental client imports:
1. Add the directive `import 'server-only'` at the top of the file (`server-only` is a tiny npm package maintained by the React team, used by Next.js 13+; importing it causes the build to fail if the module is pulled into any client component bundle)
2. Document it in the JSDoc comment
3. This is non-negotiable: leaking the backend URL to the browser is a regression of master plan G4

**Dependency note:** The `server-only` package is NOT currently a dependency of this repo (verified against `package.json` at spec time — Next.js 15.4.5 does not pull it transitively as a runtime dep). The implementer MUST add `server-only` to `dependencies` in `package.json` (`npm install server-only`) as part of this spec. This is a single tiny package (no transitive deps) and is the canonical Next.js mechanism for server-only enforcement.

---

## 4. Legacy env var detection

```ts
// src/lib/config/backend.ts  (continued)

export function assertNoLegacyEnvVars(): void {
  const legacy = ['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL']
  const found = legacy.filter(name => process.env[name] !== undefined)
  if (found.length > 0) {
    console.warn(
      `[backend-config] Legacy env vars detected and IGNORED: ${found.join(', ')}. ` +
      `Only BACKEND_URL is read. Remove these from your .env to silence this warning.`
    )
  }
}
```

- This is a soft warning, not an error — operators with stale `.env` files will see the warning at boot but the app will still start
- Called from `next.config.js` (or instrumentation hook in Next.js 15) so the warning fires once at server start, not per request

### 4.1 Where to call `assertNoLegacyEnvVars()`

Two options, decided by the implementer:
- **Option A (preferred):** `next.config.js` top-level — runs once at config load. **Verified at spec time:** the existing `next.config.js` is CommonJS (`module.exports = nextConfig`), so the helper cannot be imported directly from the TypeScript module via ESM `import`. The implementer must either (a) inline a tiny CommonJS-compatible duplicate of the legacy-var check directly in `next.config.js` (~10 lines, no shared code), or (b) create a `src/lib/config/legacy-env-check.cjs` shim that `next.config.js` `require()`s. Option (a) is simpler and preferred because the check is trivial. Logs the warning during `next dev` and `next build` startup.
- **Option B (fallback):** Next.js 15's `instrumentation.ts` `register()` hook — runs once at server start. More idiomatic and supports TypeScript imports natively, but `instrumentation.ts` does NOT currently exist in this repo (verified at spec time) and creating one introduces a new conventional file the team will need to maintain.

Choose **Option A variant (a)** — inline the check in `next.config.js` — unless the implementer judges Option B is worth the new file. Either way, the logic stays in sync with the source-of-truth list `['BACKEND_SERVICE_URL', 'PYTHON_BACKEND_URL']` defined in `backend.ts`; if the list changes in the future, both call sites must be updated together.

---

## 5. Error message contract

The error messages emitted by this module are user-facing for operators. They MUST be:

| Scenario | Exact message |
|---|---|
| Missing in non-test | `BACKEND_URL is required. Set it in .env.local or your environment file. Example: BACKEND_URL=http://localhost:8088` |
| Missing in test | `BACKEND_URL not set in test environment. Inject it via your test setup file before importing this module. Example: process.env.BACKEND_URL = 'http://localhost:8088'` |
| **Bug fix 2026-04-07:** | Original spec example used `localhost:8000` but that contradicts AC#8 (no `localhost:8000` literal anywhere in the module). AC#8 wins because it's a hard grep verification check; the example is illustrative. Use `:8088` (the production port, used in every other spec example). |
| Malformed URL | `BACKEND_URL is malformed: "<value>". Expected a valid URL like http://localhost:8088 or https://api.example.com` |

Concrete strings let operators grep the codebase or copy-paste into search engines.

---

## 6. Files to Create / Modify

| File | Action | LoC estimate |
|---|---|---|
| `src/lib/config/backend.ts` | Create | ~80 |
| `src/lib/config/__tests__/backend.test.ts` | Create (see Section 6.1 — may be a stub if no test runner is installed yet) | ~120 |
| `src/lib/config/__tests__/setup.ts` | Create (test bootstrap injecting `BACKEND_URL`) | ~10 |
| `next.config.js` | Modify (add legacy var warning — see Section 4.1) | +12 |
| `env.template` (root) | Modify (add a documented `BACKEND_URL=http://localhost:8000` line and explicitly mark `BACKEND_SERVICE_URL` / `PYTHON_BACKEND_URL` as deprecated/no-op in a comment so operators upgrading from older `.env.local` files understand the change) | +6 |
| `package.json` | Modify (add `server-only` to `dependencies`) | +1 |

**Estimated total LoC: ~230**

### 6.1 Test runner state and what to deliver

**Verified at spec time:** the root `package.json` does NOT currently declare any frontend test runner (no `vitest`, no `jest`, no `@testing-library/*`). The repo's only test suites today are the backend pytest suites. This means S02 cannot, by itself, "run" the unit tests it ships — there is no `npm test` script.

The decision is to keep the test files as **first-class deliverables of S02** (not deferred to S07) but to be explicit about the runtime gap:

1. The implementer writes `backend.test.ts` and `setup.ts` using **Vitest** syntax (`import { describe, it, expect, beforeEach } from 'vitest'`). Vitest is the chosen frontend test runner for this refactor — see S07 for the rationale and the wider test-infra setup.
2. S02 does NOT install Vitest, configure `vitest.config.ts`, or add an `npm test` script. Those are S07 deliverables.
3. The test file is therefore "dormant" until S07 lands. S07's first task is `npm install -D vitest @vitest/coverage-v8` plus `vitest.config.ts`, after which the S02 test file runs automatically as part of the suite.
4. If, during execution, S07 has not yet started but the implementer wants smoke-validation, a temporary `node --test` or ad-hoc script is acceptable but MUST NOT be committed.

This split keeps S02 self-contained (delivers the module + its tests) without forcing a test-infra decision into the wrong spec.

---

## 7. Test Matrix

| # | Scenario | Expected |
|---|---|---|
| T1 | `BACKEND_URL='http://localhost:8088'` → import module | success, `backendConfig.baseUrl === 'http://localhost:8088'` |
| T2 | `BACKEND_URL` unset, `NODE_ENV !== 'test'` → import module | throws "BACKEND_URL is required" |
| T3 | `BACKEND_URL='not-a-url'` → import module | throws "BACKEND_URL is malformed" |
| T4 | `BACKEND_URL='http://x:8088/'` (trailing slash) → `baseUrl` | normalized, no trailing slash |
| T5 | `backendConfig.joinPath('/api/video/search')` | `'http://x:8088/api/video/search'` |
| T6 | `backendConfig.joinPath('api/video/search')` (no leading slash) | `'http://x:8088/api/video/search'` (still works) |
| T7 | Mutation attempt: `backendConfig.baseUrl = 'foo'` | throws (frozen) |
| T8 | `assertNoLegacyEnvVars()` with `BACKEND_SERVICE_URL` set | warning logged |
| T9 | `assertNoLegacyEnvVars()` with no legacy vars | silent |
| T10 | Importing module from a file with `'use client'` directive | build fails (server-only enforcement) |

T10 is verified by a separate build-time test (a fixture client component that tries to import the module — should fail `next build`).

### 7.1 Note on per-test env mutation

Because `backendConfig` is exported as a top-level `const` evaluated at module load, the standard Vitest/Jest pattern of `process.env.BACKEND_URL = '...'` followed by a fresh `import` will NOT see the new value unless the module cache is cleared. The test file MUST use `vi.resetModules()` (Vitest) before each scenario that changes env state and then `await import('../backend')` to get a fresh evaluation. The test setup file MUST set a sentinel `BACKEND_URL` value before any test runs so that the very first import (if any other test file picks up the module first) does not throw. This is documented inline in the test file so future maintainers understand why dynamic imports are used.

---

## 8. Why no environment-detection logic

The module deliberately does NOT contain logic like "if Vercel use BACKEND_URL else if Singapore-01 use 8088". Environment-specific values come from `.env` files or systemd `EnvironmentFile=`. The module is environment-agnostic and just trusts whatever `process.env.BACKEND_URL` contains.

This keeps the module portable and prevents the "we have 17 places to add a new env" trap from ever recurring.

---

## 9. Coordination Notes for Other Agents

- **For S04 (Next.js routes sweep):** Replace every `process.env.BACKEND_URL || 'http://localhost:8000'` with `backendConfig.baseUrl`. Replace every `process.env.BACKEND_SERVICE_URL || ...` and `process.env.PYTHON_BACKEND_URL || ...` similarly. Use `backendConfig.joinPath('/api/...')` for URL construction
- **For S06 (direct browser call migration):** New proxy routes for the 3 NEXT_PUBLIC files import this same module
- **For S07 (testing):** S07 owns installing Vitest, writing `vitest.config.ts`, and adding the `npm test` script. Once that lands, the `__tests__/backend.test.ts` file shipped by S02 becomes live with no further changes. S07 must also ensure its setup file (or a per-test fixture) sets `process.env.BACKEND_URL` BEFORE the module is imported, since the module reads at top-level evaluation time. The example `setup.ts` shipped here demonstrates the pattern
- **For S08 (deployment):** Update the Singapore-01 frontend env file (`.env.local` under the deployed Next.js directory, or whatever file `bash start.sh` / the systemd unit currently sources) to set `BACKEND_URL=http://localhost:8088`. Do NOT rely on `BACKEND_SERVICE_URL` or `PYTHON_BACKEND_URL` — they will be ignored after this PR merges. Removing them is optional but recommended to silence the warning emitted by `assertNoLegacyEnvVars()`. **Note:** Neither `env.template` (root) nor `backend-services/basic-service/env.template` previously contained any of the three backend URL var names — they were always set ad hoc in `.env.local`. This spec adds a documented `BACKEND_URL` line to the root `env.template` so future operators have a discoverable reference

---

## 10. Out of Scope

- Multi-backend routing (e.g., different services on different URLs) — this repo has exactly one backend
- Runtime URL refresh / hot reload — server restarts on env change, by design
- Per-request URL override — no use case
- HTTPS redirect / certificate pinning — handled by Nginx in front of the backend
- The frontend HTTP wrapper (S03) is a separate module and does NOT import this one (the wrapper runs in the browser; this module is server-only)
