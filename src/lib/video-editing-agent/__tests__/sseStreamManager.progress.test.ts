/**
 * Throttled progress readings are delivered like any event, but they must not
 * replace the run's "last event" — the error context of a failed stream.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SSEStreamManager } from '../SSEStreamManager';
import type { StreamError } from '../errorRecovery';
import type { SSEEvent } from '../types';

const encoder = new TextEncoder();

function dropAfter(chunk: string): Response {
  let sent = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!sent) { sent = true; controller.enqueue(encoder.encode(chunk)); }
      else controller.error(new TypeError('network error'));
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const frame = (id: number, event: object) => `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;

afterEach(() => { vi.unstubAllGlobals(); });

describe('SSEStreamManager — progress events', () => {
  it('delivers them, but the last event stays the last meaningful one', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(dropAfter(
      frame(0, { type: 'tool_call', toolCallId: 'tc-1', toolName: 'delegate_research', params: {} })
      + frame(1, { type: 'crew_member', crewId: 'c', memberId: 'a', state: 'running', toolCalls: 1, modelCalls: 1, elapsedMs: 9 })
      + frame(2, { type: 'tool_progress', toolCallId: 'tc-1', done: 1, total: 2, itemIndex: 0, status: 'ready' })
      + frame(3, { type: 'context_usage', usedTokens: 1, windowTokens: 2, maxOutputTokens: 1, dropped: false }),
    )));
    const events: SSEEvent[] = [];
    const errors: StreamError[] = [];
    const manager = new SSEStreamManager({
      url: '/api/video-editing-agent/chat', body: {},
      onEvent: event => events.push(event),
      onError: error => errors.push(error),
      onComplete: () => undefined,
    });

    await manager.start();

    expect(events.map(event => event.type)).toEqual(
      ['tool_call', 'crew_member', 'tool_progress', 'context_usage']);
    expect(errors[0]?.context?.lastEvent?.type).toBe('tool_call');
    expect(errors[0]?.context?.pendingToolCallIds).toEqual(['tc-1']);
  });
});
