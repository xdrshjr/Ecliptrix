/**
 * selectPlaybackUrl + effectivePreviewUrl — phase-3 P1–P5 coverage.
 */

import { describe, it, expect } from 'vitest';
import { selectPlaybackUrl, effectivePreviewUrl } from '../selectPlaybackUrl';

describe('selectPlaybackUrl phase-3 P1–P5', () => {
  it('P1: prefers same-origin previewProxyLocalUrl when status=cached and preferPreviewProxy=true', () => {
    const url = selectPlaybackUrl(
      {
        previewProxyStatus: 'cached',
        previewProxyLocalUrl: '/api/storage/files/preview-proxies/abc/480p.mp4',
        cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
        url: 'https://cdn/v.mp4',
      },
      { preferPreviewProxy: true },
    );
    expect(url).toContain('preview-proxies');
    expect(url.startsWith(window.location.origin)).toBe(true);
  });

  it('P2: falls back to OSS previewProxyOssUrl when local missing', () => {
    const url = selectPlaybackUrl(
      {
        previewProxyStatus: 'cached',
        previewProxyOssUrl: 'https://oss/preview/abc.mp4',
        url: 'https://cdn/v.mp4',
      },
      { preferPreviewProxy: true },
    );
    expect(url).toBe('https://oss/preview/abc.mp4');
  });

  it('P3: same-origin cacheUrl wins when preview-proxy not cached', () => {
    const url = selectPlaybackUrl(
      {
        previewProxyStatus: 'queued',
        cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
        url: 'https://cdn/v.mp4',
      },
      { preferPreviewProxy: true },
    );
    expect(url).toContain('cached_materials');
  });

  it('P4: media-proxy wraps remote URL when previewFallback=proxy', () => {
    const url = selectPlaybackUrl(
      {
        url: 'https://cdn/v.mp4',
      },
      { preferPreviewProxy: true, previewFallback: 'proxy' },
    );
    expect(url).toContain('/api/media/proxy?u=');
    expect(url).toContain(encodeURIComponent('https://cdn/v.mp4'));
  });

  it('P5: previewFallback=origin returns raw remote URL', () => {
    const url = selectPlaybackUrl(
      {
        url: 'https://cdn/v.mp4',
      },
      { preferPreviewProxy: true, previewFallback: 'origin' },
    );
    expect(url).toBe('https://cdn/v.mp4');
  });

  it('export ALWAYS ignores preview-proxy fields (INV3)', () => {
    const url = selectPlaybackUrl(
      {
        previewProxyStatus: 'cached',
        previewProxyLocalUrl: '/api/storage/files/preview-proxies/abc/480p.mp4',
        previewProxyOssUrl: 'https://oss/preview/abc.mp4',
        cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
        serverUrl: 'https://cdn/v.mp4',
        url: 'https://x/v.mp4',
      },
      { purpose: 'export', preferPreviewProxy: true },
    );
    expect(url).toBe('https://cdn/v.mp4');
  });

  it('preview_proxy_status=failed degrades to P3 (cache) automatically', () => {
    const url = selectPlaybackUrl(
      {
        previewProxyStatus: 'failed',
        previewProxyLocalUrl: '/api/storage/files/preview-proxies/abc/480p.mp4',
        cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
        url: 'https://cdn/v.mp4',
      },
      { preferPreviewProxy: true },
    );
    expect(url).toContain('cached_materials');
  });

  it('default opts (no preferPreviewProxy) preserve pre-phase-3 behavior', () => {
    // Should ignore preview-proxy fields, ignore proxy fallback — same as legacy.
    const url = selectPlaybackUrl({
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/abc/480p.mp4',
      url: 'https://cdn/v.mp4',
    });
    expect(url).toBe('https://cdn/v.mp4');
  });

  it('effectivePreviewUrl alias enables proxy fallback by default', () => {
    const url = effectivePreviewUrl({ url: 'https://cdn/v.mp4' });
    expect(url).toContain('/api/media/proxy?u=');
  });

  it('effectivePreviewUrl honors fallback=origin override', () => {
    const url = effectivePreviewUrl({ url: 'https://cdn/v.mp4' }, { fallback: 'origin' });
    expect(url).toBe('https://cdn/v.mp4');
  });
});
