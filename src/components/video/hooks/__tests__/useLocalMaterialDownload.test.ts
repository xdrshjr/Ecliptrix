/**
 * useLocalMaterialDownload — download orchestration
 * (docs/plans/video-editor-client-preview-download/spec.md §3.3.3 / §7.1).
 *
 * Covers: video waits for previewProxyStatus='cached' before downloading;
 * audio downloads directly; image is skipped (C2); ready/degraded transitions;
 * transcode timeout + proxy-failed degrade (C3); remote audio routed through
 * buildProxyUrl; move-out revokes; disabled is a no-op.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MaterialItem } from '@/types';
import type { MediaProxyClient } from '../../timeline/infrastructure/MediaProxyClient';
import type { LocalMediaCache } from '../../timeline/infrastructure/LocalMediaCache';
import {
  useLocalMaterialDownload,
  type UseLocalMaterialDownloadOptions,
} from '../useLocalMaterialDownload';

function mat(patch: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'm',
    name: 'm',
    type: 'video',
    format: 'mp4',
    size: 1000,
    url: '',
    createdAt: new Date(),
    ...patch,
  } as MaterialItem;
}

function makeCache() {
  return {
    getOrDownload: vi.fn(async () => ({ blobUrl: 'blob:x', bytes: 100 })),
    revoke: vi.fn(),
    clear: vi.fn(),
    enforceBudget: vi.fn(() => ({ totalBytes: 0, protectedBytes: 0, budgetBytes: 1 })),
    has: vi.fn(() => false),
    getBlobUrl: vi.fn(),
    totalBytes: vi.fn(() => 0),
  } as unknown as LocalMediaCache & { getOrDownload: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> };
}

function makeClient() {
  return {
    buildProxyUrl: vi.fn((u: string) =>
      /^https?:\/\//i.test(u) ? `/api/media/proxy?u=${encodeURIComponent(u)}` : u,
    ),
  } as unknown as MediaProxyClient & { buildProxyUrl: ReturnType<typeof vi.fn> };
}

function opts(
  over: Partial<UseLocalMaterialDownloadOptions> & {
    ids: string[];
    onPatch: ReturnType<typeof vi.fn>;
    cache: LocalMediaCache;
    client: MediaProxyClient;
  },
): UseLocalMaterialDownloadOptions {
  return {
    timelineReferencedMaterialIds: new Set(over.ids),
    onPatch: over.onPatch,
    cache: over.cache,
    mediaProxyClient: over.client,
    disabled: over.disabled,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLocalMaterialDownload', () => {
  it('video waits in `transcoding` until previewProxyStatus is cached', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [mat({ id: 'v1', type: 'video', previewProxyStatus: 'queued' })],
        opts({ ids: ['v1'], onPatch, cache, client }),
      ),
    );
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('v1', expect.objectContaining({ localProxyStatus: 'transcoding' })),
    );
    expect((cache as any).getOrDownload).not.toHaveBeenCalled();
  });

  it('video with cached proxy downloads → ready (blob url)', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [
          mat({
            id: 'v1',
            type: 'video',
            previewProxyStatus: 'cached',
            previewProxyLocalUrl: '/api/storage/files/preview-proxies/v1/480p.mp4',
          }),
        ],
        opts({ ids: ['v1'], onPatch, cache, client }),
      ),
    );
    await waitFor(() => expect((cache as any).getOrDownload).toHaveBeenCalled());
    const url = (cache as any).getOrDownload.mock.calls[0][1] as string;
    expect(url).toContain('/api/storage/files/preview-proxies/v1/480p.mp4');
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ localProxyStatus: 'ready', localProxyUrl: 'blob:x' }),
      ),
    );
    expect(onPatch).toHaveBeenCalledWith('v1', expect.objectContaining({ localProxyStatus: 'downloading' }));
  });

  it('audio downloads directly (no transcoding wait)', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [mat({ id: 'a1', type: 'audio', cacheUrl: '/api/storage/files/cached_materials/x/a.mp3' })],
        opts({ ids: ['a1'], onPatch, cache, client }),
      ),
    );
    await waitFor(() => expect((cache as any).getOrDownload).toHaveBeenCalled());
    expect(onPatch).not.toHaveBeenCalledWith('a1', expect.objectContaining({ localProxyStatus: 'transcoding' }));
  });

  it('image is skipped — not downloaded, not gated (C2)', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [mat({ id: 'i1', type: 'image' })],
        opts({ ids: ['i1'], onPatch, cache, client }),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect((cache as any).getOrDownload).not.toHaveBeenCalled();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('disabled → no-op (no patch, no fetch)', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [
          mat({
            id: 'v1',
            type: 'video',
            previewProxyStatus: 'cached',
            previewProxyLocalUrl: '/x/480p.mp4',
          }),
        ],
        opts({ ids: ['v1'], onPatch, cache, client, disabled: true }),
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(onPatch).not.toHaveBeenCalled();
    expect((cache as any).getOrDownload).not.toHaveBeenCalled();
  });

  it('previewProxyStatus=failed → degraded (C3)', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [mat({ id: 'v1', type: 'video', previewProxyStatus: 'failed' })],
        opts({ ids: ['v1'], onPatch, cache, client }),
      ),
    );
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('v1', expect.objectContaining({ localProxyStatus: 'degraded' })),
    );
    expect((cache as any).getOrDownload).not.toHaveBeenCalled();
  });

  it('remote audio without cacheUrl is routed through buildProxyUrl (same-origin)', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    renderHook(() =>
      useLocalMaterialDownload(
        [mat({ id: 'a1', type: 'audio', url: 'https://cdn.example.com/a.mp3' })],
        opts({ ids: ['a1'], onPatch, cache, client }),
      ),
    );
    await waitFor(() => expect((cache as any).getOrDownload).toHaveBeenCalled());
    expect((client as any).buildProxyUrl).toHaveBeenCalledWith('https://cdn.example.com/a.mp3');
  });

  it('removing a material from the timeline revokes its blob', async () => {
    const onPatch = vi.fn();
    const cache = makeCache();
    const client = makeClient();
    const vmat = mat({
      id: 'v1',
      type: 'video',
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/x/480p.mp4',
    });
    const { rerender } = renderHook(
      ({ ids }) =>
        useLocalMaterialDownload([vmat], opts({ ids, onPatch, cache, client })),
      { initialProps: { ids: ['v1'] } },
    );
    await waitFor(() => expect((cache as any).getOrDownload).toHaveBeenCalled());
    rerender({ ids: [] });
    await waitFor(() => expect((cache as any).revoke).toHaveBeenCalledWith('v1'));
  });

  it('degrades after the transcode timeout elapses (C3)', () => {
    vi.useFakeTimers();
    try {
      const onPatch = vi.fn();
      const cache = makeCache();
      const client = makeClient();
      renderHook(() =>
        useLocalMaterialDownload(
          [mat({ id: 'v1', type: 'video', previewProxyStatus: 'queued' })],
          opts({ ids: ['v1'], onPatch, cache, client }),
        ),
      );
      expect(onPatch).toHaveBeenCalledWith('v1', expect.objectContaining({ localProxyStatus: 'transcoding' }));
      act(() => {
        vi.advanceTimersByTime(60_001);
      });
      expect(onPatch).toHaveBeenCalledWith('v1', expect.objectContaining({ localProxyStatus: 'degraded' }));
    } finally {
      vi.useRealTimers();
    }
  });
});
