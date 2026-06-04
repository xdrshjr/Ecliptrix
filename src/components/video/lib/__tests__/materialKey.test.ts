import { describe, it, expect } from 'vitest';
import { materialCompositeKey, hashUrl } from '../materialKey';

describe('materialCompositeKey', () => {
  it('keeps full-segment search materials on the (source, sourceId) key', () => {
    const key = materialCompositeKey({
      url: 'https://cdn.pexels.com/v/123.mp4',
      metadata: { source: 'pexels', sourceId: '123' },
    });
    expect(key).toEqual({ source: 'pexels', source_id: '123' });
  });

  it('gives sibling clips DISTINCT keys even when they share source/sourceId', () => {
    // Two clips cut from the same Pexels video X: same source/sourceId inherited
    // from the parent, but each is a different physical file/URL. They MUST NOT
    // collapse onto one cache row (regression: video-export-uses-deleted-clip-material).
    const clip1 = materialCompositeKey({
      url: 'https://cdn.example.com/clips/X_clip1.mp4',
      metadata: { source: 'pexels', sourceId: 'X', isClip: true, originalMaterialId: 'mat-X' },
    });
    const clip2 = materialCompositeKey({
      url: 'https://cdn.example.com/clips/X_clip2.mp4',
      metadata: { source: 'pexels', sourceId: 'X', isClip: true, originalMaterialId: 'mat-X' },
    });
    expect(clip1).not.toEqual(clip2);
    expect(clip1.source).toBe('url');
    expect(clip2.source).toBe('url');
    expect(clip1.source_id).toBe(hashUrl('https://cdn.example.com/clips/X_clip1.mp4'));
    expect(clip2.source_id).toBe(hashUrl('https://cdn.example.com/clips/X_clip2.mp4'));
  });

  it('treats originalMaterialId alone (no isClip flag) as derived → url key', () => {
    const key = materialCompositeKey({
      url: 'https://cdn.example.com/clips/Y_clip.mp4',
      metadata: { source: 'pexels', sourceId: 'Y', originalMaterialId: 'mat-Y' },
    });
    expect(key.source).toBe('url');
    expect(key.source_id).toBe(hashUrl('https://cdn.example.com/clips/Y_clip.mp4'));
  });

  it('falls back to a url key for local materials with no source', () => {
    const key = materialCompositeKey({ url: 'https://x.example.com/local.mp4' });
    expect(key).toEqual({ source: 'url', source_id: hashUrl('https://x.example.com/local.mp4') });
  });
});
