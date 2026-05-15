/**
 * @vitest-environment node
 *
 * VideoPlayerPanel — feature-flag branch (spec 01 §五 / §八).
 *
 * Like sibling tests in this folder we assert at the **source level** instead
 * of mounting React: the project's tsconfig keeps `jsx: "preserve"` which
 * the dormant Vitest pipeline cannot compile. See playheadResume.test.tsx
 * for the same pattern.
 *
 * We verify:
 *  - VideoPlayerPanel imports `isPlaybackV2Enabled` from `@/lib/playbackFlags`.
 *  - The flag is locked with `useMemo(..., [])` at mount — spec 01 §5.1.
 *  - A `PlaybackEngine` instance is allocated only on the v2 branch.
 *  - The new module barrel exists at `src/components/video/playback/index.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(__dirname, '..', 'VideoPlayerPanel.tsx');
const src = readFileSync(FILE, 'utf-8');

describe('VideoPlayerPanel — playback v2 feature flag', () => {
  it('imports isPlaybackV2Enabled from @/lib/playbackFlags', () => {
    expect(src).toMatch(/import\s*\{\s*isPlaybackV2Enabled\s*\}\s*from\s*['"]@\/lib\/playbackFlags['"]/);
  });

  it('imports PlaybackEngine from the new playback module', () => {
    expect(src).toMatch(/import\s*\{\s*PlaybackEngine\s*\}\s*from\s*['"]\.\.\/\.\.\/playback['"]/);
  });

  it('locks the flag with useMemo(..., []) at mount per spec 01 §5.1', () => {
    expect(src).toMatch(/playbackV2Enabled\s*=\s*useMemo\(\s*\(\)\s*=>\s*isPlaybackV2Enabled\(\)\s*,\s*\[\s*\]\s*\)/);
  });

  it('only allocates a PlaybackEngine when the flag is enabled', () => {
    expect(src).toMatch(/if\s*\(\s*playbackV2Enabled\s*&&\s*!playbackEngineRef\.current\s*\)/);
    expect(src).toMatch(/new\s+PlaybackEngine\(\)/);
  });
});

describe('Playback v2 module scaffold', () => {
  const playbackRoot = resolve(__dirname, '..', '..', '..', 'playback');

  it('exposes the v2 barrel at src/components/video/playback/index.ts', () => {
    expect(existsSync(resolve(playbackRoot, 'index.ts'))).toBe(true);
  });

  it('ships every module listed in spec 01 §3.1', () => {
    for (const name of [
      'types.ts',
      'PlaybackEngine.ts',
      'PlaybackClock.ts',
      'AbBufferController.ts',
      'CanvasCompositor.ts',
      'PlayheadController.ts',
    ]) {
      expect(existsSync(resolve(playbackRoot, name))).toBe(true);
    }
  });

  it('exports the documented public API from the barrel', () => {
    const barrel = readFileSync(resolve(playbackRoot, 'index.ts'), 'utf-8');
    for (const name of [
      'PlaybackEngine',
      'PlaybackClock',
      'PlayheadController',
      'AbBufferController',
      'CanvasCompositor',
    ]) {
      expect(barrel).toMatch(new RegExp(`export\\s*\\{\\s*${name}`));
    }
  });
});
