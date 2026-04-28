import { describe, it, expect, vi } from 'vitest';
import { RemoteMaterialPrefetchAdapter } from '../infrastructure/RemoteMaterialPrefetchAdapter';
import type { RemoteMaterialResult } from '../domain/ports';
import {
  MissingAuthError,
  SessionExpiredError,
  __resetSessionExpiryFlagForTests,
} from '@/lib/api/http-client';
import { SESSION_TOKEN_KEY } from '@/lib/auth/storage-keys';

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

  describe('http-client integration (no fetchImpl test seam)', () => {
    // These tests verify the production code path: when fetchImpl is NOT
    // injected, the adapter MUST route through the http-client wrapper so
    // that Authorization is attached and 401 funnels through the global
    // session-expired handler. Skipping http-client is what produced the
    // /api/material/ingest 401 spam (the very bug this suite guards).

    it('throws MissingAuthError when ingest is called with no session token', async () => {
      window.localStorage.removeItem(SESSION_TOKEN_KEY);
      __resetSessionExpiryFlagForTests();
      // No fetchImpl override → must go through http-client, which requires
      // a token by default and throws synchronously when missing.
      const adapter = new RemoteMaterialPrefetchAdapter({ sleepImpl: noopSleep });
      await expect(adapter.ingest([KEY])).rejects.toBeInstanceOf(MissingAuthError);
    });

    it('routes ingest through http-client when fetchImpl is not provided (Authorization header attached)', async () => {
      window.localStorage.setItem(SESSION_TOKEN_KEY, 'tok-123');
      __resetSessionExpiryFlagForTests();
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              items: [
                {
                  source: 'pexels',
                  source_id: '12345',
                  material_id: 'mid-1',
                  status: 'ready',
                  local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );

      const adapter = new RemoteMaterialPrefetchAdapter({ sleepImpl: noopSleep });
      const out = await adapter.ingest([KEY]);
      expect(out).toHaveLength(1);
      expect(out[0]?.status).toBe('ready');

      // Verify the http-client actually injected Authorization on the wire.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBe('Bearer tok-123');
      fetchSpy.mockRestore();
    });

    it('propagates SessionExpiredError out of pollUntilReady on 401 (no infinite retry)', async () => {
      window.localStorage.setItem(SESSION_TOKEN_KEY, 'tok-expired');
      __resetSessionExpiryFlagForTests();
      // Stub window.location so the global redirect side-effect doesn't
      // throw inside jsdom — we only care that the error surfaces.
      const originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: { pathname: '/editor', href: '' },
      });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('', { status: 401 }));

      const adapter = new RemoteMaterialPrefetchAdapter({ sleepImpl: noopSleep });
      await expect(adapter.pollUntilReady(KEY)).rejects.toBeInstanceOf(
        SessionExpiredError,
      );
      // Critical: the failed-retry death loop is broken. ingest is hit
      // exactly once and the loop bails immediately.
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      Object.defineProperty(window, 'location', {
        configurable: true,
        value: originalLocation,
      });
      fetchSpy.mockRestore();
    });
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
