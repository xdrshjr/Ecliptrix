/**
 * projectHydration tests (spec 06 §2.1 / §6).
 *
 * Covers load-side rehydration:
 *   - After load, an item resolves its preview URL by `materialId` against the
 *     LIVE material list (spec 02 RC-B authority) → a direct-local
 *     `/api/storage/files/...` URL → previewable.
 *   - The live direct-local URL is NOT overridden by a stale snapshot url on
 *     the item (the black-screen guard).
 *   - Materials missing a poster/waveform are reported for regeneration.
 *   - INV-3 violations are regularized once on hydrate; isPlaying forced false.
 */

import { describe, it, expect } from 'vitest';
import type { MaterialItem } from '@/types';
import type { TimelineData } from '../../timeline/domain/types';
import {
  hydrateProject,
  resolveItemPreviewUrl,
  listDerivedToRegenerate,
} from '../projectHydration';

/** A directly-previewable same-origin local material. */
function localVideoMaterial(over: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'mat-vid',
    name: 'clip.mp4',
    type: 'video',
    format: 'mp4',
    size: 1000,
    duration: 10,
    url: '/api/storage/files/video/clip.mp4',
    serverUrl: '/api/storage/files/video/clip.mp4',
    cacheUrl: '/api/storage/files/video/clip.mp4',
    thumbnailUrl: '/api/storage/files/video/poster.jpg',
    createdAt: new Date('2026-06-10'),
    storageKey: 'video/clip.mp4',
    metadata: {
      storageKind: 'local',
      isLocalFile: true,
      localResolvedUrl: '/api/storage/files/video/clip.mp4',
    },
    ...over,
  };
}

function timelineWith(itemOver: Record<string, unknown> = {}): TimelineData {
  return {
    currentTime: 0,
    totalDuration: 3,
    zoomLevel: 1,
    playbackRate: 1,
    isPlaying: true,
    snapToGrid: true,
    gridSize: 1,
    scrollLeft: 0,
    tracks: [
      {
        id: 'video-track-1',
        name: 'Video Track 1',
        type: 'video',
        height: 80,
        isLocked: false,
        isMuted: false,
        isVisible: true,
        volume: 100,
        order: 0,
        items: [
          {
            id: 'clip-1',
            name: 'clip.mp4',
            type: 'video',
            startTime: 0,
            duration: 3,
            trackId: 'video-track-1',
            color: '#111',
            materialId: 'mat-vid',
            clipStart: 0,
            clipEnd: 3,
            originalDuration: 10,
            ...itemOver,
          },
        ],
      },
    ],
  };
}

describe('projectHydration (spec 06)', () => {
  it('resolves an item preview URL to the live direct-local /api/storage/files URL', () => {
    const resolved = resolveItemPreviewUrl(
      { materialId: 'mat-vid' },
      [localVideoMaterial()],
    );
    expect(resolved).not.toBeNull();
    // URL may be absolutised by jsdom (http://localhost:3000/...) — the
    // load-bearing facts are the local storage path + the localStorageUrl source.
    expect(resolved!.url).toContain('/api/storage/files/video/clip.mp4');
    expect(resolved!.source).toBe('localStorageUrl');
  });

  it('does NOT let a stale snapshot url override the live direct-local URL (black-screen guard)', () => {
    // The item carries a stale absolute remote snapshot url; the live material
    // is a direct-local file. The resolver must still return the local URL.
    const resolved = resolveItemPreviewUrl(
      { materialId: 'mat-vid', url: 'https://cdn.example.com/old.mp4' },
      [localVideoMaterial()],
    );
    expect(resolved!.url).toContain('/api/storage/files/video/clip.mp4');
    expect(resolved!.url).not.toContain('cdn.example.com');
    expect(resolved!.source).toBe('localStorageUrl');
  });

  it('hydrates the project so every video item is previewable from a local URL', () => {
    const result = hydrateProject(timelineWith(), [localVideoMaterial()]);
    expect(result.items).toHaveLength(1);
    const hydrated = result.items[0];
    expect(hydrated.itemId).toBe('clip-1');
    expect(hydrated.preview?.url).toContain('/api/storage/files/video/clip.mp4');
    expect(hydrated.preview?.source).toBe('localStorageUrl');
    expect(hydrated.isDirectLocal).toBe(true);
  });

  it('forces isPlaying false on hydrate', () => {
    const result = hydrateProject(timelineWith(), [localVideoMaterial()]);
    expect(result.timelineData.isPlaying).toBe(false);
  });

  it('reports a missing poster/waveform material for regeneration', () => {
    // A material with NO thumbnail and the item with NO inline peaks → both
    // thumbnail and waveform should be regenerated.
    const noPoster = localVideoMaterial({ thumbnailUrl: undefined });
    const tl = timelineWith({ thumbnailUrl: undefined });
    const toRegen = listDerivedToRegenerate(tl, [noPoster]);
    expect(toRegen).toHaveLength(1);
    expect(toRegen[0].materialId).toBe('mat-vid');
    expect(toRegen[0].hasThumbnail).toBe(false);
    expect(toRegen[0].hasInlineWaveform).toBe(false);
  });

  it('does NOT request regeneration when thumbnail + inline waveform are present', () => {
    const tl = timelineWith({
      thumbnailUrl: '/api/storage/files/video/poster.jpg',
      waveformData: [0.1, 0.2],
    });
    const toRegen = listDerivedToRegenerate(tl, [localVideoMaterial()]);
    expect(toRegen).toHaveLength(0);
  });

  it('regularizes an INV-3 violation once during hydrate (duration != clipEnd-clipStart)', () => {
    // clip span is 3 (=3-0) but persisted duration says 9.
    const tl = timelineWith({ duration: 9 });
    const result = hydrateProject(tl, [localVideoMaterial()]);
    expect(result.regularizedCount).toBe(1);
    const item = result.timelineData.tracks[0].items[0];
    expect(item.duration).toBe(3);
    expect(item.startTime).toBe(0); // startTime untouched
    expect(result.items[0].regularized).toBe(true);
  });

  it('returns a null preview + non-direct-local flag when the material is missing', () => {
    const result = hydrateProject(timelineWith(), []); // no live materials
    expect(result.items[0].preview).toBeNull();
    expect(result.items[0].isDirectLocal).toBe(false);
  });
});
