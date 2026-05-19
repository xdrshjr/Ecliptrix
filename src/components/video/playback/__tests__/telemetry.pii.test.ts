/**
 * Tests for PII hashing in PlaybackTelemetry (Phase 4 §3.2.5 / INV11 / F17).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybackTelemetry } from '../telemetry';
import { hashUserIdForTelemetry, sha256Hex } from '../internal/sha256';

describe('PlaybackTelemetry PII hashing (INV11)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeTelemetry(userId?: string) {
    return new PlaybackTelemetry({
      sessionId: 'session-1',
      taskId: 'task-1',
      flagVariant: 'v2',
      userId,
      fetchImpl: fetchMock as unknown as typeof fetch,
      flushIntervalMs: 5000,
    });
  }

  it('omits raw user ids from the internal opts', () => {
    const t = makeTelemetry('alice@example.com');
    const stored = t._peekHashedUserId();
    expect(stored).toBeDefined();
    expect(stored).not.toContain('alice');
    expect(stored).toMatch(/^[0-9a-f]{12}$/);
    t.dispose();
  });

  it('payload sent to backend contains the hashed userId', async () => {
    const t = makeTelemetry('alice@example.com');
    t.count('playback.playhead_regression');
    await t.flushNow();
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.userId).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(body)).not.toContain('alice');
    t.dispose();
  });

  it('matches the expected sha256(userId + "playback_v2") prefix', () => {
    const raw = 'user-42';
    const expected = sha256Hex(raw + 'playback_v2').slice(0, 12);
    expect(hashUserIdForTelemetry(raw)).toBe(expected);
  });

  it('returns null hash for empty / undefined userId', () => {
    expect(hashUserIdForTelemetry('')).toBeNull();
    expect(hashUserIdForTelemetry(null)).toBeNull();
    expect(hashUserIdForTelemetry(undefined)).toBeNull();
  });
});
