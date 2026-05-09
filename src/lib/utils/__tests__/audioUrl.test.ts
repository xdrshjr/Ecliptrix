/**
 * Tests for selectAudioPlaybackUrl (iter5 Bug#1).
 *
 * Covers the priority chain:
 *   localCache → serverUrl → metadata.originalUrl → non-blob material.url → null
 *
 * Plus the metadata-key compat (fileName / server_file_name).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MaterialItem } from '@/types';

// Mock the LocalAudioManager singleton so we can control the local-cache
// branch deterministically.
vi.mock('@/lib/utils/localAudioManager', () => {
  const cache = new Map<string, string>();
  return {
    default: {
      getAudioFileUrl: vi.fn((name: string) => cache.get(name) ?? null),
      __set: (name: string, url: string) => cache.set(name, url),
      __clear: () => cache.clear(),
    },
  };
});

import localAudioManager from '@/lib/utils/localAudioManager';
import { selectAudioPlaybackUrl } from '../audioUrl';

const baseMaterial = (overrides: Partial<MaterialItem> = {}): MaterialItem => ({
  id: 'm1',
  name: 'segment 1',
  type: 'audio',
  format: 'mp3',
  size: 1024,
  url: 'https://example.com/server.mp3',
  createdAt: new Date(),
  ...overrides,
});

describe('selectAudioPlaybackUrl', () => {
  beforeEach(() => {
    (localAudioManager as unknown as { __clear: () => void }).__clear();
  });

  it('returns local blob when LocalAudioManager has the file (fileName key)', () => {
    (localAudioManager as unknown as { __set: (a: string, b: string) => void })
      .__set('seg1.mp3', 'blob:http://localhost/abc');
    const m = baseMaterial({
      url: 'https://example.com/server.mp3',
      metadata: { fileName: 'seg1.mp3' },
    });
    expect(selectAudioPlaybackUrl(m)).toBe('blob:http://localhost/abc');
  });

  it('honours legacy server_file_name when fileName is absent', () => {
    (localAudioManager as unknown as { __set: (a: string, b: string) => void })
      .__set('legacy.mp3', 'blob:http://localhost/legacy');
    const m = baseMaterial({
      url: 'https://example.com/server.mp3',
      metadata: { server_file_name: 'legacy.mp3' },
    });
    expect(selectAudioPlaybackUrl(m)).toBe('blob:http://localhost/legacy');
  });

  it('falls through to serverUrl when local cache misses', () => {
    const m = baseMaterial({
      url: 'blob:http://localhost/dead',
      serverUrl: 'https://cdn.example.com/seg.mp3',
      metadata: { fileName: 'never-cached.mp3' },
    });
    expect(selectAudioPlaybackUrl(m)).toBe('https://cdn.example.com/seg.mp3');
  });

  it('falls through to metadata.originalUrl when serverUrl missing', () => {
    const m = baseMaterial({
      url: 'blob:http://localhost/dead',
      metadata: { originalUrl: 'https://origin.example.com/seg.mp3' },
    });
    expect(selectAudioPlaybackUrl(m)).toBe('https://origin.example.com/seg.mp3');
  });

  it('returns http url when material.url is not blob', () => {
    const m = baseMaterial({
      url: 'https://example.com/seg.mp3',
    });
    expect(selectAudioPlaybackUrl(m)).toBe('https://example.com/seg.mp3');
  });

  it('returns null when only a dead blob: URL is available', () => {
    const m = baseMaterial({
      url: 'blob:http://localhost/dead',
      serverUrl: undefined,
      metadata: { fileName: 'gone.mp3' },
    });
    expect(selectAudioPlaybackUrl(m)).toBeNull();
  });
});
