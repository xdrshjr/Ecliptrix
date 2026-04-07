/**
 * Vitest global test setup file.
 *
 * This module runs ONCE per test worker, BEFORE any test file imports any
 * source module. It exists for three reasons:
 *
 *   1. `src/lib/config/backend.ts` reads `process.env.BACKEND_URL` at top-level
 *      module evaluation and throws if it's missing — even under
 *      `NODE_ENV=test`. We pre-set a sentinel `BACKEND_URL` here so dormant
 *      tests that transitively import `backend.ts` don't crash on import.
 *      Per-test suites that want to exercise different env states use
 *      `vi.resetModules()` + dynamic import (see `backend.test.ts`).
 *
 *   2. The browser `localStorage` API is not available in Node — and the
 *      Vitest jsdom environment provides one, but the http-client tests
 *      replace it with their own in-memory mock per-test. We provide a
 *      stable global so tests that DON'T explicitly mock localStorage still
 *      see a working object.
 *
 *   3. `@testing-library/jest-dom` extends Vitest's expect with DOM matchers
 *      (`toBeInTheDocument`, etc.) — useful for any future React component
 *      tests; the import is harmless even for purely-functional tests.
 *
 * Spec: docs/plans/unified-api-auth-refactor/specs/07-testing-suite.md §2.1 #3
 */

// ---------------------------------------------------------------------------
// 1. Set BACKEND_URL BEFORE any imports. This MUST be the first statement —
//    importing `@testing-library/jest-dom` is harmless, but importing anything
//    that touches `@/lib/config/backend` would crash if BACKEND_URL is unset.
//
//    Value chosen ('http://test-backend:8088') matches the literal that
//    `src/lib/api/server/__tests__/backend-proxy.test.ts` asserts on, so the
//    dormant T04 tests pass without per-file env override gymnastics. The
//    `backend.test.ts` suite uses `vi.resetModules()` + dynamic import to
//    exercise alternate values, so it is unaffected by this default.
// ---------------------------------------------------------------------------
if (!process.env.BACKEND_URL) {
  process.env.BACKEND_URL = 'http://test-backend:8088'
}

// ---------------------------------------------------------------------------
// 2. DOM matchers extension. Pulls in `expect.extend(matchers)` automatically.
// ---------------------------------------------------------------------------
import '@testing-library/jest-dom/vitest'

import { afterEach, beforeEach, vi } from 'vitest'

// ---------------------------------------------------------------------------
// 3. Stable in-memory localStorage shim. The jsdom env already provides a
//    Storage implementation; we replace it here with a deterministic
//    in-memory store so tests can rely on `localStorage.getItem(...)` returning
//    exactly what was set without relying on jsdom's quirks.
// ---------------------------------------------------------------------------
function makeInMemoryStorage(): Storage {
  const store: Record<string, string> = {}
  return {
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
    },
    setItem(key: string, value: string): void {
      store[key] = String(value)
    },
    removeItem(key: string): void {
      delete store[key]
    },
    clear(): void {
      for (const k of Object.keys(store)) delete store[k]
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null
    },
    get length(): number {
      return Object.keys(store).length
    },
  } as Storage
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: makeInMemoryStorage(),
  })
}

// ---------------------------------------------------------------------------
// 4. Reset state between tests so suites can't leak into one another.
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks()
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear()
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})
