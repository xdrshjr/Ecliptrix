import { describe, expect, it } from 'vitest';
import type { MaterialItem } from '@/types';
import {
  buildDerivedMaterial,
  isDerivedMaterial,
  repairDerivedMaterialIdentity,
  repairInheritedSegmentMembership,
  SCRIPT_SEGMENT_METADATA_FIELDS,
  storageKeyFromLocalUrl,
  withoutScriptSegment,
} from '../derivedMaterial';
import { selectPlaybackUrl } from '../selectPlaybackUrl';
import { sourcePathForDelete } from '../../hooks/materialManagement/materialDeleteHelpers';

const ORIGINAL_URL = '/api/storage/files/video/orig.mp4';
const PROCESSED_URL = '/api/storage/files/video/orig_sr.mp4';

function localUpload(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'orig',
    name: 'orig.mp4',
    type: 'video',
    format: 'mp4',
    size: 10,
    duration: 60,
    url: ORIGINAL_URL,
    serverUrl: ORIGINAL_URL,
    cacheUrl: ORIGINAL_URL,
    storageKey: 'video/orig.mp4',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    metadata: {
      storageKind: 'local',
      storageKey: 'video/orig.mp4',
      localResolvedUrl: ORIGINAL_URL,
      isLocalFile: true,
      fileName: 'orig.mp4',
    },
    ...overrides,
  };
}

function silenceRemoved(original: MaterialItem, url = PROCESSED_URL): MaterialItem {
  return buildDerivedMaterial(
    original,
    { url, duration: 40 },
    {
      id: 'orig_sr',
      name: 'orig_静音移除.mp4',
      metadata: { ...original.metadata, isSilenceRemoved: true, originalMaterialId: original.id },
    },
  );
}

describe('buildDerivedMaterial', () => {
  it('silence-removed material resolves preview and export to the processed file', () => {
    const derived = silenceRemoved(localUpload());

    expect(selectPlaybackUrl(derived, { purpose: 'export' })).toBe(PROCESSED_URL);
    expect(selectPlaybackUrl(derived, { purpose: 'preview' })).toContain(PROCESSED_URL);
    expect(derived.duration).toBe(40);
    expect(derived.metadata?.derivedFrom).toBe('orig');
    expect(derived.metadata?.fileName).toBe('orig.mp4');
  });

  it('derived material deletes only its own storage key', () => {
    const derived = silenceRemoved(localUpload());

    expect(derived.storageKey).toBe('video/orig_sr.mp4');
    expect(derived.metadata?.storageKey).toBe('video/orig_sr.mp4');
    expect(sourcePathForDelete(derived)).toBe('video/orig_sr.mp4');
  });

  it('remote processed url keeps no storage key', () => {
    const derived = silenceRemoved(localUpload(), 'https://cdn.example.com/processed.mp4');

    expect(derived.storageKey).toBeUndefined();
    expect(derived.cacheUrl).toBeUndefined();
    expect(derived.metadata?.localResolvedUrl).toBeUndefined();
    expect(derived.metadata?.storageKind).toBeUndefined();
    expect(sourcePathForDelete(derived)).toBeUndefined();
    expect(selectPlaybackUrl(derived, { purpose: 'export' })).toBe('https://cdn.example.com/processed.mp4');
  });

  it('never inherits local proxy or preview proxy fields', () => {
    const derived = silenceRemoved(localUpload({
      localProxyUrl: 'blob:http://localhost/abc',
      localProxyStatus: 'ready' as MaterialItem['localProxyStatus'],
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/orig.mp4',
    }));

    expect(derived.localProxyUrl).toBeUndefined();
    expect(derived.localProxyStatus).toBeUndefined();
    expect(derived.previewProxyStatus).toBeUndefined();
    expect(derived.previewProxyLocalUrl).toBeUndefined();
  });
});

describe('storageKeyFromLocalUrl', () => {
  it('accepts a loopback absolute prefix and rejects cached_materials and remote urls', () => {
    expect(storageKeyFromLocalUrl('http://127.0.0.1:3000/api/storage/files/video/a%20b.mp4')).toBe('video/a b.mp4');
    expect(storageKeyFromLocalUrl('/api/storage/files/cached_materials/pexels/1.mp4')).toBeUndefined();
    expect(storageKeyFromLocalUrl('https://cdn.example.com/api/storage/files/video/x.mp4')).toBeUndefined();
  });
});

describe('repairDerivedMaterialIdentity', () => {
  it('repair rebuilds a saved derived material whose localResolvedUrl points at the original', () => {
    const original = localUpload();
    const savedBroken: MaterialItem = {
      ...original,
      id: 'orig_sr',
      url: PROCESSED_URL,
      serverUrl: PROCESSED_URL,
      metadata: { ...original.metadata, isSilenceRemoved: true },
    };

    const { materials, repairedIds } = repairDerivedMaterialIdentity([original, savedBroken]);

    expect(repairedIds).toEqual(['orig_sr']);
    expect(materials[1].cacheUrl).toBe(PROCESSED_URL);
    expect(materials[1].storageKey).toBe('video/orig_sr.mp4');
    expect(materials[1].createdAt).toBe(savedBroken.createdAt);
    expect(selectPlaybackUrl(materials[1], { purpose: 'export' })).toBe(PROCESSED_URL);
    expect(repairDerivedMaterialIdentity(materials).repairedIds).toEqual([]);
  });

  it('repair drops an original storageKey a saved clip inherited through metadata', () => {
    const clipUrl = '/api/storage/files/video/clips/orig_clip_1.mp4';
    const savedClip: MaterialItem = {
      ...localUpload(),
      id: 'orig_clip_1',
      url: clipUrl,
      serverUrl: clipUrl,
      cacheUrl: clipUrl,
      storageKey: undefined,
      metadata: {
        storageKind: 'local',
        storageKey: 'video/orig.mp4',
        localResolvedUrl: clipUrl,
        isClip: true,
      },
    };

    const { materials, repairedIds } = repairDerivedMaterialIdentity([savedClip]);

    expect(repairedIds).toEqual(['orig_clip_1']);
    expect(sourcePathForDelete(materials[0])).toBe('video/clips/orig_clip_1.mp4');
  });

  it('repair leaves non-derived materials untouched', () => {
    const original = localUpload();
    const { materials, repairedIds } = repairDerivedMaterialIdentity([original]);

    expect(repairedIds).toEqual([]);
    expect(materials[0]).toBe(original);
    expect(isDerivedMaterial(original)).toBe(false);
  });

  it("repair keeps a derived material's own cached_materials copy", () => {
    const cacheUrl = '/api/storage/files/cached_materials/ark/task-1.mp4';
    const remoteResult: MaterialItem = {
      ...localUpload(),
      id: 'wm',
      url: 'https://cdn.example.com/wm.mp4',
      serverUrl: 'https://cdn.example.com/wm.mp4',
      cacheUrl,
      storageKey: undefined,
      metadata: { isWatermarkRemoved: true, storageKind: 'cached_remote' },
    };

    const { materials, repairedIds } = repairDerivedMaterialIdentity([remoteResult]);

    expect(repairedIds).toEqual([]);
    expect(materials[0].cacheUrl).toBe(cacheUrl);
  });
});

describe('repairInheritedSegmentMembership (N-13)', () => {
  const scriptOriginal = localUpload({
    metadata: {
      ...localUpload().metadata,
      segment_id: 'segment-1',
      segment_number: 1,
      segment_assigned_at: Date.parse('2026-09-01T08:00:00.000Z'),
      video_index_in_segment: 1,
    },
  });

  /** A clip saved before placeholders dropped the original's segment fields. */
  function savedClip(metadata: Record<string, unknown> = {}): MaterialItem {
    return {
      ...localUpload(),
      id: 'orig_clip_c1',
      url: '/api/storage/files/video/clips/orig_clip_c1.mp4',
      // Persisted materials come back with an ISO string, not a Date.
      createdAt: '2026-09-02T00:00:00.000Z' as unknown as Date,
      metadata: { ...scriptOriginal.metadata, isClip: true, originalMaterialId: 'orig', ...metadata },
    };
  }

  const segmentFields = (material: MaterialItem) =>
    SCRIPT_SEGMENT_METADATA_FIELDS.filter((field) => field in (material.metadata ?? {}));

  it('strips segment membership a clip inherited at cut time', () => {
    const { materials, repairedIds } = repairInheritedSegmentMembership([scriptOriginal, savedClip()]);

    expect({
      repairedIds,
      clipFields: segmentFields(materials[1]),
      originalUntouched: materials[0] === scriptOriginal,
      again: repairInheritedSegmentMembership(materials).repairedIds,
    }).toEqual({ repairedIds: ['orig_clip_c1'], clipFields: [], originalUntouched: true, again: [] });
  });

  it('keeps segment membership assigned after the cut', () => {
    const matchedLater = savedClip({
      segment_id: 'segment-2',
      segment_number: 2,
      segment_assigned_at: Date.parse('2026-09-03T00:00:00.000Z'),
    });

    const { materials, repairedIds } = repairInheritedSegmentMembership([scriptOriginal, matchedLater]);

    expect({ repairedIds, same: materials[1] === matchedLater }).toEqual({ repairedIds: [], same: true });
  });

  it('strips an unstamped clip whose original belongs to the same segment', () => {
    const { segment_assigned_at: _stamp, ...unstamped } = savedClip().metadata ?? {};
    void _stamp;
    const legacy = { ...savedClip(), metadata: unstamped };

    expect(repairInheritedSegmentMembership([scriptOriginal, legacy]).repairedIds).toEqual(['orig_clip_c1']);
  });
});

describe('withoutScriptSegment', () => {
  it('drops only the script segment fields', () => {
    expect(withoutScriptSegment({ segment_id: 's', segment_text_hash: 'h', fileName: 'a.mp4' }))
      .toEqual({ fileName: 'a.mp4' });
    expect(withoutScriptSegment(undefined)).toEqual({});
  });
});
