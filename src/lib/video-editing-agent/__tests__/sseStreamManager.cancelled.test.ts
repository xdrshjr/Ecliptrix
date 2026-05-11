import { describe, it, expect, vi } from 'vitest';
import { SSEStreamManager } from '../SSEStreamManager';
import type { SSEEvent } from '../types';

describe('SSEStreamManager — cancelled event handling', () => {
  it('treats a `cancelled` SSE event as a terminal stream-end signal', async () => {
    // Construct a server-side ReadableStream that emits exactly:
    //   id: 0  data: stream-start (comment)
    //   id: 1  data: {"type":"cancelled","reason":"client_aborted"}
    // then closes — the SSEStreamManager should deliver the cancelled event
    // to onEvent, NOT call onError, and call onComplete exactly once.
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(': stream-start\n\n'));
        controller.enqueue(
          encoder.encode(
            `id: 1\ndata: ${JSON.stringify({ type: 'cancelled', reason: 'client_aborted', timestamp: 0 })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    vi.stubGlobal('fetch', fakeFetch);

    const events: SSEEvent[] = [];
    const onComplete = vi.fn();
    const onError = vi.fn();

    const manager = new SSEStreamManager({
      url: '/api/test',
      body: {},
      onEvent: (e) => events.push(e),
      onComplete,
      onError,
    });

    await manager.start();

    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('cancelled');

    vi.unstubAllGlobals();
  });

  it('cancel() does not invoke onError (user-initiated abort)', async () => {
    const encoder = new TextEncoder();
    const bodyControllerRef: { current: ReadableStreamDefaultController<Uint8Array> | null } = {
      current: null,
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyControllerRef.current = controller;
        controller.enqueue(encoder.encode(': stream-start\n\n'));
      },
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    ));

    const onComplete = vi.fn();
    const onError = vi.fn();

    const manager = new SSEStreamManager({
      url: '/api/test',
      body: {},
      onEvent: () => {},
      onComplete,
      onError,
    });

    const startPromise = manager.start();
    // Allow the initial fetch + read loop to settle on the first read.
    await new Promise((r) => setTimeout(r, 10));

    manager.cancel();
    try { bodyControllerRef.current?.close(); } catch { /* already closed */ }
    await startPromise;

    expect(onError).not.toHaveBeenCalled();
    expect(manager.isCancelled).toBe(true);

    vi.unstubAllGlobals();
  });
});
