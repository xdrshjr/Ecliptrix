/**
 * Unit tests for PlaybackTelemetry (spec 08 §九).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlaybackTelemetry } from '../telemetry';

describe('PlaybackTelemetry', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTelemetry(overrides: Record<string, unknown> = {}) {
    return new PlaybackTelemetry({
      sessionId: 'session-1',
      taskId: 'task-1',
      flagVariant: 'v2',
      fetchImpl: fetchMock as unknown as typeof fetch,
      flushIntervalMs: 5000,
      ...overrides,
    });
  }

  it('queues record and count events with timestamps', () => {
    const t = makeTelemetry();
    t.record('playback.click_to_first_frame_ms', 87);
    t.count('playback.playhead_regression');
    const queue = t._peekQueue();
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ name: 'playback.click_to_first_frame_ms', value: 87 });
    expect(queue[1]).toMatchObject({ name: 'playback.playhead_regression', value: 1 });
    expect(queue[0].ts).toBeGreaterThan(0);
    t.dispose();
  });

  it('flushes after the interval elapses', async () => {
    const t = makeTelemetry();
    t.count('foo');
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sessionId).toBe('session-1');
    expect(body.events).toHaveLength(1);
    t.dispose();
  });

  it('flushNow drains the queue immediately', async () => {
    const t = makeTelemetry();
    t.count('foo');
    await t.flushNow();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(t._peekQueue()).toHaveLength(0);
    t.dispose();
  });

  it('dispose triggers a final flush and stops the timer', async () => {
    const t = makeTelemetry();
    t.count('foo');
    t.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    // One flush from dispose; the timer should be cleared so no second hit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('beforeunload forces a flush', async () => {
    const t = makeTelemetry();
    t.count('foo');
    window.dispatchEvent(new Event('beforeunload'));
    await vi.runOnlyPendingTimersAsync();
    // beforeunload triggers `void flushNow()` — wait a microtask for it.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalled();
    t.dispose();
  });

  it('swallows fetch errors silently', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const t = makeTelemetry();
    t.count('foo');
    await expect(t.flushNow()).resolves.toBeUndefined();
    t.dispose();
  });
});
