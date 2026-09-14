import { describe, it, expect, vi } from 'vitest';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import type { OperationApplier } from '../OperationApplier';

function makeApplier(): OperationApplier {
  // Minimal applier stub — handle* paths are not exercised here, so we only
  // need the methods AgentEventRouter actually calls.
  return {
    apply: vi.fn(),
    recordNonTimelineOperation: vi.fn(),
    undoOperation: vi.fn(),
  } as unknown as OperationApplier;
}

describe('AgentEventRouter — cancelled SSE event', () => {
  it('routes "cancelled" with client_aborted reason to markCancelled (with marker)', async () => {
    const stateManager = new AgentStateManager('msg-1');
    stateManager.appendText('working on it');
    stateManager.addToolCall({ id: 'tc-1', name: 'add_to_track', params: {}, status: 'executing' });

    const router = new AgentEventRouter({
      stateManager,
      operationApplier: makeApplier(),
    });

    await router.handleEvent({ type: 'cancelled', reason: 'client_aborted', timestamp: 0 });

    const update = stateManager.toMessageUpdate();
    expect(update.isCancelled).toBe(true);
    expect(update.isStreaming).toBe(false);
    expect(update.content).toContain('_[Stopped by user]_');
    expect(update.agentToolCalls?.[0].status).toBe('cancelled');
  });

  it('a server timeout is not recorded as stopped by the user', async () => {
    const stateManager = new AgentStateManager('msg-2');
    stateManager.appendText('working on it');
    stateManager.addToolCall({ id: 'tc-1', name: 'add_to_track', params: {}, status: 'executing' });

    const router = new AgentEventRouter({
      stateManager,
      operationApplier: makeApplier(),
    });

    await router.handleEvent({ type: 'cancelled', reason: 'server_timeout', timestamp: 0 });

    const update = stateManager.toMessageUpdate();
    expect({
      content: update.content,
      isCancelled: update.isCancelled,
      isStreaming: update.isStreaming,
      toolStatus: update.agentToolCalls?.[0].status,
    }).toEqual({
      content: 'working on it',
      isCancelled: undefined,
      isStreaming: false,
      toolStatus: 'cancelled',
    });
  });

  it('a server error event is shown through the localiser with its code', async () => {
    const stateManager = new AgentStateManager('msg-3');
    const onError = vi.fn();
    const router = new AgentEventRouter({
      stateManager,
      operationApplier: makeApplier(),
      onError,
      describeError: (error) => `localised:${error.code ?? 'none'}`,
    });

    await router.handleEvent({ type: 'error', message: '401 invalid_api_key', code: 'provider_auth' });

    expect({
      notified: onError.mock.calls,
      error: stateManager.getSnapshot().errorMessage,
    }).toEqual({
      notified: [['localised:provider_auth']],
      error: 'localised:provider_auth',
    });
  });
});
