import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STEER_TTL_MS, SteerError, getRun, registerRun, resetRunRegistryForTests,
  unregisterRun, validateSteerInput, type AgentRunHandle,
} from '../agentRunRegistry';

function fakeHandle(runId: string): AgentRunHandle {
  return { runId, steer: vi.fn(), pendingCount: () => 0, close: vi.fn() };
}

describe('agentRunRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRunRegistryForTests();
  });
  afterEach(() => vi.useRealTimers());

  it('finds a registered run and returns undefined for an unknown one', () => {
    registerRun(fakeHandle('run-1'));
    expect(getRun('run-1')?.runId).toBe('run-1');
    expect(getRun('run-2')).toBeUndefined();
  });

  it('keeps a closed run for the TTL so late requests see run_closed, then drops it', () => {
    registerRun(fakeHandle('run-1'));
    unregisterRun('run-1');
    vi.advanceTimersByTime(STEER_TTL_MS - 1);
    expect(getRun('run-1')).toBeDefined();
    vi.advanceTimersByTime(2);
    expect(getRun('run-1')).toBeUndefined();
  });

  it('shares one table across module instances through globalThis', () => {
    registerRun(fakeHandle('run-1'));
    const holder = globalThis as unknown as Record<symbol, Map<string, unknown>>;
    expect(holder[Symbol.for('ecliptrix.agentRuns')].has('run-1')).toBe(true);
  });
});

describe('validateSteerInput', () => {
  it('trims and returns the text', () => {
    expect(validateSteerInput({ steerId: 'abcdefgh', text: '  hi  ' })).toBe('hi');
  });

  it.each([
    ['empty text', { steerId: 'abcdefgh', text: '   ' }],
    ['too long (code points)', { steerId: 'abcdefgh', text: '😀'.repeat(2001) }],
    ['steerId too short', { steerId: 'abc', text: 'x' }],
    ['steerId with illegal chars', { steerId: 'abc defgh!', text: 'x' }],
  ])('rejects %s as invalid_steer', (_label, input) => {
    expect(() => validateSteerInput(input))
      .toThrowError(expect.objectContaining({ code: 'invalid_steer' }));
    expect(() => validateSteerInput(input)).toThrow(SteerError);
  });

  it('counts an emoji as one character at the 2000 limit', () => {
    expect(() => validateSteerInput({ steerId: 'abcdefgh', text: '😀'.repeat(2000) }))
      .not.toThrow();
  });
});
