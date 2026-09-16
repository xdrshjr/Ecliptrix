import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import type { SSEEvent } from '@/lib/video-editing-agent/types';
import { useAgentExecutionState } from '../useAgentExecutionState';

const stream = vi.hoisted(() => ({ config: null as SSEStreamManagerConfig | null }));
vi.mock('@/lib/video-editing-agent/SSEStreamManager', () => ({
  SSEStreamManager: class {
    isRunning = true;
    constructor(config: SSEStreamManagerConfig) { stream.config = config; }
    start() { return new Promise<void>(() => undefined); }
    cancel() { this.isRunning = false; }
  },
}));
afterEach(cleanup);

describe('思考终态与执行锁', () => {
  it.each([
    { type: 'thinking_end' }, { type: 'agent_end' },
    { type: 'cancelled', reason: 'client_aborted' },
    { type: 'error', message: '失败' },
  ] satisfies SSEEvent[])('$type 立即清除思考且不提前解锁', event => {
    const { result } = renderHook(() => useAgentExecutionState());
    act(() => result.current.startExecution({ body: {} }));
    act(() => stream.config!.onEvent({ type: 'thinking_start' }));
    expect(result.current.state.isThinking).toBe(true);
    act(() => stream.config!.onEvent(event));
    expect(result.current.state).toMatchObject({
      status: 'executing', isThinking: false,
    });
  });

  it('排空队列时停止思考，仍保持 finishing', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { result } = renderHook(() => useAgentExecutionState());
    act(() => result.current.startExecution({ body: {}, onComplete: () => pending }));
    act(() => stream.config!.onEvent({ type: 'thinking_start' }));
    await act(async () => stream.config!.onComplete());
    expect(result.current.state).toMatchObject({
      status: 'finishing', isThinking: false,
    });
    await act(async () => release());
    expect(result.current.state.status).toBe('completed');
  });
});
