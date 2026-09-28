import { describe, expect, it, vi } from 'vitest';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import type { OperationApplier } from '../OperationApplier';
import type { SSEEvent } from '../types';

const result = {
  type: 'tool_result', toolCallId: 'call', toolName: 'create_video_cover',
  result: { success: true, status: 'queued' },
  operation: {
    type: 'cover_action', projectId: 'p', operationId: 'call',
    action: 'watch_job', jobId: 'j', draftVersion: 1,
    durationFrames: 30, applyWhenReady: true,
  },
} as SSEEvent;

function setup() {
  const stateManager = new AgentStateManager('message');
  const bridge = {
    beginOperation: vi.fn(),
    handleCoverOperation: vi.fn(),
    cancelOperations: vi.fn(),
  };
  const router = new AgentEventRouter({
    stateManager, operationApplier: {} as OperationApplier,
    coverAgentBridge: bridge,
  });
  return { router, bridge, stateManager };
}

describe('封面 SSE 操作', () => {
  it('开始事件立即记录基线，结果去重，watch 不阻塞 SSE', async () => {
    const { router, bridge } = setup();
    bridge.handleCoverOperation.mockReturnValue(new Promise(() => {}));
    await router.handleEvent({
      type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {},
    });
    expect(bridge.beginOperation).toHaveBeenCalledWith('call', 'create_video_cover', expect.any(Function));
    await router.handleEvent(result);
    await router.handleEvent(result);
    expect(bridge.handleCoverOperation).toHaveBeenCalledTimes(1);
  });

  it('只重放结果没有开始基线，不执行封面操作', async () => {
    const { router, bridge } = setup();
    await router.handleEvent(result);
    expect(bridge.handleCoverOperation).not.toHaveBeenCalled();
  });

  it('停止后迟到的开始及结果不能恢复自动应用', async () => {
    const { router, bridge } = setup();
    router.cancelCoverOperations(true);
    await router.handleEvent({
      type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {},
    });
    await router.handleEvent(result);
    expect(bridge.beginOperation).not.toHaveBeenCalled();
    expect(bridge.handleCoverOperation).not.toHaveBeenCalled();
    expect(bridge.cancelOperations).toHaveBeenCalledWith({ cancelJobs: true, operationIds: [] });
  });

  it('客户端失败写入可见错误而非已完成', async () => {
    const { router, bridge, stateManager } = setup();
    bridge.handleCoverOperation.mockImplementation((_operation, onStatus) => {
      onStatus({ state: 'error', error: 'COVER_TIMELINE_CONFLICT' });
    });
    await router.handleEvent({ type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {} });
    await router.handleEvent(result);
    expect(stateManager.getToolCalls()[0]).toMatchObject({ status: 'error',
      result: { success: false, coverStatus: {
        state: 'error', error: 'COVER_TIMELINE_CONFLICT',
      } } });
  });

  it('项目切换后异步成功回调不能显示已应用', async () => {
    const { router, bridge, stateManager } = setup();
    let status: (value: { state: string }) => void = () => {};
    bridge.handleCoverOperation.mockImplementation((_operation, onStatus) => {
      status = onStatus;
    });
    await router.handleEvent({ type: 'tool_call', toolCallId: 'call',
      toolName: 'create_video_cover', params: {} });
    await router.handleEvent(result);
    router.cancelCoverOperations(false);
    status({ state: 'applied' });
    expect(stateManager.getToolCalls()[0].result).not.toMatchObject({
      coverStatus: { state: 'applied' },
    });
  });
});
