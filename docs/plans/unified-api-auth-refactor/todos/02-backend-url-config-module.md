# TODO 02: Backend URL Config Module

> **Spec:** [specs/02-backend-url-config-module.md](../specs/02-backend-url-config-module.md)

## Dependencies

```yaml
depends_on: []
blocks: [04, 06]
parallel_group: A
```

- **No upstream dependencies** — can start immediately. Pure frontend infra work.
- **Blocks T04 (routes sweep)** — every Next.js route imports `backendConfig` from this module
- **Blocks T06 (direct call migration)** — new proxy routes also import this module
- **Parallel group A** — runs in Phase 1 alongside T01 and T03

## Tasks

- [ ] Read sibling spec `02-backend-url-config-module.md` end to end
- [ ] Add `server-only` to `package.json` dependencies: `npm install server-only`
- [ ] Create directory `src/lib/config/`
- [ ] Implement `src/lib/config/backend.ts` per spec §3 pseudocode
  - [ ] First line: `import 'server-only'`
  - [ ] Read `process.env.BACKEND_URL` at module top level (eager evaluation)
  - [ ] Throw with the production-mode message from spec §5 if missing in non-test
  - [ ] Throw with the test-mode message from spec §5 if missing in test
  - [ ] Validate via `new URL(...)`, throw the malformed message from spec §5 on failure
  - [ ] Normalize: strip trailing slash from `parsed.toString()`
  - [ ] Return `Object.freeze({ baseUrl, joinPath })`
  - [ ] Export named binding `backendConfig`
  - [ ] Export `assertNoLegacyEnvVars()` helper per spec §4
- [ ] Modify `next.config.js` (CommonJS) to inline the legacy-env-var check per spec §4.1 Option A variant (a). The list `['BACKEND_SERVICE_URL','PYTHON_BACKEND_URL']` MUST match `backend.ts` exactly
- [ ] Modify root `env.template`: add a documented `BACKEND_URL=http://localhost:8000` line and a comment block marking the legacy var names as deprecated/no-op
- [ ] Create `src/lib/config/__tests__/backend.test.ts` with cases T1-T9 from spec §7 using Vitest syntax (`import { describe, it, expect, beforeEach, vi } from 'vitest'`). T10 (server-only client-import build failure) is verified by a separate build-time fixture per spec §7 — add a TODO comment in the test file pointing at S07 for that build-time check
- [ ] Create `src/lib/config/__tests__/setup.ts` documenting the `vi.resetModules()` + dynamic-import pattern from spec §7.1, and set a sentinel `process.env.BACKEND_URL` value before any test runs (per spec §7.1)
- [ ] Verify the literal string `'http://localhost:8000'` does NOT appear anywhere inside `src/lib/config/backend.ts` (spec §2 AC8) — `grep -n "localhost:8000" src/lib/config/backend.ts` must return empty
- [ ] **Note:** Tests are written but cannot be RUN until T07 installs Vitest. This is intentional (per spec §6.1). Document the gap in the task completion report
- [ ] Manually verify the module by booting `npm run dev` with `BACKEND_URL` set vs unset — confirm fail-fast and no fallback
- [ ] Manually verify the legacy env var warning fires by setting `BACKEND_SERVICE_URL=http://x` in `.env.local` and starting `npm run dev`
- [ ] Run `npm run type-check` to verify no TS errors
- [ ] Sync `src/lib/config/`, `next.config.js`, `env.template`, `package.json`, `package-lock.json` to Singapore-01 staging area
- [ ] Write execution summary at `summaries/phase-1/dev--<agent-id>--todo-02.md`
- [ ] Mark TODO complete in the agent's completion report
