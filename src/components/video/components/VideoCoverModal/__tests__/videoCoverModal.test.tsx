/**
 * @vitest-environment node
 *
 * VideoCoverModal — Bug #7 (preserve frame on switch to upload) + Bug #8
 * (empty-frames helper banner).
 *
 * Structural assertions because the project's Vitest config (tsconfig jsx:
 * "preserve") cannot mount React components.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(rel: string): string {
  return readFileSync(resolve(__dirname, '..', rel), 'utf-8');
}

describe('VideoCoverModal — Bug #7 source switch preserves background', () => {
  const src = readSource('VideoCoverModal.tsx');

  it('does NOT call setBackgroundUrl(null) inside handleSourceChange', () => {
    // Locate the body of handleSourceChange and assert the body does not clear
    // the background — preserving the previously-extracted frame as a "ghost"
    // behind the upload drop zone.
    const match = src.match(
      /handleSourceChange[\s\S]+?useCallback\(\(source:[\s\S]+?\}, \[\]\);/,
    );
    expect(match).not.toBeNull();
    expect(match![0]).not.toMatch(/setBackgroundUrl\(null\)/);
  });

  it('only paints the background when state.uploadedImageUrl is truthy', () => {
    // The post-switch effect must NOT unconditionally reset the background to
    // state.uploadedImageUrl ?? null (previous behavior wiped the ghost).
    expect(src).toMatch(/if\s*\(state\.uploadedImageUrl\)\s*\{[\s\S]+?setBackgroundUrl\(state\.uploadedImageUrl\)/);
    expect(src).not.toMatch(/setBackgroundUrl\(state\.uploadedImageUrl\s*\?\?\s*null\)/);
  });
});

describe('VideoCoverModal — Bug #8 empty-frames helper banner', () => {
  const src = readSource('VideoCoverModal.tsx');

  it('renders the localized noFramesAvailable message under the SourceToggle', () => {
    expect(src).toMatch(/totalVirtualDurationSec\s*<=\s*0\s*&&[\s\S]+?noFramesAvailable/);
  });
});
