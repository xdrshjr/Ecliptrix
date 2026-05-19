/**
 * useRemoteMaterialPrefetch — phase-3 preview-proxy branch (spec §3.2.1 / G8 / INV4).
 *
 * Smoke coverage for the diff-detection + heuristic + watch path. The
 * legacy cache-status flow remains covered by the sibling test file;
 * these cases focus on the new preview-proxy branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteMaterialPrefetch } from '../useRemoteMaterialPrefetch';
import type { MaterialItem } from '@/types';
import { MediaProxyClient } from '../../timeline/infrastructure/MediaProxyClient';

vi.mock('@/lib/playbackFlags', () => ({
  isPlaybackV2Enabled: () => true,
}));

function makeMaterial(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'mid-1',
    name: 'v.mp4',
    type: 'video',
    format: 'mp4',
    size: 1024,
    url: 'https://cdn/v.mp4',
    createdAt: new Date(),
    ...over,
  } as MaterialItem;
}

let fetchImpl: ReturnType<typeof vi.fn>;
let client: MediaProxyClient;

beforeEach(() => {
  fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data: {
          task_id: 'pp',
          material_id: 'mid-1',
          status: 'cached',
          preview_proxy_url: '/api/storage/files/preview-proxies/mid-1/480p.mp4',
        },
      }),
    ),
  );
  client = new MediaProxyClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useRemoteMaterialPrefetch — phase-3 preview-proxy branch', () => {
  it('does not call requestPreviewProxy when timelineReferencedMaterialIds is unset', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    renderHook(() =>
      useRemoteMaterialPrefetch(
        [makeMaterial({ bytes: 100 * 1024 * 1024 })],
        () => {},
        { mediaProxyClient: client, onPatchPreviewProxy: onPatchPP },
      ),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('triggers preview-proxy when material newly enters timeline AND H1 (bytes>50MB) matches', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ bytes: 100 * 1024 * 1024 })],
          () => {},
          {
            mediaProxyClient: client,
            onPatchPreviewProxy: onPatchPP,
            timelineReferencedMaterialIds: refs,
          },
        ),
      { initialProps: { refs: new Set<string>() } },
    );
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy).toHaveBeenCalledWith('mid-1');
  });

  it('skips preview-proxy when bytes/bitrate/source heuristics all miss', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ bytes: 1024 * 1024, metadata: { source: 'upload' } })],
          () => {},
          {
            mediaProxyClient: client,
            onPatchPreviewProxy: onPatchPP,
            timelineReferencedMaterialIds: refs,
          },
        ),
      { initialProps: { refs: new Set<string>() } },
    );
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('H3 source=ark triggers preview-proxy', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ metadata: { source: 'ark' } })],
          () => {},
          {
            mediaProxyClient: client,
            onPatchPreviewProxy: onPatchPP,
            timelineReferencedMaterialIds: refs,
          },
        ),
      { initialProps: { refs: new Set<string>() } },
    );
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy).toHaveBeenCalled();
  });

  it('skips preview-proxy when previewProxyStatus already cached', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [
            makeMaterial({
              bytes: 100 * 1024 * 1024,
              previewProxyStatus: 'cached',
              previewProxyLocalUrl: '/api/storage/x',
            }),
          ],
          () => {},
          {
            mediaProxyClient: client,
            onPatchPreviewProxy: onPatchPP,
            timelineReferencedMaterialIds: refs,
          },
        ),
      { initialProps: { refs: new Set<string>() } },
    );
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('in-flight Set deduplicates re-renders with the same refs (diff detection)', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi
      .spyOn(client, 'requestPreviewProxy')
      .mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ bytes: 100 * 1024 * 1024 })],
          () => {},
          {
            mediaProxyClient: client,
            onPatchPreviewProxy: onPatchPP,
            timelineReferencedMaterialIds: refs,
          },
        ),
      { initialProps: { refs: new Set<string>() } },
    );
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 0));
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy.mock.calls.length).toBe(1);
  });

  it('cached short-circuit hydrates store via onPatchPreviewProxy', async () => {
    const onPatchPP = vi.fn();
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ bytes: 100 * 1024 * 1024 })],
          () => {},
          {
            mediaProxyClient: client,
            onPatchPreviewProxy: onPatchPP,
            timelineReferencedMaterialIds: refs,
          },
        ),
      { initialProps: { refs: new Set<string>() } },
    );
    rerender({ refs: new Set<string>(['mid-1']) });
    await new Promise((r) => setTimeout(r, 50));
    expect(onPatchPP).toHaveBeenCalled();
    const lastCall = onPatchPP.mock.calls[onPatchPP.mock.calls.length - 1];
    expect(lastCall[0]).toBe('mid-1');
    expect(lastCall[1].previewProxyStatus).toBe('cached');
  });

  it('preloadSequenceWindow runs when videoCache + playbackWindow supplied', async () => {
    const cacheStub: any = {
      preloadSequenceWindow: vi.fn().mockResolvedValue(undefined),
    };
    renderHook(() =>
      useRemoteMaterialPrefetch([makeMaterial()], () => {}, {
        videoCache: cacheStub,
        playbackWindow: [{ materialId: 'mid-1', url: '/api/storage/x' }],
      }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(cacheStub.preloadSequenceWindow).toHaveBeenCalled();
  });
});
