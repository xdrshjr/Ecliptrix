import { describe, it, expect } from 'vitest';
import { selectPlaybackUrl, toAbsolutePlaybackUrl } from '../selectPlaybackUrl';

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
    expect(url).toBe(`${window.location.origin}/api/storage/files/cached_materials/pexels/1.mp4`);
  });

  it('export prefers a same-origin url before remote serverUrl', () => {
    const url = selectPlaybackUrl(
      {
        serverUrl: 'https://cdn.example.com/v.mp4',
        url: '/api/storage/files/video/local.mp4',
      },
      { purpose: 'export' },
    );
    expect(url).toBe(`${window.location.origin}/api/storage/files/video/local.mp4`);
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
