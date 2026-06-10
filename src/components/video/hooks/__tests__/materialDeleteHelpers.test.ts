/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import type { MaterialItem } from '@/types';
import {
  sourcePathForDelete,
  extraThumbnailKeysForDelete,
  generateUUID,
} from '../materialManagement/materialDeleteHelpers';

function makeMaterial(overrides: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'mat-1',
    name: 'clip.mp4',
    type: 'video',
    format: 'mp4',
    size: 1,
    url: '',
    createdAt: new Date(),
    ...overrides,
  } as MaterialItem;
}

describe('sourcePathForDelete', () => {
  it('returns undefined for a missing material', () => {
    expect(sourcePathForDelete(undefined)).toBeUndefined();
  });

  it('returns the top-level storageKey for a direct upload', () => {
    const m = makeMaterial({ storageKey: 'video/clip.mp4' });
    expect(sourcePathForDelete(m)).toBe('video/clip.mp4');
  });

  it('falls back to metadata.storageKey when top-level is absent', () => {
    const m = makeMaterial({ metadata: { storageKey: 'video/meta.mp4' } });
    expect(sourcePathForDelete(m)).toBe('video/meta.mp4');
  });

  it('returns undefined for cached_remote materials (shared source must not be deleted)', () => {
    const m = makeMaterial({
      storageKey: 'video/clip.mp4',
      metadata: { storageKind: 'cached_remote' },
    });
    expect(sourcePathForDelete(m)).toBeUndefined();
  });

  it('returns undefined for legacy_remote materials', () => {
    const m = makeMaterial({
      storageKey: 'video/clip.mp4',
      metadata: { storageKind: 'legacy_remote' },
    });
    expect(sourcePathForDelete(m)).toBeUndefined();
  });

  it('returns undefined when no storage key is present', () => {
    expect(sourcePathForDelete(makeMaterial({}))).toBeUndefined();
  });
});

describe('extraThumbnailKeysForDelete', () => {
  it('returns the stored-file stem when it differs from the material id', () => {
    const m = makeMaterial({ id: 'mat-1', storageKey: 'video/clip.mp4' });
    expect(extraThumbnailKeysForDelete(m)).toEqual(['clip']);
  });

  it('handles backslash-separated keys', () => {
    const m = makeMaterial({ id: 'mat-1', storageKey: 'video\\clip.mp4' });
    expect(extraThumbnailKeysForDelete(m)).toEqual(['clip']);
  });

  it('returns an empty list when the stem equals the material id', () => {
    const m = makeMaterial({ id: 'clip', storageKey: 'video/clip.mp4' });
    expect(extraThumbnailKeysForDelete(m)).toEqual([]);
  });

  it('returns an empty list when there is no deletable source path', () => {
    const m = makeMaterial({ metadata: { storageKind: 'cached_remote' } });
    expect(extraThumbnailKeysForDelete(m)).toEqual([]);
  });
});

describe('generateUUID', () => {
  it('produces a v4 UUID shape', () => {
    expect(generateUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces distinct values across calls', () => {
    expect(generateUUID()).not.toBe(generateUUID());
  });
});
