/**
 * LocalMediaCache — whole-file download + blob cache
 * (docs/plans/video-editor-client-preview-download/spec.md §3.3.2 / §7.1).
 *
 * Covers: byte-progress accumulation, Content-Length-absent degrade (no NaN),
 * in-flight dedup, revoke, LRU never evicting timeline-referenced materials,
 * and the C5 "clone-before-getReader" ordering when CacheStorage is enabled.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalMediaCache } from '../LocalMediaCache';

// jsdom does not implement URL.createObjectURL / revokeObjectURL — stub them.
let _blobCounter = 0;
const revokeSpy = vi.fn();
beforeEach(() => {
  _blobCounter = 0;
  revokeSpy.mockClear();
  URL.createObjectURL = vi.fn(() => `blob:mock-${++_blobCounter}`);
  URL.revokeObjectURL = revokeSpy;
});
afterEach(() => {
  vi.restoreAllMocks();
});

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

interface FakeResponseOpts {
  ok?: boolean;
  status?: number;
  contentLength?: number | null;
  contentType?: string;
}

function makeFetch(chunks: Uint8Array[], opts: FakeResponseOpts = {}) {
  const { ok = true, status = 200, contentLength = undefined, contentType = 'video/mp4' } = opts;
  const headers = new Map<string, string>();
  if (contentLength != null) headers.set('content-length', String(contentLength));
  if (contentType) headers.set('content-type', contentType);

  const build = () => {
    const resp: any = {
      ok,
      status,
      headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
      body: streamFrom(chunks),
      clone() {
        return { ...resp, body: streamFrom(chunks) };
      },
      async blob() {
        return new Blob(chunks as BlobPart[], { type: contentType });
      },
    };
    return resp;
  };
  return vi.fn(async () => build());
}

describe('LocalMediaCache', () => {
  it('accumulates byte progress and returns a blob url + size', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7])];
    const fetchImpl = makeFetch(chunks, { contentLength: 7 });
    const cache = new LocalMediaCache({ fetchImpl });
    const onProgress = vi.fn();

    const result = await cache.getOrDownload('m1', '/api/storage/files/x.mp4', { onProgress });

    expect(result.bytes).toBe(7);
    expect(result.blobUrl).toMatch(/^blob:mock-/);
    expect(onProgress).toHaveBeenCalledWith(3, 7);
    expect(onProgress).toHaveBeenCalledWith(7, 7);
    expect(cache.has('m1')).toBe(true);
    expect(cache.totalBytes()).toBe(7);
  });

  it('degrades to total=null when Content-Length is missing (no NaN)', async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const fetchImpl = makeFetch(chunks, { contentLength: null });
    const cache = new LocalMediaCache({ fetchImpl });
    const onProgress = vi.fn();

    await cache.getOrDownload('m1', '/x.mp4', { onProgress });

    // Every progress call reports total === null and never NaN.
    for (const call of onProgress.mock.calls) {
      expect(call[1]).toBeNull();
      expect(Number.isNaN(call[0])).toBe(false);
    }
  });

  it('dedups concurrent downloads for the same materialId (fetch once)', async () => {
    const fetchImpl = makeFetch([new Uint8Array([1, 2, 3])], { contentLength: 3 });
    const cache = new LocalMediaCache({ fetchImpl });

    const [a, b] = await Promise.all([
      cache.getOrDownload('same', '/x.mp4'),
      cache.getOrDownload('same', '/x.mp4'),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.blobUrl).toBe(b.blobUrl);
  });

  it('short-circuits an already-ready material without re-fetching', async () => {
    const fetchImpl = makeFetch([new Uint8Array([1])], { contentLength: 1 });
    const cache = new LocalMediaCache({ fetchImpl });
    await cache.getOrDownload('m1', '/x.mp4');
    await cache.getOrDownload('m1', '/x.mp4');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('revoke() releases the object url and forgets the entry', async () => {
    const fetchImpl = makeFetch([new Uint8Array([1, 2])], { contentLength: 2 });
    const cache = new LocalMediaCache({ fetchImpl });
    const { blobUrl } = await cache.getOrDownload('m1', '/x.mp4');

    cache.revoke('m1');

    expect(cache.has('m1')).toBe(false);
    expect(revokeSpy).toHaveBeenCalledWith(blobUrl);
  });

  it('enforceBudget never evicts timeline-referenced materials', async () => {
    // Budget of 5 bytes; two 3-byte blobs (6 total) → over budget.
    const cache = new LocalMediaCache({
      fetchImpl: makeFetch([new Uint8Array([1, 2, 3])], { contentLength: 3 }),
      budgetBytes: 5,
    });
    await cache.getOrDownload('keep', '/a.mp4'); // timeline-referenced
    await cache.getOrDownload('drop', '/b.mp4'); // not referenced

    cache.enforceBudget(new Set(['keep']));

    expect(cache.has('keep')).toBe(true); // protected — survives
    expect(cache.has('drop')).toBe(false); // LRU-evicted
  });

  it('enforceBudget warns (does not crash) when the timeline itself exceeds budget', async () => {
    const onBudgetWarning = vi.fn();
    const cache = new LocalMediaCache({
      fetchImpl: makeFetch([new Uint8Array([1, 2, 3, 4, 5, 6])], { contentLength: 6 }),
      budgetBytes: 4,
      onBudgetWarning,
    });
    await cache.getOrDownload('keep', '/a.mp4'); // 6 bytes, protected

    cache.enforceBudget(new Set(['keep']));

    expect(cache.has('keep')).toBe(true); // never evicted (correctness first)
    expect(onBudgetWarning).toHaveBeenCalledTimes(1);
  });

  it('C5 — clones the response BEFORE getReader when persisting (no body-locked)', async () => {
    const put = vi.fn(async (_key: string, _val: unknown) => undefined);
    const match = vi.fn(async () => undefined);
    // @ts-expect-error - test stub for CacheStorage
    globalThis.caches = { open: vi.fn(async () => ({ put, match })) };

    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4])];
    const fetchImpl = makeFetch(chunks, { contentLength: 4 });
    const cache = new LocalMediaCache({ fetchImpl, persist: true });
    const onProgress = vi.fn();

    const result = await cache.getOrDownload('m1', '/x.mp4', {
      onProgress,
      cacheKey: 'src::1',
    });

    // The clone went to cache.put while the original drove progress — both
    // consumed without "body already locked".
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toBe('src::1');
    expect(result.bytes).toBe(4);
    expect(onProgress).toHaveBeenCalledWith(4, 4);

    // @ts-expect-error - cleanup test stub
    delete globalThis.caches;
  });
});
