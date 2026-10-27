/**
 * The transient progress events (`context_usage`, `tool_progress`, `crew_*`)
 * go to their callbacks only: never to the state manager's tool calls and
 * never to operation dispatch. Without callbacks they are a no-op.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentEventRouter } from '../AgentEventRouter';
import { AgentStateManager } from '../AgentStateManager';
import type { OperationApplier } from '../OperationApplier';
import type { SSEEvent } from '../types';

const EVENTS: SSEEvent[] = [
  { type: 'context_usage', usedTokens: 100, windowTokens: 1000, maxOutputTokens: 50, dropped: false },
  { type: 'tool_progress', toolCallId: 'tc-1', done: 1, total: 3, itemIndex: 0, status: 'ready' },
  { type: 'crew_start', toolCallId: 'tc-2', crewId: 'c1', modelTier: 'fast', members: [{ id: 'a', goal: 'g' }] },
  { type: 'crew_member', crewId: 'c1', memberId: 'a', state: 'running', toolCalls: 1, modelCalls: 1, elapsedMs: 5 },
  { type: 'crew_end', crewId: 'c1', ready: 1, failed: 0, candidates: 2 },
];

function setup(withCallbacks: boolean) {
  const stateManager = new AgentStateManager('msg-1');
  const applier = {
    apply: vi.fn(), applyBatch: vi.fn(), applyRepack: vi.fn(), recordNonTimelineOperation: vi.fn(),
  } as unknown as OperationApplier;
  const callbacks = {
    onContextUsage: vi.fn(), onToolProgress: vi.fn(), onCrewEvent: vi.fn(),
  };
  const onOperationApplied = vi.fn();
  const router = new AgentEventRouter({
    stateManager, operationApplier: applier, onOperationApplied,
    ...(withCallbacks ? callbacks : {}),
  });
  return { router, stateManager, applier, callbacks, onOperationApplied };
}

describe('AgentEventRouter — progress events', () => {
  it('routes each event to its own callback', async () => {
    const { router, callbacks } = setup(true);

    for (const event of EVENTS) await router.handleEvent(event);

    expect(callbacks.onContextUsage).toHaveBeenCalledWith(EVENTS[0]);
    expect(callbacks.onToolProgress).toHaveBeenCalledWith(EVENTS[1]);
    expect(callbacks.onCrewEvent.mock.calls.map(([event]) => event.type))
      .toEqual(['crew_start', 'crew_member', 'crew_end']);
  });

  it('never reaches the tool list or operation dispatch', async () => {
    const { router, stateManager, applier, onOperationApplied } = setup(true);

    for (const event of EVENTS) await router.handleEvent(event);

    expect(stateManager.getSnapshot().toolCalls).toEqual([]);
    expect(applier.apply).not.toHaveBeenCalled();
    expect(applier.recordNonTimelineOperation).not.toHaveBeenCalled();
    expect(onOperationApplied).not.toHaveBeenCalled();
  });

  it('stays a no-op when the consumer registered no callbacks', async () => {
    const { router, stateManager } = setup(false);

    await expect(Promise.all(EVENTS.map(event => router.handleEvent(event)))).resolves.toBeDefined();

    expect(stateManager.getSnapshot().toolCalls).toEqual([]);
  });

  it('keeps ignoring an event type it does not know', async () => {
    const { router, callbacks } = setup(true);

    await router.handleEvent({ type: 'something_new' } as unknown as SSEEvent);

    expect(callbacks.onCrewEvent).not.toHaveBeenCalled();
  });
});
