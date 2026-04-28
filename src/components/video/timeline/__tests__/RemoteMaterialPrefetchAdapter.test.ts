import { describe, it, expect, vi } from 'vitest';
import { RemoteMaterialPrefetchAdapter } from '../infrastructure/RemoteMaterialPrefetchAdapter';
import type { RemoteMaterialResult } from '../domain/ports';

// Build a fake fetch that returns a queue of canned responses based on URL.
// Keeps tests deterministic and fast (no timers, no real network).
function makeFetch(handlers: {
  ingestQueue?: RemoteMaterialResult[][];
  lookupQueue?: RemoteMaterialResult[];
  shouldFailLookup?: () => boolean;
}) {
  const ingestQueue = handlers.ingestQueue ?? [];
  const lookupQueue = handlers.lookupQueue ?? [];
  const log: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.startsWith('/api/material/ingest')) {
      log.push('ingest');
      const next = ingestQueue.shift() ?? [];
      return new Response(JSON.stringify({ success: true, items: next }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.startsWith('/api/material/lookup')) {
      log.push('lookup');
      if (handlers.shouldFailLookup?.()) {
        return new Response('boom', { status: 500 });
      }
      const next = lookupQueue.shift();
      if (!next) {
        return new Response(JSON.stringify({ status: 'pending' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(next), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  return { fetchImpl, log };
}

// Sleep stub that resolves immediately so polling loops finish synchronously.
const noopSleep = () => Promise.resolve();

const KEY = { source: 'pexels', source_id: '12345', url: 'https://x/v.mp4' };

describe('RemoteMaterialPrefetchAdapter', () => {
  it('short-circuits when ingest already returns ready+local_url', async () => {
    const { fetchImpl, log } = makeFetch({
      ingestQueue: [[
        {
          source: 'pexels',
          source_id: '12345',
          material_id: 'mid-1',
          status: 'ready',
          local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
        },
      ]],
    });
    const adapter = new RemoteMaterialPrefetchAdapter({ fetchImpl, sleepImpl: noopSleep });
    const result = await adapter.pollUntilReady(KEY);
    expect(result.status).toBe('ready');
    expect(result.local_url).toContain('cached_materials');
    expect(log).toEqual(['ingest']); // no lookup calls
  });

  it('polls until ready when ingest returns pending', async () => {
    const { fetchImpl, log } = makeFetch({
      ingestQueue: [[
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'pending' },
      ]],
      lookupQueue: [
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'downloading' },
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'downloading' },
        {
          source: 'pexels',
          source_id: '12345',
          material_id: 'mid-1',
          status: 'ready',
          local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
        },
      ],
    });
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: noopSleep,
      initialDelayMs: 1,
      maxDelayMs: 1,
    });
    const result = await adapter.pollUntilReady(KEY);
    expect(result.status).toBe('ready');
    expect(log).toEqual(['ingest', 'lookup', 'lookup', 'lookup']);
  });

  it('returns failed terminal status from poll', async () => {
    const { fetchImpl } = makeFetch({
      ingestQueue: [[
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'pending' },
      ]],
      lookupQueue: [
        {
          source: 'pexels',
          source_id: '12345',
          material_id: 'mid-1',
          status: 'failed',
          error_message: 'ffmpeg blew up',
        },
      ],
    });
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: noopSleep,
      initialDelayMs: 1,
    });
    const r = await adapter.pollUntilReady(KEY);
    expect(r.status).toBe('failed');
    expect(r.error_message).toBe('ffmpeg blew up');
  });

  it('respects total timeout and returns failed', async () => {
    const { fetchImpl } = makeFetch({
      ingestQueue: [[
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'pending' },
      ]],
      lookupQueue: [], // never returns terminal — sleep stub resolves immediately
    });
    // sleepImpl that advances a clock so totalTimeoutMs is reached without
    // real waiting.
    let virtualNow = 0;
    const sleep = (ms: number) => {
      virtualNow += ms;
      return Promise.resolve();
    };
    vi.spyOn(Date, 'now').mockImplementation(() => virtualNow);
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: sleep,
      initialDelayMs: 1000,
      maxDelayMs: 1000,
      totalTimeoutMs: 3000,
    });
    const r = await adapter.pollUntilReady(KEY);
    expect(r.status).toBe('failed');
    expect(r.error_message).toMatch(/timed out/);
    vi.restoreAllMocks();
  });

  it('honors AbortController by rejecting with AbortError', async () => {
    const { fetchImpl } = makeFetch({
      ingestQueue: [[
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'pending' },
      ]],
      lookupQueue: [],
    });
    const ctrl = new AbortController();
    const sleep = (_ms: number, signal?: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          },
          { once: true },
        );
      });
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: sleep,
      initialDelayMs: 1,
    });
    const promise = adapter.pollUntilReady(KEY, { signal: ctrl.signal });
    // Fire abort after the ingest returns pending and we enter the sleep loop.
    setTimeout(() => ctrl.abort(), 10);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('dedup: same (source, source_id) produces a single ingest', async () => {
    const { fetchImpl, log } = makeFetch({
      ingestQueue: [[
        {
          source: 'pexels',
          source_id: '12345',
          material_id: 'mid-1',
          status: 'ready',
          local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
        },
      ]],
    });
    const adapter = new RemoteMaterialPrefetchAdapter({ fetchImpl, sleepImpl: noopSleep });
    // Fire two concurrent calls — they should collapse onto one in-flight poll.
    const [a, b] = await Promise.all([
      adapter.pollUntilReady(KEY),
      adapter.pollUntilReady(KEY),
    ]);
    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    // ingest count must be 1 (the second call joins the first promise)
    expect(log.filter((x) => x === 'ingest').length).toBe(1);
  });

  it('emits onProgress for ingest result and each lookup transition', async () => {
    const transitions: string[] = [];
    const { fetchImpl } = makeFetch({
      ingestQueue: [[
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'pending' },
      ]],
      lookupQueue: [
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'downloading' },
        {
          source: 'pexels',
          source_id: '12345',
          material_id: 'mid-1',
          status: 'ready',
          local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
        },
      ],
    });
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: noopSleep,
      initialDelayMs: 1,
    });
    await adapter.pollUntilReady(KEY, {
      onProgress: (r) => transitions.push(r.status),
    });
    expect(transitions).toEqual(['pending', 'downloading', 'ready']);
  });

  it('survives a transient lookup failure and continues polling', async () => {
    let calls = 0;
    const { fetchImpl } = makeFetch({
      ingestQueue: [[
        { source: 'pexels', source_id: '12345', material_id: 'mid-1', status: 'pending' },
      ]],
      lookupQueue: [
        {
          source: 'pexels',
          source_id: '12345',
          material_id: 'mid-1',
          status: 'ready',
          local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
        },
      ],
      shouldFailLookup: () => calls++ < 1, // first call returns 500
    });
    const adapter = new RemoteMaterialPrefetchAdapter({
      fetchImpl,
      sleepImpl: noopSleep,
      initialDelayMs: 1,
    });
    const r = await adapter.pollUntilReady(KEY);
    expect(r.status).toBe('ready');
  });
});
