import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushAllPending, registerPendingFlush } from '../autosaveRegistry';

const cleanups: Array<() => void> = [];

function register(key: string, flush: () => Promise<void>): void {
  cleanups.push(registerPendingFlush(key, flush));
}

afterEach(() => {
  cleanups.splice(0).forEach((unregister) => unregister());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('autosaveRegistry', () => {
  it('flushAllPending runs every registered flush', async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    register('project:a', first);
    register('project:b', second);

    const result = await flushAllPending(1000);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, failedKeys: [], timedOut: false });
  });

  it('reports failed keys', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    register('project:ok', async () => {});
    register('project:bad', async () => { throw new Error('503'); });

    const result = await flushAllPending(1000);

    expect(result).toEqual({ ok: false, failedKeys: ['project:bad'], timedOut: false });
  });

  it('reports a timeout', async () => {
    vi.useFakeTimers();
    register('project:slow', () => new Promise<void>(() => {}));

    const pending = flushAllPending(2500);
    await vi.advanceTimersByTimeAsync(2500);

    expect(await pending).toEqual({ ok: false, failedKeys: [], timedOut: true });
  });

  it('unregister removes the flush', async () => {
    const flush = vi.fn(async () => {});
    const unregister = registerPendingFlush('project:gone', flush);
    unregister();

    const result = await flushAllPending(1000);

    expect(flush).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it('an old unregister does not remove a newer flush under the same key', async () => {
    const stale = registerPendingFlush('project:same', async () => {});
    const fresh = vi.fn(async () => {});
    register('project:same', fresh);
    stale();

    await flushAllPending(1000);

    expect(fresh).toHaveBeenCalledTimes(1);
  });
});
