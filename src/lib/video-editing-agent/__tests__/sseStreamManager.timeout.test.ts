/**
 * AG2-21: the client ends a run for lack of progress, not after a fixed 30
 * minutes, and only after the server's own idle timeout plus a grace period
 * so the server's timeout error reaches the user first.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { SSEStreamManager, IDLE_TIMEOUT_ERROR_MESSAGE } from '../SSEStreamManager';
import { StreamErrorType } from '../errorRecovery';
import { AGENT_IDLE_TIMEOUT_MS, CLIENT_IDLE_GRACE_MS } from '../timeouts';
import type { SSEEvent } from '../types';

const MINUTE = 60_000;
const encoder = new TextEncoder();

/** A connected stream the test writes to; aborting the fetch errors it. */
function openStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }));
  const onError = vi.fn();
  const onComplete = vi.fn();
  const manager = new SSEStreamManager({
    url: '/api/video-editing-agent/chat',
    body: {},
    // Keep the chunk-gap heartbeat out of the way: these tests pin the idle timer.
    heartbeatTimeout: 24 * 60 * MINUTE,
    onEvent: () => undefined,
    onError,
    onComplete,
  });
  return {
    done: manager.start(),
    send: (text: string) => controller.enqueue(encoder.encode(text)),
    onError,
    onComplete,
  };
}

const frame = (event: SSEEvent): string => `data: ${JSON.stringify(event)}\n\n`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SSEStreamManager — idle timeout', () => {
  it('tool activity keeps a stream alive past 30 minutes', async () => {
    const run = openStream();
    const toolCall: SSEEvent = { type: 'tool_call', toolCallId: 'tc-1', toolName: 'batch_storyboard_video', params: {} };
    const toolResult: SSEEvent = { type: 'tool_result', toolCallId: 'tc-1', toolName: 'batch_storyboard_video', result: {}, operation: null };

    run.send(frame(toolCall));
    await vi.advanceTimersByTimeAsync(25 * MINUTE);
    run.send(frame(toolResult));
    await vi.advanceTimersByTimeAsync(25 * MINUTE);
    run.send(frame({ type: 'text_delta', content: 'done' }));
    await vi.advanceTimersByTimeAsync(25 * MINUTE);
    const errorsWhileActive = run.onError.mock.calls.length;
    run.send('data: [DONE]\n\n');
    await run.done;

    expect({ errorsWhileActive, completed: run.onComplete.mock.calls.length })
      .toEqual({ errorsWhileActive: 0, completed: 1 });
  });

  it('an idle stream is ended by the client only after the server timeout plus grace', async () => {
    const run = openStream();

    run.send(frame({ type: 'text_delta', content: 'working' }));
    // Keepalive comments arrive, but they are not progress.
    for (let minute = 0; minute < 30; minute++) {
      run.send(': keepalive\n\n');
      await vi.advanceTimersByTimeAsync(MINUTE);
    }
    await vi.advanceTimersByTimeAsync(AGENT_IDLE_TIMEOUT_MS - 30 * MINUTE + 1_000);
    const errorsAtServerTimeout = run.onError.mock.calls.length;
    await vi.advanceTimersByTimeAsync(CLIENT_IDLE_GRACE_MS);
    await run.done;

    expect({ errorsAtServerTimeout, errors: run.onError.mock.calls.map(call => call[0]) }).toEqual({
      errorsAtServerTimeout: 0,
      errors: [expect.objectContaining({ type: StreamErrorType.TOTAL_TIMEOUT, message: IDLE_TIMEOUT_ERROR_MESSAGE })],
    });
  });
});
