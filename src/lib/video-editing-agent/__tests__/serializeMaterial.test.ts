/**
 * AG2-12 / AG2-16: material payloads the agent sees or copies onto clips
 * carry no inline media, but keep every playback field a clip needs.
 */
import { describe, it, expect, vi } from 'vitest';
import type { MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { serializeMaterial, toAgentClipMaterial } from '../tools';
import { createAddToTrackTool } from '../tools/addToTrack';

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

  it('add_clip snapshot carries serverUrl, cacheUrl, storageKey', async () => {
    const updateTimeline = vi.fn();
    const context: ToolContext = {
      timelineState: {
        currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
        tracks: [{
          id: 'v1', name: 'Video', type: 'video', height: 80, isLocked: false, isMuted: false,
          isVisible: true, volume: 100, order: 0, items: [],
        }],
        playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 1, scrollLeft: 0,
      },
      materials: [material({
        serverUrl: '/api/storage/files/video/clip.mp4',
        cacheUrl: '/api/storage/files/cached_materials/pexels/clip.mp4',
        storageKey: 'video/clip.mp4',
      })],
      apiBaseUrl: 'http://127.0.0.1:3000',
      operations: new Map(),
      updateTimeline,
      recordOperation: vi.fn(),
      turnState: {}, callBudget: { used: 0 },
    };

    await createAddToTrackTool(context).execute('tc-1', { materialId: 'm1', trackId: 'v1' });

    expect(updateTimeline.mock.calls[0][1].material).toEqual({
      id: 'm1',
      name: 'clip.mp4',
      type: 'video',
      url: '/api/storage/files/video/clip.mp4',
      serverUrl: '/api/storage/files/video/clip.mp4',
      cacheUrl: '/api/storage/files/cached_materials/pexels/clip.mp4',
      storageKey: 'video/clip.mp4',
    });
  });
});
