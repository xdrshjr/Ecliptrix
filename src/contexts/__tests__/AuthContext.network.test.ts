/**
 * @vitest-environment node
 *
 * iter9 Bug #9 — AuthContext network-error throttling.
 *
 * Verifies (source-level) that:
 *   - ApiError + TimeoutError are imported from http-client
 *   - module-level throttle constants exist
 *   - validateSession catch discriminates network errors and uses console.warn
 *     once per throttle window, falling back to console.error for unknowns
 *   - loadAuthState catch is left untouched (out-of-scope)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(
  resolve(__dirname, '..', 'AuthContext.tsx'),
  'utf-8',
);

describe('AuthContext — Bug #9 network error throttling', () => {
  it('imports ApiError + TimeoutError from http-client', () => {
    expect(SRC).toMatch(/import \{[\s\S]*?ApiError,[\s\S]*?TimeoutError,[\s\S]*?\} from '@\/lib\/api\/http-client'/);
  });

  it('declares module-level throttle state (not useRef)', () => {
    expect(SRC).toMatch(/let lastNetworkWarnAt = 0;/);
    expect(SRC).toMatch(/const NETWORK_WARN_THROTTLE_MS = 30_000;/);
  });

  it('exposes isNetworkUnreachable type-guard combining ApiError code + TimeoutError', () => {
    expect(SRC).toMatch(/function isNetworkUnreachable\(err: unknown\): boolean/);
    expect(SRC).toMatch(/err instanceof ApiError && err\.code === 'NETWORK_ERROR'/);
    expect(SRC).toMatch(/err instanceof TimeoutError/);
  });

  it('validateSession catch warns once per throttle window for network errors', () => {
    expect(SRC).toMatch(/if \(isNetworkUnreachable\(error\)\)/);
    expect(SRC).toMatch(/if \(now - lastNetworkWarnAt > NETWORK_WARN_THROTTLE_MS\)/);
    expect(SRC).toMatch(/console\.warn\('\[AuthContext\] Session validation skipped:/);
  });

  it('falls back to console.error for non-network errors', () => {
    expect(SRC).toMatch(/console\.error\('\[AuthContext\] Session validation error:/);
  });

  it('leaves loadAuthState catch console.error intact (out-of-scope)', () => {
    expect(SRC).toMatch(/console\.error\('\[AuthContext\] Error loading auth state:/);
  });
});
