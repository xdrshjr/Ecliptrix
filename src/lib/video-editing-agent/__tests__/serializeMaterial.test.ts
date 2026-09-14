/**
 * AG2-12 / AG2-16: material payloads the agent sees or copies onto clips
 * carry no inline media, but keep every playback field a clip needs.
 */
import { describe, it, expect } from 'vitest';
import type { MaterialItem } from '@/types';
import { serializeMaterial, toAgentClipMaterial } from '../tools';

function material(extra: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'm1', name: 'clip.mp4', type: 'video', format: 'mp4', size: 1,
    url: '/api/storage/files/video/clip.mp4', createdAt: new Date(0), duration: 4,
    ...extra,
  };
}

describe('agent material payloads', () => {
  it('serializeMaterial omits inline data thumbnails', () => {
    const serialized = serializeMaterial(material({ thumbnailUrl: 'data:image/jpeg;base64,/9j/4AAQ' }));
    expect(serialized).not.toHaveProperty('thumbnailUrl');
  });

  it('serializeMaterial keeps a regular thumbnail url', () => {
    const serialized = serializeMaterial(material({ thumbnailUrl: '/api/storage/files/images/clip.jpg' }));
    expect(serialized.thumbnailUrl).toBe('/api/storage/files/images/clip.jpg');
  });

  it('toAgentClipMaterial snapshots playback fields without inline thumbnails', () => {
    const snapshot = toAgentClipMaterial(material({
      thumbnailUrl: 'blob:http://localhost/1',
      serverUrl: '/api/storage/files/video/clip.mp4',
      cacheUrl: '/api/storage/files/video/clip.mp4',
      storageKey: 'video/clip.mp4',
      localProxyUrl: 'blob:http://localhost/2',
      metadata: { storageKind: 'local', storageKey: 'video/clip.mp4', fileName: 'clip.mp4' },
    }));

    expect(snapshot).toEqual({
      id: 'm1',
      name: 'clip.mp4',
      type: 'video',
      url: '/api/storage/files/video/clip.mp4',
      serverUrl: '/api/storage/files/video/clip.mp4',
      cacheUrl: '/api/storage/files/video/clip.mp4',
      storageKey: 'video/clip.mp4',
      metadata: { storageKind: 'local', storageKey: 'video/clip.mp4' },
    });
  });
});
