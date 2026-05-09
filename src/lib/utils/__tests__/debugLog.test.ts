/**
 * Bug #4 (web-bug-report-20260509-iter2): dlog must be silent in production
 * unless the user opts in at runtime via window.__ECLIPTRIX_DEBUG__.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// `process.env.NODE_ENV` is read at module load time for the `isProd` const.
// Each test re-imports the module via vi.resetModules() so the env value
// observed is the one we set immediately above the import.
async function importDebugLog() {
  const mod = await import('../debugLog');
  return mod;
}

describe('debugLog.dlog', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete (window as unknown as { __ECLIPTRIX_DEBUG__?: boolean }).__ECLIPTRIX_DEBUG__;
    vi.resetModules();
  });

  afterEach(() => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = originalNodeEnv;
    logSpy.mockRestore();
    delete (window as unknown as { __ECLIPTRIX_DEBUG__?: boolean }).__ECLIPTRIX_DEBUG__;
  });

  it('logs in development', async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'development';
    const { dlog } = await importDebugLog();
    dlog('hello', { x: 1 });
    expect(logSpy).toHaveBeenCalledWith('hello', { x: 1 });
  });

  it('is silent in production by default', async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    const { dlog } = await importDebugLog();
    dlog('should-not-appear');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs in production when window.__ECLIPTRIX_DEBUG__ is true', async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    (window as unknown as { __ECLIPTRIX_DEBUG__?: boolean }).__ECLIPTRIX_DEBUG__ = true;
    const { dlog } = await importDebugLog();
    dlog('field-debug');
    expect(logSpy).toHaveBeenCalledWith('field-debug');
  });

  it('stays silent in production when override is false', async () => {
    (process.env as { NODE_ENV?: string }).NODE_ENV = 'production';
    (window as unknown as { __ECLIPTRIX_DEBUG__?: boolean }).__ECLIPTRIX_DEBUG__ = false;
    const { dlog } = await importDebugLog();
    dlog('still-silent');
    expect(logSpy).not.toHaveBeenCalled();
  });
});
