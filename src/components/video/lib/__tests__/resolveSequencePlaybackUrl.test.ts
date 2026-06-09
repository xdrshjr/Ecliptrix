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
  it('(a) all three URLs present → localStorageUrl primary, [serverUrl, url] fallbacks', () => {
    const material = makeMaterial({
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    const seq = makeSeq({ url: 'https://cdn.example.com/v.mp4' });
    const result = resolveSequencePlaybackUrl(seq, [material]);
    expect(result).not.toBeNull();
    expect(result!.source).toBe('localStorageUrl');
    expect(result!.url.startsWith(window.location.origin)).toBe(true);
    expect(result!.url).toContain('cached_materials');
    expect(result!.fallbacks).toEqual([
      'https://cdn.example.com/v.mp4',
      'https://x.example.com/v.mp4',
    ]);
  });

  it('prefers same-origin material.url before legacy remote serverUrl', () => {
    const material = makeMaterial({
      url: '/api/storage/files/video/local.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
    });
    const seq = makeSeq({ url: 'https://cdn.example.com/v.mp4' });
    const result = resolveSequencePlaybackUrl(seq, [material]);

    expect(result).not.toBeNull();
    expect(result!.source).toBe('localStorageUrl');
    expect(result!.url).toBe(`${window.location.origin}/api/storage/files/video/local.mp4`);
    expect(result!.fallbacks).toEqual([
      'https://cdn.example.com/v.mp4',
      '/api/storage/files/video/local.mp4',
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
    expect(result!.source).toBe('localStorageUrl');
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

  // -- preview-proxy tier (C1) ------------------------------------------

  it('(pp1) cached + preferPreviewProxy → 480p primary, original chain demoted to fallbacks', () => {
    const material = makeMaterial({
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/mat-1/480p.mp4',
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material], {
      preferPreviewProxy: true,
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('previewProxy');
    expect(result!.url).toBe(
      window.location.origin +
        '/api/storage/files/preview-proxies/mat-1/480p.mp4',
    );
    // Original ladder is preserved as ordered fallbacks.
    expect(result!.fallbacks).toEqual([
      window.location.origin + '/api/storage/files/cached_materials/pexels/1.mp4',
      'https://cdn.example.com/v.mp4',
      'https://x.example.com/v.mp4',
    ]);
  });

  it('(pp2) cached but preferPreviewProxy=false → local storage primary', () => {
    const material = makeMaterial({
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/mat-1/480p.mp4',
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
    });
    const seq = makeSeq({});
    const withFlagOff = resolveSequencePlaybackUrl(seq, [material], {
      preferPreviewProxy: false,
    });
    const noOpts = resolveSequencePlaybackUrl(seq, [material]);
    expect(withFlagOff).toEqual(noOpts);
    expect(withFlagOff!.source).toBe('localStorageUrl');
    expect(withFlagOff!.url).toContain('cached_materials');
  });

  it('(pp3) not-yet-cached (queued) + preferPreviewProxy → unchanged legacy chain', () => {
    const material = makeMaterial({
      previewProxyStatus: 'queued',
      previewProxyLocalUrl: undefined,
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material], {
      preferPreviewProxy: true,
    });
    expect(result!.source).toBe('localStorageUrl');
    expect(result!.url).toContain('cached_materials');
  });

  it('(pp4) cached but no local proxy url → falls through to cacheUrl (no OSS mirror)', () => {
    const material = makeMaterial({
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: undefined,
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material], {
      preferPreviewProxy: true,
    });
    expect(result!.source).toBe('localStorageUrl');
    expect(result!.url).toContain('cached_materials');
  });

  // -- local blob tier (round-2, C2/C3/R6) ------------------------------

  it('(lp1) ready + preferLocalProxy → blob primary (P0), original chain demoted', () => {
    const material = makeMaterial({
      localProxyStatus: 'ready',
      localProxyUrl: 'blob:http://localhost/abc-123',
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material], {
      preferLocalProxy: true,
    });
    expect(result).not.toBeNull();
    expect(result!.source).toBe('localProxy');
    expect(result!.url).toBe('blob:http://localhost/abc-123');
    expect(result!.fallbacks).toEqual([
      window.location.origin + '/api/storage/files/cached_materials/pexels/1.mp4',
      'https://cdn.example.com/v.mp4',
      'https://x.example.com/v.mp4',
    ]);
  });

  it('(lp2) ready but preferLocalProxy=false → byte-identical to legacy (no blob)', () => {
    const material = makeMaterial({
      localProxyStatus: 'ready',
      localProxyUrl: 'blob:http://localhost/abc-123',
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
    });
    const seq = makeSeq({});
    const withFlagOff = resolveSequencePlaybackUrl(seq, [material], {
      preferLocalProxy: false,
    });
    const noOpts = resolveSequencePlaybackUrl(seq, [material]);
    expect(withFlagOff).toEqual(noOpts);
    expect(withFlagOff!.source).toBe('localStorageUrl');
  });

  it('(lp3) not-yet-ready (downloading/degraded) + preferLocalProxy → unchanged legacy chain', () => {
    const downloading = makeMaterial({
      localProxyStatus: 'downloading',
      localProxyUrl: undefined,
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
    });
    const degraded = makeMaterial({
      localProxyStatus: 'degraded',
      localProxyUrl: undefined,
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
    });
    const seq = makeSeq({});
    expect(
      resolveSequencePlaybackUrl(seq, [downloading], { preferLocalProxy: true })!.source,
    ).toBe('localStorageUrl');
    expect(
      resolveSequencePlaybackUrl(seq, [degraded], { preferLocalProxy: true })!.source,
    ).toBe('localStorageUrl');
  });

  it('(lp4) blob ranks ABOVE preview-proxy: ready + cached proxy → blob primary, proxy demoted', () => {
    const material = makeMaterial({
      localProxyStatus: 'ready',
      localProxyUrl: 'blob:http://localhost/local-blob',
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/mat-1/480p.mp4',
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material], {
      preferLocalProxy: true,
      preferPreviewProxy: true,
    });
    expect(result!.source).toBe('localProxy');
    expect(result!.url).toBe('blob:http://localhost/local-blob');
    // The 480p proxy is the first fallback, then the original cache.
    expect(result!.fallbacks[0]).toBe(
      window.location.origin + '/api/storage/files/preview-proxies/mat-1/480p.mp4',
    );
    expect(result!.fallbacks).toContain(
      window.location.origin + '/api/storage/files/cached_materials/pexels/1.mp4',
    );
  });
  it('direct local material prefers local storage before stale preview-proxy fields', () => {
    const material = makeMaterial({
      url: '/api/storage/files/video/local.mp4',
      serverUrl: '/api/storage/files/video/local.mp4',
      cacheUrl: '/api/storage/files/video/local.mp4',
      storageKey: 'video/local.mp4',
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/mat-1/480p.mp4',
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: '/api/storage/files/video/local.mp4',
      },
    });
    const seq = makeSeq({});
    const result = resolveSequencePlaybackUrl(seq, [material], {
      preferPreviewProxy: true,
      preferLocalProxy: true,
    });

    expect(result).not.toBeNull();
    expect(result!.source).toBe('localStorageUrl');
    expect(result!.url).toBe(
      window.location.origin + '/api/storage/files/video/local.mp4',
    );
    expect(result!.fallbacks).not.toContain(
      window.location.origin + '/api/storage/files/preview-proxies/mat-1/480p.mp4',
    );
  });
});
