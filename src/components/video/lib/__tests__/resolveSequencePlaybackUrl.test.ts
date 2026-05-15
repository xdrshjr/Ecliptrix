import { describe, it, expect } from 'vitest';
import { resolveSequencePlaybackUrl } from '../resolveSequencePlaybackUrl';
import type { MaterialItem } from '@/types';
import type { VideoSequenceItem } from '../../timeline/domain/ports';
import type { SequenceLike } from '../resolveSequencePlaybackUrl';

function makeMaterial(patch: Partial<MaterialItem>): MaterialItem {
  return {
    id: 'mat-1',
    name: 'm',
    type: 'video',
    format: 'mp4',
    size: 100,
    url: '',
    createdAt: new Date(),
    ...patch,
  } as MaterialItem;
}

function makeSeq(patch: Partial<VideoSequenceItem>): VideoSequenceItem {
  return {
    id: 'seq-1',
    name: 'Video by Test',
    url: '',
    startTime: 0,
    duration: 5,
    trackId: 't-1',
    materialId: 'mat-1',
    ...patch,
  } as VideoSequenceItem;
}

describe('resolveSequencePlaybackUrl', () => {
  it('(a) all three URLs present → cacheUrl primary, [serverUrl, url] fallbacks', () => {
    const material = makeMaterial({
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    const seq = makeSeq({ url: 'https://cdn.example.com/v.mp4' });
    const result = resolveSequencePlaybackUrl(seq, [material]);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('cacheUrl');
    expect(result!.url.startsWith(window.location.origin)).toBe(true);
    expect(result!.url).toContain('cached_materials');
    expect(result!.fallbacks).toEqual([
      'https://cdn.example.com/v.mp4',
      'https://x.example.com/v.mp4',
    ]);
  });

  it('(b) raw remote (url only) → url primary, no fallbacks, source=url', () => {
    const material = makeMaterial({
      url: 'https://cdn.pexels.com/v.mp4',
    });
    const seq = makeSeq({ url: 'https://cdn.pexels.com/v.mp4' });
    const result = resolveSequencePlaybackUrl(seq, [material]);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('url');
    expect(result!.url).toBe('https://cdn.pexels.com/v.mp4');
    expect(result!.fallbacks).toEqual([]);
  });

  it('(c) material missing → falls back to seq.url when present', () => {
    const seq = makeSeq({ url: 'https://stale.example.com/v.mp4' });
    const result = resolveSequencePlaybackUrl(seq, []);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://stale.example.com/v.mp4');
    expect(result!.source).toBe('sequence-url-fallback');
    expect(result!.fallbacks).toEqual([]);
  });

  it('(c2) material missing AND seq.url empty → null', () => {
    const seq = makeSeq({ url: '' });
    const result = resolveSequencePlaybackUrl(seq, []);
    expect(result).toBeNull();
  });

  it('(d) entire chain empty → falls back to seq.url, then null', () => {
    const material = makeMaterial({ url: '', serverUrl: '', cacheUrl: '' });
    const seqEmpty = makeSeq({ url: '' });
    expect(resolveSequencePlaybackUrl(seqEmpty, [material])).toBeNull();

    const seqHasUrl = makeSeq({ url: 'https://still.usable/v.mp4' });
    const result = resolveSequencePlaybackUrl(seqHasUrl, [material]);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('sequence-url-fallback');
    expect(result!.url).toBe('https://still.usable/v.mp4');
  });

  it('(e) cacheUrl absolute (http) → preserved as primary', () => {
    const material = makeMaterial({
      cacheUrl: 'https://other.example.com/cached/v.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material]);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://other.example.com/cached/v.mp4');
    expect(result!.source).toBe('cacheUrl');
  });

  it('returns null for null seq', () => {
    expect(resolveSequencePlaybackUrl(null, [])).toBeNull();
  });

  it('handles missing materialId by reading seq.url', () => {
    const seq = makeSeq({ materialId: undefined, url: 'https://x/v.mp4' });
    const result = resolveSequencePlaybackUrl(seq, []);
    expect(result).not.toBeNull();
    expect(result!.url).toBe('https://x/v.mp4');
    expect(result!.source).toBe('sequence-url-fallback');
  });
});
