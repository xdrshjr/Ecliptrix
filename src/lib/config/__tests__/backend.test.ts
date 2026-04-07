/**
 * Unit tests for `src/lib/config/backend.ts`.
 *
 * Status: WRITTEN, NOT YET RUNNABLE.
 *
 * The repository does not currently have Vitest installed (S07 owns that
 * setup). These tests are written using valid Vitest syntax and will become
 * live the moment S07 lands `vitest`, `vitest.config.ts`, and the `npm test`
 * script. No edits will be needed at that point — wire up the runner, run
 * `npm test`, and the suite executes.
 *
 * Test coverage matches the matrix in spec §7 (T1-T9). T10 (build-time
 * server-only enforcement against client component imports) is a build-time
 * fixture that cannot be expressed as a unit test — it requires a separate
 * fixture client component plus a `next build` invocation. See:
 *
 *   TODO(S07): add a build-time fixture under `tests/build-fixtures/` that
 *   creates a `'use client'` component importing `@/lib/config/backend` and
 *   asserts that `next build` exits non-zero with the server-only error.
 *
 * --------------------------------------------------------------------------
 *  Required pattern: vi.resetModules() + dynamic import
 * --------------------------------------------------------------------------
 * `backend.ts` reads `process.env.BACKEND_URL` at top-level module evaluation,
 * so a static `import { backendConfig } from '../backend'` would only ever
 * see the FIRST environment value the test runner happened to encounter.
 *
 * To exercise different env states per test, every test follows this dance:
 *
 *   beforeEach(() => {
 *     vi.resetModules()                  // forget cached evaluation
 *     delete process.env.BACKEND_URL     // reset env
 *   })
 *
 *   it('...', async () => {
 *     process.env.BACKEND_URL = '...'    // set env BEFORE import
 *     const mod = await import('../backend')  // dynamic import → fresh eval
 *     // ...assertions on `mod.backendConfig`
 *   })
 *
 * See `setup.ts` for additional context on why this dance exists and why we
 * pre-set a sentinel `BACKEND_URL` for the broader suite.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// `@types/node` declares `process.env.NODE_ENV` as a readonly literal union,
// which means a direct `process.env.NODE_ENV = 'production'` assignment fails
// type-checking. The runtime is perfectly happy to mutate it — `process.env`
// is a normal mutable object — so we use a small typed helper to localize the
// assertion in one place. The alternative (sprinkling `as any` everywhere)
// would be noisier and harder to grep for.
const env = process.env as Record<string, string | undefined>

// Snapshot the env keys this suite mutates so we can restore them between
// tests. Restoring `NODE_ENV` is essential because Vitest sets it to 'test'
// by default and other suites may rely on that.
const ORIGINAL_BACKEND_URL = env.BACKEND_URL
const ORIGINAL_NODE_ENV = env.NODE_ENV
const ORIGINAL_BACKEND_SERVICE_URL = env.BACKEND_SERVICE_URL
const ORIGINAL_PYTHON_BACKEND_URL = env.PYTHON_BACKEND_URL

beforeEach(() => {
  // Force a fresh evaluation of backend.ts on the next dynamic import.
  vi.resetModules()
  // Start each test from a clean env state — individual tests opt in to the
  // env they need.
  delete env.BACKEND_URL
  delete env.BACKEND_SERVICE_URL
  delete env.PYTHON_BACKEND_URL
})

afterEach(() => {
  // Restore the snapshot so we don't leak state into sibling test files.
  if (ORIGINAL_BACKEND_URL === undefined) {
    delete env.BACKEND_URL
  } else {
    env.BACKEND_URL = ORIGINAL_BACKEND_URL
  }
  if (ORIGINAL_NODE_ENV === undefined) {
    delete env.NODE_ENV
  } else {
    env.NODE_ENV = ORIGINAL_NODE_ENV
  }
  if (ORIGINAL_BACKEND_SERVICE_URL === undefined) {
    delete env.BACKEND_SERVICE_URL
  } else {
    env.BACKEND_SERVICE_URL = ORIGINAL_BACKEND_SERVICE_URL
  }
  if (ORIGINAL_PYTHON_BACKEND_URL === undefined) {
    delete env.PYTHON_BACKEND_URL
  } else {
    env.PYTHON_BACKEND_URL = ORIGINAL_PYTHON_BACKEND_URL
  }
  vi.restoreAllMocks()
})

describe('backendConfig (module evaluation)', () => {
  // -------------------- T1 --------------------
  it('T1: parses a valid BACKEND_URL into baseUrl', async () => {
    env.BACKEND_URL = 'http://localhost:8088'
    const { backendConfig } = await import('../backend')
    expect(backendConfig.baseUrl).toBe('http://localhost:8088')
  })

  // -------------------- T2 --------------------
  it('T2: throws "BACKEND_URL is required" when unset and NODE_ENV !== test', async () => {
    // Override NODE_ENV away from 'test' so we hit the production-mode branch.
    env.NODE_ENV = 'production'
    delete env.BACKEND_URL

    await expect(import('../backend')).rejects.toThrow(/BACKEND_URL is required/)
  })

  it('T2 (message contract): error names .env.local in production mode', async () => {
    env.NODE_ENV = 'production'
    delete env.BACKEND_URL

    await expect(import('../backend')).rejects.toThrow(
      /Set it in \.env\.local or your environment file/
    )
  })

  // -------------------- T2.b — distinct test-mode error --------------------
  it('T2.b: throws the test-specific error when unset and NODE_ENV === test', async () => {
    env.NODE_ENV = 'test'
    delete env.BACKEND_URL

    await expect(import('../backend')).rejects.toThrow(
      /BACKEND_URL not set in test environment/
    )
  })

  it('T2.b (message contract): test-mode error references the test setup file', async () => {
    env.NODE_ENV = 'test'
    delete env.BACKEND_URL

    await expect(import('../backend')).rejects.toThrow(
      /Inject it via your test setup file before importing this module/
    )
  })

  // -------------------- T3 --------------------
  it('T3: throws when BACKEND_URL is malformed', async () => {
    env.BACKEND_URL = 'not-a-url'

    await expect(import('../backend')).rejects.toThrow(
      /BACKEND_URL is malformed: "not-a-url"/
    )
  })

  it('T3 (message contract): malformed error suggests an example URL', async () => {
    env.BACKEND_URL = 'not-a-url'

    await expect(import('../backend')).rejects.toThrow(
      /Expected a valid URL like http:\/\/localhost:8088 or https:\/\/api\.example\.com/
    )
  })

  // -------------------- T4 --------------------
  it('T4: strips a trailing slash from baseUrl', async () => {
    env.BACKEND_URL = 'http://x:8088/'
    const { backendConfig } = await import('../backend')
    expect(backendConfig.baseUrl).toBe('http://x:8088')
    expect(backendConfig.baseUrl.endsWith('/')).toBe(false)
  })

  // -------------------- T5 --------------------
  it('T5: joinPath joins a leading-slash path correctly', async () => {
    env.BACKEND_URL = 'http://x:8088'
    const { backendConfig } = await import('../backend')
    expect(backendConfig.joinPath('/api/video/search')).toBe(
      'http://x:8088/api/video/search'
    )
  })

  // -------------------- T6 --------------------
  it('T6: joinPath also handles paths without a leading slash', async () => {
    env.BACKEND_URL = 'http://x:8088'
    const { backendConfig } = await import('../backend')
    expect(backendConfig.joinPath('api/video/search')).toBe(
      'http://x:8088/api/video/search'
    )
  })

  it('T6 (idempotency): joinPath produces the same result for both forms', async () => {
    env.BACKEND_URL = 'http://x:8088'
    const { backendConfig } = await import('../backend')
    expect(backendConfig.joinPath('/api/health')).toBe(
      backendConfig.joinPath('api/health')
    )
  })

  // -------------------- T7 --------------------
  it('T7: backendConfig is frozen — mutation throws in strict mode', async () => {
    env.BACKEND_URL = 'http://x:8088'
    const { backendConfig } = await import('../backend')

    expect(Object.isFrozen(backendConfig)).toBe(true)
    expect(() => {
      // @ts-expect-error — intentional mutation attempt against the readonly type
      backendConfig.baseUrl = 'http://evil.example.com'
    }).toThrow(TypeError)
  })
})

describe('assertNoLegacyEnvVars', () => {
  // -------------------- T8 --------------------
  it('T8: warns when BACKEND_SERVICE_URL is set', async () => {
    env.BACKEND_URL = 'http://x:8088'
    env.BACKEND_SERVICE_URL = 'http://stale:8000'

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { assertNoLegacyEnvVars } = await import('../backend')

    assertNoLegacyEnvVars()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('[backend-config]')
    expect(message).toContain('BACKEND_SERVICE_URL')
    expect(message).toContain('IGNORED')
  })

  it('T8 (PYTHON_BACKEND_URL variant): warns and names the offender', async () => {
    env.BACKEND_URL = 'http://x:8088'
    env.PYTHON_BACKEND_URL = 'http://stale:8000'

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { assertNoLegacyEnvVars } = await import('../backend')

    assertNoLegacyEnvVars()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0]?.[0]).toContain('PYTHON_BACKEND_URL')
  })

  it('T8 (both variants): warns once with both names listed', async () => {
    env.BACKEND_URL = 'http://x:8088'
    env.BACKEND_SERVICE_URL = 'http://stale:8000'
    env.PYTHON_BACKEND_URL = 'http://stale:8000'

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { assertNoLegacyEnvVars } = await import('../backend')

    assertNoLegacyEnvVars()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    const message = warnSpy.mock.calls[0]?.[0] as string
    expect(message).toContain('BACKEND_SERVICE_URL')
    expect(message).toContain('PYTHON_BACKEND_URL')
  })

  // -------------------- T9 --------------------
  it('T9: stays silent when no legacy env vars are set', async () => {
    env.BACKEND_URL = 'http://x:8088'
    delete env.BACKEND_SERVICE_URL
    delete env.PYTHON_BACKEND_URL

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { assertNoLegacyEnvVars } = await import('../backend')

    assertNoLegacyEnvVars()

    expect(warnSpy).not.toHaveBeenCalled()
  })
})
