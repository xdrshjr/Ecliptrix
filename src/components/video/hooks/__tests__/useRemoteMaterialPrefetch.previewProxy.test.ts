/**
 * useRemoteMaterialPrefetch — preview-proxy branch
 * (spec docs/plans/video-editor-preview-proxy-playback/spec.md §3.2.2).
 *
 * Covers the v2-decoupled trigger gate (`isPreviewProxyEnabled`), the
 * `timelineReferencedMaterialIds` diff trigger, the C3 "input resolvable"
 * eligibility convergence (+ unknown-size default-enqueue / small-file
 * exemption), and the mandatory `sourceUrl` pass-through.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRemoteMaterialPrefetch } from '../useRemoteMaterialPrefetch';
import type { MaterialItem } from '@/types';
import { MediaProxyClient } from '../../timeline/infrastructure/MediaProxyClient';

// Both flags on: v2 drives the (unused here) window prefetch, preview-proxy
// drives the trigger. The two are deliberately independent (spec §3.2.1).
vi.mock('@/lib/playbackFlags', () => ({
  isPlaybackV2Enabled: () => true,
  isPreviewProxyEnabled: () => true,
}));

function makeMaterial(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'mid-1',
    name: 'v.mp4',
    type: 'video',
    format: 'mp4',
    size: 1024,
    // Same-origin storage URL → input is resolvable (C3) by default so most
    // cases exercise the heuristic/exemption logic, not the resolvability gate.
    url: 'https://cdn/v.mp4',
    serverUrl: '/api/storage/files/video/v.mp4',
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

describe('useRemoteMaterialPrefetch — preview-proxy branch', () => {
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

  it('triggers preview-proxy with sourceUrl when material newly enters timeline AND H1 (bytes>50MB) matches', async () => {
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
    expect(requestSpy).toHaveBeenCalledWith('mid-1', {
      sourceUrl: '/api/storage/files/video/v.mp4',
    });
  });

  it('prefers cacheUrl as the sourceUrl when present', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [
            makeMaterial({
              bytes: 100 * 1024 * 1024,
              cacheUrl: '/api/storage/files/cached_materials/pexels/9.mp4',
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
    expect(requestSpy).toHaveBeenCalledWith('mid-1', {
      sourceUrl: '/api/storage/files/cached_materials/pexels/9.mp4',
    });
  });

  it('skips when input is NOT resolvable (pure remote CDN, no local copy)', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [
            makeMaterial({
              bytes: 100 * 1024 * 1024,
              url: 'https://cdn/v.mp4',
              serverUrl: 'https://cdn/v.mp4', // no same-origin reference
              cacheUrl: undefined,
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

  it('enqueues a resolvable upload with unknown size/dims (correctness-first default)', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          // No bytes, no width/height, size unknown (0) — heuristics miss but
          // input resolvable → default enqueue.
          [makeMaterial({ size: 0 })],
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

  it('skips preview-proxy for direct local uploads even when large and unknown', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [
            makeMaterial({
              id: 'local-1',
              size: 0,
              bytes: 100 * 1024 * 1024,
              url: '/api/storage/files/video/local.mp4',
              serverUrl: '/api/storage/files/video/local.mp4',
              cacheUrl: '/api/storage/files/video/local.mp4',
              storageKey: 'video/local.mp4',
              metadata: {
                storageKind: 'local',
                isLocalFile: true,
                localResolvedUrl: '/api/storage/files/video/local.mp4',
              },
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
    rerender({ refs: new Set<string>(['local-1']) });
    await new Promise((r) => setTimeout(r, 0));
    expect(requestSpy).not.toHaveBeenCalled();
  });

  it('exempts a known-small file (< 8MB) even when resolvable', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ size: 2 * 1024 * 1024 })], // 2 MB, no heuristic hit
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

  it('exempts a known low-resolution (≤480p) clip', async () => {
    const onPatchPP = vi.fn();
    const requestSpy = vi.spyOn(client, 'requestPreviewProxy');
    const { rerender } = renderHook(
      ({ refs }: { refs: Set<string> }) =>
        useRemoteMaterialPrefetch(
          [makeMaterial({ size: 50 * 1024 * 1024, width: 640, height: 360 })],
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
