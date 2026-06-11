/**
 * @vitest-environment node
 *
 * MaterialThumbnail — structural surface (local-upload-video-thumbnail-fix
 * §3.2 B, file change plan #8).
 *
 * The project's `jsx: "preserve"` tsconfig keeps Vitest (esbuild) from
 * compiling .tsx for mounting, so — like the sibling FramePackView.test.tsx
 * and TimelineItem.filmstrip.test.tsx — we assert the fallback-chain wiring at
 * the SOURCE level: the card must self-heal through
 *   poster → client re-extract (video) → placeholder icon,
 * and must NEVER render a broken <img>.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'MaterialThumbnail.tsx'), 'utf-8');

describe('MaterialThumbnail structural surface', () => {
  it('seeds the <img> src from material.thumbnailUrl', () => {
    expect(src).toMatch(/useState<string \| undefined>\(material\.thumbnailUrl\)/);
    expect(src).toMatch(/<img/);
    expect(src).toMatch(/src=\{src\}/);
  });

  it('on <img> error re-extracts a client frame for VIDEO materials only', () => {
    expect(src).toMatch(/import \{ extractVideoThumbnail \}/);
    expect(src).toMatch(/material\.type === 'video'/);
    expect(src).toMatch(/await extractVideoThumbnail\(material\.url\)/);
  });

  it('guards the client re-extraction to a single attempt', () => {
    expect(src).toMatch(/retriedRef/);
    expect(src).toMatch(/retriedRef\.current = true/);
  });

  it('falls back to the placeholder icon, never a broken <img>', () => {
    expect(src).toMatch(/setFailed\(true\)/);
    expect(src).toMatch(/if \(!src \|\| failed\)/);
    expect(src).toMatch(/PlaceholderIcon/);
  });

  it('keeps onLoad/onError diagnostics', () => {
    expect(src).toMatch(/onLoad=/);
    expect(src).toMatch(/onError=\{handleError\}/);
    expect(src).toMatch(/logger\.debug|console\.error/);
  });

  it('preserves the audio/image/subtitle placeholder glyph branches', () => {
    expect(src).toMatch(/type === 'audio'/);
    expect(src).toMatch(/type === 'image'/);
    expect(src).toMatch(/type === 'subtitle'/);
  });
});
