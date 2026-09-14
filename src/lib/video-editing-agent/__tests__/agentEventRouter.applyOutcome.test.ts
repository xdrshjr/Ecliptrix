/**
 * AG2-02: a tool that succeeded on the server but whose operation the client
 * could not apply shows as an error, with the reason as data for the UI.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import type { ApplyOutcome, OperationApplier } from '../OperationApplier';
import type { SSEEvent } from '../types';

const REJECTED: ApplyOutcome = { status: 'rejected', reason: 'clip-not-found', trackId: 'v1', clipId: 'gone' };

function setup(outcome: ApplyOutcome) {
  const stateManager = new AgentStateManager('msg-1');
  stateManager.addToolCall({ id: 'tc-1', name: 'delete_clip', params: {}, status: 'executing' });
  const applier = {
    apply: vi.fn().mockResolvedValue(outcome),
    applyBatch: vi.fn().mockResolvedValue(outcome),
    applyRepack: vi.fn().mockReturnValue(outcome),
    recordNonTimelineOperation: vi.fn(),
  } as unknown as OperationApplier;
  const onOperationApplied = vi.fn();
  const router = new AgentEventRouter({ stateManager, operationApplier: applier, onOperationApplied });
  return { stateManager, router, onOperationApplied };
}

const DELETE_RESULT: SSEEvent = {
  type: 'tool_result',
  toolCallId: 'tc-1',
  toolName: 'delete_clip',
  result: { success: true, clipId: 'gone' },
  operation: { type: 'delete_clip', clipId: 'gone', trackId: 'v1' },
};

describe('AgentEventRouter — client apply outcome', () => {
  it('the tool card turns error when the client could not apply', async () => {
    const { stateManager, router, onOperationApplied } = setup(REJECTED);

    await router.handleEvent(DELETE_RESULT);

    expect({
      toolCall: stateManager.getSnapshot().toolCalls[0],
      recorded: onOperationApplied.mock.calls.length,
    }).toEqual({
      toolCall: expect.objectContaining({
        status: 'error',
        result: {
          success: false,
          clipId: 'gone',
          clientApplyError: { reason: 'clip-not-found', trackId: 'v1', clipId: 'gone' },
        },
      }),
      recorded: 0,
    });
  });

  it('a rejected batch also turns the tool card into an error', async () => {
    const { stateManager, router } = setup(REJECTED);

    await router.handleEvent({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'compose_storyboard',
      result: { success: true, operations: [{ type: 'delete_clip', clipId: 'gone', trackId: 'v1' }] },
      operation: null,
    });

    expect(stateManager.getSnapshot().toolCalls[0].status).toBe('error');
  });

  it('an applied operation marks its tool call as changing the timeline; a noop does not', async () => {
    const applied = setup({ status: 'applied' });
    const noop = setup({ status: 'noop', reason: 'no-change' });

    await applied.router.handleEvent(DELETE_RESULT);
    await noop.router.handleEvent({
      type: 'tool_result',
      toolCallId: 'tc-1',
      toolName: 'auto_fix_overlaps',
      result: { success: true, operations: [{ type: 'move_clip', clipId: 'a', fromTrackId: 'v1', toTrackId: 'v1', newStartTime: 0 }] },
      operation: null,
    });

    expect({
      applied: applied.stateManager.toMessageUpdate().agentToolCalls?.[0].changedTimeline,
      noop: noop.stateManager.toMessageUpdate().agentToolCalls?.[0].changedTimeline,
    }).toEqual({ applied: true, noop: undefined });
  });

  it('an applied operation keeps the tool card completed', async () => {
    const { stateManager, router, onOperationApplied } = setup({ status: 'applied' });

    await router.handleEvent(DELETE_RESULT);

    expect({ status: stateManager.getSnapshot().toolCalls[0].status, recorded: onOperationApplied.mock.calls.length })
      .toEqual({ status: 'completed', recorded: 1 });
  });
});
