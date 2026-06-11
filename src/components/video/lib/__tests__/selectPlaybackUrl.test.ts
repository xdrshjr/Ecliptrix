import { describe, it, expect } from 'vitest';
import {
  selectPlaybackUrl,
  toAbsolutePlaybackUrl,
  stripLocalOrigin,
} from '../selectPlaybackUrl';
import type { MaterialItem } from '@/types';

describe('selectPlaybackUrl', () => {
  it('preview prefers cacheUrl and absolutises it', () => {
    const url = selectPlaybackUrl({
      cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    expect(url.startsWith(window.location.origin)).toBe(true);
    expect(url).toContain('cached_materials');
  });

  it('preview falls back to serverUrl when cacheUrl is absent', () => {
    const url = selectPlaybackUrl({
      serverUrl: 'https://cdn.example.com/v.mp4',
      url: 'https://x.example.com/v.mp4',
    });
    expect(url).toBe('https://cdn.example.com/v.mp4');
  });

  it('preview falls back to url when neither cacheUrl nor serverUrl', () => {
    const url = selectPlaybackUrl({ url: 'https://x.example.com/v.mp4' });
    expect(url).toBe('https://x.example.com/v.mp4');
  });

  it('export prefers same-origin cacheUrl as desktop local reference', () => {
    const url = selectPlaybackUrl(
      {
        cacheUrl: '/api/storage/files/cached_materials/pexels/1.mp4',
        serverUrl: 'https://cdn.example.com/v.mp4',
        url: 'https://x.example.com/v.mp4',
      },
      { purpose: 'export' },
    );
    expect(url).toBe('/api/storage/files/cached_materials/pexels/1.mp4');
  });

  it('export prefers a same-origin url before remote serverUrl', () => {
    const url = selectPlaybackUrl(
      {
        serverUrl: 'https://cdn.example.com/v.mp4',
        url: '/api/storage/files/video/local.mp4',
      },
      { purpose: 'export' },
    );
    expect(url).toBe('/api/storage/files/video/local.mp4');
  });

  it('passes through absolute http(s) cacheUrl unchanged', () => {
    const url = selectPlaybackUrl({
      cacheUrl: 'https://other.example.com/cached/v.mp4',
      url: 'https://x/v.mp4',
    });
    expect(url).toBe('https://other.example.com/cached/v.mp4');
  });

  it('passes through blob: cacheUrl unchanged', () => {
    const url = selectPlaybackUrl({
      cacheUrl: 'blob:http://localhost/abc',
      url: 'https://x/v.mp4',
    });
    expect(url).toBe('blob:http://localhost/abc');
  });

  it('returns empty string for null/undefined material', () => {
    expect(selectPlaybackUrl(null as any)).toBe('');
    expect(selectPlaybackUrl(undefined as any)).toBe('');
  });

  it('returns "" rather than throw when nothing usable', () => {
    expect(selectPlaybackUrl({})).toBe('');
  });

  it('preview prefers nested metadata.localResolvedUrl for direct local material', () => {
    const material = {
      id: 'local-1',
      name: 'local.mp4',
      type: 'video',
      format: 'mp4',
      size: 1,
      url: 'https://stale.example.com/local.mp4',
      serverUrl: 'https://stale.example.com/local.mp4',
      cacheUrl: '/api/storage/files/cached_materials/pexels/stale.mp4',
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/local-1/480p.mp4',
      createdAt: new Date(),
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: '/api/storage/files/video/local.mp4',
      },
    } as MaterialItem;

    expect(selectPlaybackUrl(material, {
      purpose: 'preview',
      preferPreviewProxy: true,
    })).toBe(`${window.location.origin}/api/storage/files/video/local.mp4`);
  });

  it('export uses direct local storage URL and excludes preview-only URLs', () => {
    const material = {
      id: 'local-1',
      name: 'local.mp4',
      type: 'video',
      format: 'mp4',
      size: 1,
      url: 'blob:http://localhost/stale',
      serverUrl: '/api/media/proxy?u=https%3A%2F%2Fcdn.example.com%2Fv.mp4',
      cacheUrl: '/api/storage/files/video/local.mp4',
      previewProxyStatus: 'cached',
      previewProxyLocalUrl: '/api/storage/files/preview-proxies/local-1/480p.mp4',
      createdAt: new Date(),
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: '/api/storage/files/video/local.mp4',
      },
    } as MaterialItem;

    const url = selectPlaybackUrl(material, { purpose: 'export' });

    expect(url).toBe('/api/storage/files/video/local.mp4');
    expect(url).not.toContain('blob:');
    expect(url).not.toContain('/api/media/proxy');
    expect(url).not.toContain('preview-proxies');
  });
});

describe('stripLocalOrigin (export invariant: no loopback absolute URL)', () => {
  it('relativises an absolute 127.0.0.1 loopback storage URL', () => {
    expect(
      stripLocalOrigin('http://127.0.0.1:18320/api/storage/files/video/local.mp4'),
    ).toBe('/api/storage/files/video/local.mp4');
  });

  it('relativises an absolute localhost loopback storage URL', () => {
    expect(
      stripLocalOrigin('http://localhost:3000/api/audio/generated/seg.mp3'),
    ).toBe('/api/audio/generated/seg.mp3');
  });

  it('relativises an IPv6 [::1] loopback storage URL', () => {
    expect(
      stripLocalOrigin('http://[::1]:18320/api/storage/files/video/local.mp4'),
    ).toBe('/api/storage/files/video/local.mp4');
  });

  it('preserves the query string when relativising', () => {
    expect(
      stripLocalOrigin('http://127.0.0.1:18320/api/storage/files/video/local.mp4?v=2'),
    ).toBe('/api/storage/files/video/local.mp4?v=2');
  });

  it('relativises a same-origin absolute URL', () => {
    expect(
      stripLocalOrigin(`${window.location.origin}/api/storage/files/video/local.mp4`),
    ).toBe('/api/storage/files/video/local.mp4');
  });

  it('passes through a remote CDN URL unchanged', () => {
    expect(stripLocalOrigin('https://cdn.example.com/v.mp4')).toBe(
      'https://cdn.example.com/v.mp4',
    );
  });

  it('passes through a loopback URL on a non-media route unchanged', () => {
    // Narrow exemption: only known local-media prefixes are relativised.
    expect(stripLocalOrigin('http://127.0.0.1:18320/admin/secret')).toBe(
      'http://127.0.0.1:18320/admin/secret',
    );
  });

  it('passes through an already-relative path unchanged', () => {
    expect(stripLocalOrigin('/api/storage/files/video/local.mp4')).toBe(
      '/api/storage/files/video/local.mp4',
    );
  });

  it('passes through blob: / empty unchanged', () => {
    expect(stripLocalOrigin('blob:http://localhost/abc')).toBe(
      'blob:http://localhost/abc',
    );
    expect(stripLocalOrigin('')).toBe('');
    expect(stripLocalOrigin(undefined)).toBe('');
  });

  it('regression: export field already absolute loopback → export returns relative', () => {
    // §3.4-a/b: a clip export / persisted project can leave an ABSOLUTE
    // loopback URL in metadata.localResolvedUrl. selectPlaybackUrl(export)
    // returns it as-is; stripLocalOrigin (applied at the export convergence
    // point) must reduce it to a relative path so the backend SSRF guard is
    // not tripped on the packaged 127.0.0.1 origin.
    const material = {
      id: 'local-1',
      name: 'local.mp4',
      type: 'video',
      format: 'mp4',
      size: 1,
      url: 'blob:http://localhost/stale',
      metadata: {
        storageKind: 'local',
        isLocalFile: true,
        localResolvedUrl: 'http://127.0.0.1:18320/api/storage/files/video/local.mp4',
      },
    } as MaterialItem;

    const exported = selectPlaybackUrl(material, { purpose: 'export' });
    expect(stripLocalOrigin(exported)).toBe('/api/storage/files/video/local.mp4');
  });
});

describe('toAbsolutePlaybackUrl', () => {
  it('absolutises a leading-slash relative URL', () => {
    expect(toAbsolutePlaybackUrl('/api/storage/files/x.mp4')).toBe(
      `${window.location.origin}/api/storage/files/x.mp4`,
    );
  });
  it('absolutises a no-slash relative URL', () => {
    expect(toAbsolutePlaybackUrl('foo.mp4')).toBe(
      `${window.location.origin}/foo.mp4`,
    );
  });
  it('passes through https://', () => {
    expect(toAbsolutePlaybackUrl('https://x/y')).toBe('https://x/y');
  });
  it('returns undefined for empty', () => {
    expect(toAbsolutePlaybackUrl('')).toBeUndefined();
    expect(toAbsolutePlaybackUrl(undefined)).toBeUndefined();
  });
});
