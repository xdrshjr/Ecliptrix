/**
 * Vitest setup file for `src/lib/config/backend.ts` tests.
 *
 * This file is loaded by the Vitest runner BEFORE any test file is imported.
 * It establishes the mandatory invariants that the suite relies on.
 *
 * --------------------------------------------------------------------------
 *  Why this file is necessary
 * --------------------------------------------------------------------------
 * `backend.ts` reads `process.env.BACKEND_URL` at TOP-LEVEL (eager) module
 * evaluation. The value is captured into a frozen `const` and never re-read.
 *
 * This means the standard "set env, then import" pattern does not work — by
 * the time you assign `process.env.BACKEND_URL` inside a test, the module has
 * already been evaluated by some earlier import in the suite, the throw has
 * already happened, and the test crashes with the production-mode error.
 *
 * To work around the eager evaluation, every test that needs a different
 * `BACKEND_URL` value must follow this two-step dance:
 *
 *   import { beforeEach, describe, it, expect, vi } from 'vitest'
 *
 *   beforeEach(() => {
 *     vi.resetModules()              // 1. clear the module cache
 *     delete process.env.BACKEND_URL // 2. reset env to the desired state
 *   })
 *
 *   it('parses a valid URL', async () => {
 *     process.env.BACKEND_URL = 'http://localhost:8088'
 *     const { backendConfig } = await import('../backend')   // dynamic import
 *     expect(backendConfig.baseUrl).toBe('http://localhost:8088')
 *   })
 *
 * The `vi.resetModules()` call forces Vitest to re-evaluate `backend.ts` on
 * the next dynamic `import()`, picking up the freshly-set env vars.
 *
 * --------------------------------------------------------------------------
 *  Why we set a sentinel BACKEND_URL here
 * --------------------------------------------------------------------------
 * Other test files in the wider suite (introduced by S07 and beyond) may
 * happen to import something that transitively pulls in `backend.ts` BEFORE
 * the dedicated `backend.test.ts` runs. If `BACKEND_URL` is unset at that
 * moment, the module's eager throw will crash the entire test run.
 *
 * Setting a sentinel value here guarantees that any unrelated import of
 * `backend.ts` succeeds with a known-good baseline. Tests that specifically
 * exercise the "missing env" branches must use `delete process.env.BACKEND_URL`
 * inside their own `beforeEach` AFTER calling `vi.resetModules()`.
 */

// Sentinel — must be a syntactically valid URL so `new URL()` succeeds.
// Picked for readability; tests that care about the exact value override it
// after `vi.resetModules()`.
process.env.BACKEND_URL = 'http://localhost:8088'

// NOTE: Do NOT import `../backend` here. Doing so would freeze the sentinel
// into the module cache before any test had a chance to call
// `vi.resetModules()`, defeating the purpose of the dance documented above.
