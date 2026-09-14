/**
 * SSEStreamManager reconnect rules (AG-01). The route cannot resume a turn,
 * so a reconnect is a clean restart, and it is never attempted once a tool
 * call was seen.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SSEStreamManager } from '../SSEStreamManager';
import { INTERRUPTED_AFTER_TOOLS_MESSAGE } from '../errorRecovery';
import type { SSEEvent } from '../types';

vi.mock('../errorRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../errorRecovery')>();
  // Reconnect at once: these tests pin what is retried, not the backoff.
  return { ...actual, getRetryDelay: () => 0 };
});

const encoder = new TextEncoder();

function frame(id: number, data: SSEEvent | '[DONE]'): string {
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  return `id: ${id}\ndata: ${payload}\n\n`;
}

/** An SSE response that streams `frames`, then ends normally or drops. */
function sseResponse(frames: string[], ending: 'close' | 'drop'): Response {
  let next = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (next < frames.length) {
          controller.enqueue(encoder.encode(frames[next]));
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
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const text = (content: string): SSEEvent => ({ type: 'text_delta', content });

const TOOL_CALL: SSEEvent = {
  type: 'tool_call', toolCallId: 'tc-1', toolName: 'generate_ai_video', params: {},
};
const TOOL_RESULT: SSEEvent = {
  type: 'tool_result', toolCallId: 'tc-1', toolName: 'generate_ai_video',
  result: { success: true }, operation: null,
};

function runStream(responses: Response[]) {
  const fetchMock = vi.fn();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);

  const events: SSEEvent[] = [];
  const onError = vi.fn();
  const onComplete = vi.fn();
  const onRestart = vi.fn();
  const manager = new SSEStreamManager({
    url: '/api/video-editing-agent/chat',
    body: {},
    onEvent: event => events.push(event),
    onError,
    onComplete,
    onRestart,
  });
  return { done: manager.start(), fetchMock, events, onError, onComplete, onRestart };
}

function deliveredText(events: SSEEvent[]): string[] {
  return events
    .filter((e): e is Extract<SSEEvent, { type: 'text_delta' }> => e.type === 'text_delta')
    .map(e => e.content);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SSEStreamManager — reconnect is a clean restart', () => {
  it('does not auto-retry after a tool_call was observed even without its result', async () => {
    const run = runStream([sseResponse([frame(0, TOOL_CALL)], 'drop')]);
    await run.done;

    expect(run.fetchMock).toHaveBeenCalledTimes(1);
    expect(run.onError).toHaveBeenCalledWith(expect.objectContaining({
      recoverable: false,
      userMessage: INTERRUPTED_AFTER_TOOLS_MESSAGE,
    }));
  });

  it('does not auto-retry after a tool_result was delivered', async () => {
    const run = runStream([sseResponse([frame(0, TOOL_RESULT)], 'drop')]);
    await run.done;

    expect(run.fetchMock).toHaveBeenCalledTimes(1);
    expect(run.onError).toHaveBeenCalledWith(expect.objectContaining({
      recoverable: false,
      userMessage: INTERRUPTED_AFTER_TOOLS_MESSAGE,
    }));
  });

  it('still retries a disconnect before any tool_call', async () => {
    const run = runStream([
      sseResponse([frame(0, text('thinking about it'))], 'drop'),
      sseResponse([frame(0, text('done')), frame(1, '[DONE]')], 'close'),
    ]);
    await run.done;

    expect({
      fetches: run.fetchMock.mock.calls.length,
      completed: run.onComplete.mock.calls.length,
      errors: run.onError.mock.calls.length,
    }).toEqual({ fetches: 2, completed: 1, errors: 0 });
  });

  it('a restart delivers every rerun event although ids restart at 0', async () => {
    const run = runStream([
      sseResponse([frame(0, text('a')), frame(1, text('b'))], 'drop'),
      sseResponse([frame(0, text('x')), frame(1, text('y')), frame(2, '[DONE]')], 'close'),
    ]);
    await run.done;

    expect(deliveredText(run.events)).toEqual(['a', 'b', 'x', 'y']);
  });

  it('a restart calls onRestart and sends no Last-Event-ID header', async () => {
    const run = runStream([
      sseResponse([frame(0, text('a')), frame(1, text('b'))], 'drop'),
      sseResponse([frame(0, '[DONE]')], 'close'),
    ]);
    await run.done;

    const retryInit = run.fetchMock.mock.calls[1][1] as RequestInit;
    expect(run.onRestart.mock.calls).toEqual([[1]]);
    expect(Object.keys(retryInit.headers as Record<string, string>))
      .not.toContain('Last-Event-ID');
  });
});
