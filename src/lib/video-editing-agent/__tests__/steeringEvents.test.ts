/**
 * The four SSE events added for steering and skills (spec §5.3 / §12 item 2)
 * reach the consumer through the unchanged parser, an unknown future event is
 * still ignored-and-continued, and a reconnect (new run, new runId) is reported
 * through `onRestart` so the steering state machine can re-send its notes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSEStreamManager } from '../SSEStreamManager';
import { AgentStateManager } from '../AgentStateManager';
import type { SSEEvent } from '../types';

vi.mock('../errorRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../errorRecovery')>();
  return { ...actual, getRetryDelay: () => 0 };
});

const encoder = new TextEncoder();

function sse(chunks: string[], ending: 'close' | 'drop'): Response {
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next < chunks.length) controller.enqueue(encoder.encode(chunks[next++]));
      else if (ending === 'close') controller.close();
      else controller.error(new TypeError('network error'));
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const frame = (id: number, event: object) => `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;

afterEach(() => vi.unstubAllGlobals());

describe('SSEStreamManager and the steering events', () => {
  it('delivers run_started, steer_applied, steer_dropped and skill_skipped in order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      frame(0, { type: 'run_started', runId: 'run-1' }),
      frame(1, { type: 'skill_skipped', skillId: 'good-skill', reason: 'disabled' }),
      frame(2, { type: 'agent_start' }),
      frame(3, { type: 'steer_applied', steerId: 's1', afterToolCallId: null }),
      frame(4, { type: 'steer_dropped', steerIds: ['s2'] }),
      frame(5, { type: 'agent_end' }),
    ], 'close')));
    const events: SSEEvent[] = [];
    await new SSEStreamManager({
      url: '/x', body: {}, onEvent: event => events.push(event),
      onError: () => undefined, onComplete: () => undefined,
    }).start();
    expect(events.map(event => event.type)).toEqual([
      'run_started', 'skill_skipped', 'agent_start', 'steer_applied', 'steer_dropped', 'agent_end']);
    expect(events[3]).toMatchObject({ steerId: 's1', afterToolCallId: null });
  });

  it('ignores an unknown event type and keeps reading (older/newer server compatibility)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse([
      frame(0, { type: 'from_the_future', payload: 1 }),
      frame(1, { type: 'text_delta', content: 'still here' }),
      frame(2, { type: 'agent_end' }),
    ], 'close')));
    const types: string[] = [];
    await new SSEStreamManager({
      url: '/x', body: {}, onEvent: event => types.push(event.type),
      onError: () => undefined, onComplete: () => undefined,
    }).start();
    expect(types).toContain('text_delta');
    expect(types).toContain('agent_end');
  });

  it('reports a reconnect through onRestart and delivers the NEW run id afterwards (AC-A10)', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(sse([frame(0, { type: 'run_started', runId: 'run-old' })], 'drop'))
      .mockResolvedValueOnce(sse([
        frame(0, { type: 'run_started', runId: 'run-new' }), frame(1, { type: 'agent_end' }),
      ], 'close')));
    const log: string[] = [];
    await new SSEStreamManager({
      url: '/x', body: {},
      onEvent: event => log.push(event.type === 'run_started' ? `run:${event.runId}` : event.type),
      onError: () => undefined, onComplete: () => undefined,
      onRestart: () => log.push('restart'),
    }).start();
    expect(log).toEqual(['run:run-old', 'restart', 'run:run-new', 'agent_end']);
  });
});

describe('AgentStateManager steers', () => {
  const note = (id: string, status: 'applied' | 'sent') => ({
    id, text: `note ${id}`, status, createdAt: 1, afterToolCallId: 'call-1',
  });

  it('persists only applied notes with the message', () => {
    const manager = new AgentStateManager('m1');
    expect(manager.toMessageUpdate().steers).toBeUndefined();
    manager.setSteers([note('a', 'applied'), note('b', 'sent')]);
    expect(manager.toMessageUpdate().steers).toEqual([note('a', 'applied')]);
  });

  it('forgets the notes when the turn restarts after a reconnect', () => {
    const manager = new AgentStateManager('m1');
    manager.setSteers([note('a', 'applied')]);
    manager.resetForRestart();
    expect(manager.toMessageUpdate().steers).toBeUndefined();
  });
});
