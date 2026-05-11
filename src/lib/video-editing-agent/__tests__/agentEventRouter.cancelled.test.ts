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

  it('does NOT append the marker for server_timeout reason', async () => {
    const stateManager = new AgentStateManager('msg-2');
    stateManager.appendText('working on it');

    const router = new AgentEventRouter({
      stateManager,
      operationApplier: makeApplier(),
    });

    await router.handleEvent({ type: 'cancelled', reason: 'server_timeout', timestamp: 0 });

    const update = stateManager.toMessageUpdate();
    expect(update.content).toBe('working on it');
    expect(update.isCancelled).toBe(true);
  });
});
