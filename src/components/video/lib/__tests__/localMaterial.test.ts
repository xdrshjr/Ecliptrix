import { describe, expect, it } from 'vitest';
import type { MaterialItem } from '@/types';
import {
  canPreviewDirectLocalMaterial,
  createLocalMaterialFromUpload,
  isDirectLocalMaterial,
} from '../localMaterial';

function material(patch: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'mat-1',
    name: 'clip.mp4',
    type: 'video',
    format: 'mp4',
    size: 100,
    url: '',
    createdAt: new Date(),
    ...patch,
  } as MaterialItem;
}

describe('local material classification', () => {
  it('treats local upload metadata as direct local', () => {
    const local = material({
      url: '/api/storage/files/video/clip.mp4',
      serverUrl: '/api/storage/files/video/clip.mp4',
      cacheUrl: '/api/storage/files/video/clip.mp4',
      storageKey: 'video/clip.mp4',
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: '/api/storage/files/video/clip.mp4',
      },
    });

    expect(isDirectLocalMaterial(local)).toBe(true);
    expect(canPreviewDirectLocalMaterial(local)).toBe(true);
  });

  it('does not treat cached remote storage paths as direct local', () => {
    const cachedRemote = material({
      url: 'https://videos.pexels.com/clip.mp4',
      serverUrl: 'https://videos.pexels.com/clip.mp4',
      cacheUrl: '/api/storage/files/cached_materials/pexels/123.mp4',
      metadata: { storageKind: 'cached_remote', source: 'pexels' },
    });

    expect(isDirectLocalMaterial(cachedRemote)).toBe(false);
    expect(canPreviewDirectLocalMaterial(cachedRemote)).toBe(false);
  });

  it('does not classify legacy remote, blob-only, or empty placeholders', () => {
    expect(isDirectLocalMaterial(material({
      url: 'https://cdn.example.com/clip.mp4',
      metadata: { storageKind: 'legacy_remote' },
    }))).toBe(false);
    expect(isDirectLocalMaterial(material({ url: 'blob:http://localhost/x' }))).toBe(false);
    expect(isDirectLocalMaterial(material({ url: '' }))).toBe(false);
  });

  it('does not mark local provenance as preview-ready without a storage URL', () => {
    const staleLocal = material({
      url: 'https://cdn.example.com/clip.mp4',
      serverUrl: 'https://cdn.example.com/clip.mp4',
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: '',
      },
    });

    expect(isDirectLocalMaterial(staleLocal)).toBe(true);
    expect(canPreviewDirectLocalMaterial(staleLocal)).toBe(false);
  });
});

describe('createLocalMaterialFromUpload', () => {
  it('preserves the existing placeholder id and writes local metadata', () => {
    const existing = material({
      id: 'upload-stable-id',
      uploadStatus: 'uploading',
      uploadProgress: 40,
    });
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    const result = {
      success: true,
      video_url: '/api/storage/files/video/clip.mp4',
      thumbnail_url: '/api/storage/files/video/clip.jpg',
      file_size: 1234,
      duration: 12,
      width: 1920,
      height: 1080,
      metadata: { storage_key: 'video/clip.mp4' },
    };

    const local = createLocalMaterialFromUpload(existing, file, result);

    expect(local.id).toBe('upload-stable-id');
    expect(local.uploadStatus).toBe('completed');
    expect(local.url).toBe('/api/storage/files/video/clip.mp4');
    expect(local.serverUrl).toBe('/api/storage/files/video/clip.mp4');
    expect(local.cacheUrl).toBe('/api/storage/files/video/clip.mp4');
    expect(local.storageKey).toBe('video/clip.mp4');
    expect(local.metadata).toEqual(expect.objectContaining({
      storageKind: 'local',
      isLocalFile: true,
      localResolvedUrl: '/api/storage/files/video/clip.mp4',
      storageKey: 'video/clip.mp4',
    }));
  });

  it('rejects upload results without a playable storage URL', () => {
    const existing = material({
      id: 'upload-stable-id',
      uploadStatus: 'uploading',
      uploadProgress: 40,
    });
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

    expect(() =>
      createLocalMaterialFromUpload(existing, file, {
        success: true,
        video_url: '',
        metadata: { storage_key: 'video/clip.mp4' },
      }),
    ).toThrow(/local storage url/i);
  });

  it('rejects cached remote storage paths for direct local uploads', () => {
    const existing = material({ id: 'upload-stable-id' });
    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

    expect(() =>
      createLocalMaterialFromUpload(existing, file, {
        success: true,
        video_url: '/api/storage/files/cached_materials/pexels/clip.mp4',
        metadata: { storage_key: 'cached_materials/pexels/clip.mp4' },
      }),
    ).toThrow(/direct local/i);
  });
});
