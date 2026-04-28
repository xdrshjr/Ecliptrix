import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useRemoteMaterialPrefetch } from '../useRemoteMaterialPrefetch';
import type {
  IRemoteMaterialPrefetchPort,
  RemoteMaterialKey,
  RemoteMaterialResult,
} from '../../timeline/domain/ports';
import type { MaterialItem } from '@/types';

const ORIGIN = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';

function makeMaterial(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'm1',
    name: 'sample.mp4',
    type: 'video',
    format: 'mp4',
    size: 1234,
    url: 'https://videos.pexels.com/v.mp4',
    createdAt: new Date(),
    metadata: { source: 'pexels', id: '12345' },
    ...over,
  } as MaterialItem;
}

interface FakeAdapter extends IRemoteMaterialPrefetchPort {
  pollCalls: number;
  lastKey?: RemoteMaterialKey;
}

function makeAdapter(
  ingestResult: RemoteMaterialResult,
  pollResult?: RemoteMaterialResult,
): FakeAdapter {
  const adapter: FakeAdapter = {
    pollCalls: 0,
    lastKey: undefined,
    async ingest(_items) {
      return [ingestResult];
    },
    async pollUntilReady(key, opts) {
      adapter.lastKey = key;
      adapter.pollCalls++;
      const r = pollResult ?? ingestResult;
      opts?.onProgress?.(ingestResult);
      if (pollResult) opts?.onProgress?.(pollResult);
      return r;
    },
  };
  return adapter;
}

describe('useRemoteMaterialPrefetch', () => {
  it('skips when material has no URL', () => {
    const adapter = makeAdapter({
      source: 'pexels',
      source_id: '12345',
      material_id: '',
      status: 'ready',
      local_url: '/cache/x.mp4',
    });
    const spy = vi.spyOn(adapter, 'pollUntilReady');
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch([makeMaterial({ url: '' })], onPatch, { adapter }),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('skips same-origin URLs (already on /api/storage/files)', () => {
    const adapter = makeAdapter({
      source: 'pexels',
      source_id: '12345',
      material_id: '',
      status: 'ready',
      local_url: '',
    });
    const spy = vi.spyOn(adapter, 'pollUntilReady');
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch(
        [makeMaterial({ url: `${ORIGIN}/api/storage/files/foo.mp4` })],
        onPatch,
        { adapter },
      ),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('patches pending then ready as the poll resolves', async () => {
    const adapter = makeAdapter(
      {
        source: 'pexels',
        source_id: '12345',
        material_id: 'mid-1',
        status: 'pending',
      },
      {
        source: 'pexels',
        source_id: '12345',
        material_id: 'mid-1',
        status: 'ready',
        local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
      },
    );
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch([makeMaterial()], onPatch, { adapter }),
    );

    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ cacheStatus: 'ready' }),
      );
    });

    const calls = onPatch.mock.calls.map((c) => c[1]);
    // First patch is the optimistic 'pending' marker.
    expect(calls[0]).toEqual(expect.objectContaining({ cacheStatus: 'pending' }));
    // A 'ready' patch carries the cacheUrl.
    const readyPatch = calls.find((p) => p.cacheStatus === 'ready');
    expect(readyPatch?.cacheUrl).toContain('cached_materials');
  });

  it('uses (source, source_id) from metadata when present', async () => {
    const adapter = makeAdapter({
      source: 'pexels',
      source_id: '12345',
      material_id: 'mid-1',
      status: 'ready',
      local_url: '/api/storage/files/cached_materials/pexels/12345.mp4',
    });
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch([makeMaterial()], onPatch, { adapter }),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    expect((adapter as any).lastKey).toEqual(
      expect.objectContaining({ source: 'pexels', source_id: '12345' }),
    );
  });

  it('falls back to url-derived source_id when no metadata.id', async () => {
    const adapter = makeAdapter({
      source: 'url',
      source_id: 'x',
      material_id: 'mid-1',
      status: 'ready',
      local_url: '/c/x.mp4',
    });
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch(
        [makeMaterial({ metadata: {} })],
        onPatch,
        { adapter },
      ),
    );
    await waitFor(() => expect(onPatch).toHaveBeenCalled());
    expect((adapter as any).lastKey?.source).toBe('url');
    expect((adapter as any).lastKey?.source_id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('does NOT re-trigger when material already has cacheStatus=ready', () => {
    const adapter = makeAdapter({
      source: 'pexels',
      source_id: '12345',
      material_id: '',
      status: 'ready',
      local_url: '/c/x.mp4',
    });
    const spy = vi.spyOn(adapter, 'pollUntilReady');
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch(
        [makeMaterial({ cacheStatus: 'ready', cacheUrl: '/c/x.mp4' })],
        onPatch,
        { adapter },
      ),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces failed terminal state with cacheError', async () => {
    const adapter = makeAdapter({
      source: 'pexels',
      source_id: '12345',
      material_id: 'mid-1',
      status: 'failed',
      error_message: 'ffmpeg blew up',
    });
    const onPatch = vi.fn();
    renderHook(() =>
      useRemoteMaterialPrefetch([makeMaterial()], onPatch, { adapter }),
    );
    await waitFor(() => {
      expect(onPatch).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ cacheStatus: 'failed' }),
      );
    });
    const failedPatch = onPatch.mock.calls
      .map((c) => c[1])
      .find((p) => p.cacheStatus === 'failed');
    expect(failedPatch?.cacheError).toBe('ffmpeg blew up');
  });

  it('aborts in-flight pollers on unmount', async () => {
    const aborted: boolean[] = [];
    const adapter: IRemoteMaterialPrefetchPort = {
      async ingest() {
        return [];
      },
      pollUntilReady(_k, opts) {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener(
            'abort',
            () => {
              aborted.push(true);
              const e = new Error('Aborted');
              e.name = 'AbortError';
              reject(e);
            },
            { once: true },
          );
        });
      },
    };
    const onPatch = vi.fn();
    const { unmount } = renderHook(() =>
      useRemoteMaterialPrefetch([makeMaterial()], onPatch, { adapter }),
    );
    // Wait one tick so the effect actually fires and registers the controller.
    await act(async () => {
      await Promise.resolve();
    });
    unmount();
    expect(aborted).toEqual([true]);
  });
});
