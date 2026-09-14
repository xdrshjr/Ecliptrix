/**
 * AG3-01: SSE parsing keeps an unfinished event across network chunks. A
 * chunk that ended between an event's data line and its blank line used to
 * drop the whole event, so a tool result the server applied never reached
 * the client timeline.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SSEStreamManager } from '../SSEStreamManager';
import type { SSEEvent } from '../types';

vi.mock('../errorRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../errorRecovery')>();
  // Reconnect at once: the restart test pins what is delivered, not the backoff.
  return { ...actual, getRetryDelay: () => 0 };
});

const encoder = new TextEncoder();

function parser(): SSEStreamManager {
  return new SSEStreamManager({
    url: '/api/video-editing-agent/chat',
    body: {},
    onEvent: () => undefined,
    onError: () => undefined,
    onComplete: () => undefined,
  });
}

/** An SSE response that streams raw `chunks`, then ends normally or drops. */
function sseResponse(chunks: string[], ending: 'close' | 'drop'): Response {
  let next = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (next < chunks.length) {
          controller.enqueue(encoder.encode(chunks[next]));
          next += 1;
        } else if (ending === 'close') {
          controller.close();
        } else {
          controller.error(new TypeError('network error'));
        }
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SSEStreamManager — events split across chunks', () => {
  it('an event whose blank line arrives in the next chunk is delivered', () => {
    const manager = parser();

    const first = manager.parseSSEBuffer('id: 3\ndata: {"type":"tool_result","toolCallId":"tc-3","toolName":"delete_clip","result":{},"operation":null}\n');
    const second = manager.parseSSEBuffer('\n');

    expect({ first, second }).toEqual({
      first: [],
      second: [{
        type: 'tool_result', toolCallId: 'tc-3', toolName: 'delete_clip', result: {}, operation: null, _eventId: 3,
      }],
    });
  });

  it('id and data lines split across chunks keep their event id', () => {
    const manager = parser();

    const events = [
      ...manager.parseSSEBuffer('id: 7\n'),
      ...manager.parseSSEBuffer('data: {"type":"text_'),
      ...manager.parseSSEBuffer('delta","content":"hi"}\n'),
      ...manager.parseSSEBuffer('\n'),
    ];

    expect(events).toEqual([{ type: 'text_delta', content: 'hi', _eventId: 7 }]);
  });

  it('a restart discards a half-received event', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sseResponse(['id: 0\ndata: {"type":"text_delta","content":"stale"}\n'], 'drop'))
      .mockResolvedValueOnce(sseResponse(['id: 0\ndata: {"type":"text_delta","content":"fresh"}\n\n', 'data: [DONE]\n\n'], 'close'));
    vi.stubGlobal('fetch', fetchMock);
    const events: SSEEvent[] = [];
    const manager = new SSEStreamManager({
      url: '/api/video-editing-agent/chat',
      body: {},
      onEvent: event => events.push(event),
      onError: () => undefined,
      onComplete: () => undefined,
    });

    await manager.start();

    expect(events.filter(event => event.type === 'text_delta')).toEqual([
      { type: 'text_delta', content: 'fresh', _eventId: 0 },
    ]);
  });
});
