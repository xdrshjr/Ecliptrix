import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SSEStreamManagerConfig } from '@/lib/video-editing-agent/SSEStreamManager';
import { useAgentExecutionState, FINISHING_WATCHDOG_MS } from '../useAgentExecutionState';

const stream = vi.hoisted(() => ({ config: null as SSEStreamManagerConfig | null }));
vi.mock('@/lib/video-editing-agent/SSEStreamManager', () => ({
  SSEStreamManager: class {
    isRunning = true;
    constructor(config: SSEStreamManagerConfig) { stream.config = config; }
    start() { return new Promise<void>(() => undefined); }
    cancel() { this.isRunning = false; }
  },
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('同步执行状态', () => {
  it('启动和取消的 getter 在 React render 前立即锁定', async () => {
    const { result } = renderHook(() => useAgentExecutionState());
    act(() => {
      result.current.startExecution({ body: {} });
      expect(result.current.getStatusNow()).toBe('executing');
      result.current.cancelExecution();
      expect(result.current.getStatusNow()).toBe('finishing');
    });
    await act(async () => {});
    expect(result.current.getStatusNow()).toBe('cancelled');
  });

  it('终态公开前调用交接标记，reset 同步回到 idle', async () => {
    const { result } = renderHook(() => useAgentExecutionState());
    const beforeTerminal = vi.fn(() => {
      expect(result.current.getStatusNow()).toBe('finishing');
    });
    act(() => result.current.startExecution({ body: {}, onBeforeTerminal: beforeTerminal }));
    await act(async () => stream.config!.onComplete());
    expect(beforeTerminal).toHaveBeenCalledOnce();
    expect(result.current.getStatusNow()).toBe('completed');
    act(() => {
      result.current.resetState();
      expect(result.current.getStatusNow()).toBe('idle');
    });
  });

  it('看门狗结束同样先交接再释放执行态', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAgentExecutionState());
    const beforeTerminal = vi.fn();
    act(() => result.current.startExecution({ body: {},
      onComplete: () => new Promise<void>(() => {}), onBeforeTerminal: beforeTerminal,
    }));
    await act(async () => stream.config!.onComplete());
    await act(async () => vi.advanceTimersByTimeAsync(FINISHING_WATCHDOG_MS));
    expect(beforeTerminal).toHaveBeenCalledOnce();
    expect(result.current.getStatusNow()).toBe('completed');
  });
});
