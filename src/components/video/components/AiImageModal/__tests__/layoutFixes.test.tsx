/**
 * @vitest-environment node
 *
 * Layout fix structural verification tests.
 *
 * These tests read the source files directly and verify that the expected
 * layout class names are present. This approach is used because the project's
 * Vitest configuration (with tsconfig jsx: "preserve") does not support
 * mounting React components that contain JSX syntax in test files.
 *
 * Coverage:
 *   - StoryboardTab uses responsive grid and h-full overflow-hidden columns
 *   - StoryboardTab left column has pl-2 pr-1 for focus ring safe area
 *   - StoryboardScriptReview chat panel uses max-h-[28%] overflow-hidden
 *   - BasicGenerationTab left column has pl-2 pr-1 padding
 *   - CharacterModelingTab left column has pl-2 pr-1 padding
 *   - SceneModelingTab left column has pl-2 pr-1 padding
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSource(filename: string): string {
  const path = resolve(__dirname, '..', filename);
  return readFileSync(path, 'utf-8');
}

describe('StoryboardTab layout classes', () => {
  const src = readSource('StoryboardTab.tsx');

  it('uses responsive grid with md: prefix on script step container', () => {
    expect(src).toContain('h-full flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6 gap-4 min-h-0');
  });

  it('left and right columns use responsive flex/grid classes with overflow-hidden', () => {
    expect(src).toContain('flex flex-col min-h-0 flex-1 md:flex-none md:h-full overflow-hidden');
  });

  it('left column scrollable area has pl-2 pr-1 safe area', () => {
    expect(src).toContain('flex-1 min-h-0 overflow-y-auto pl-2 pr-1');
  });
});

describe('StoryboardScriptReview chat panel classes', () => {
  const src = readSource('StoryboardScriptReview.tsx');

  it('chat panel uses max-h-[28%] and outer overflow-hidden with flex layout', () => {
    expect(src).toContain('shrink-0 max-h-[28%] overflow-hidden border border-border rounded-md p-3 bg-card/60 flex flex-col gap-2');
  });

  it('no longer uses max-h-[30%] with direct overflow-y-auto on outer chat panel', () => {
    expect(src).not.toContain('max-h-[30%] overflow-y-auto border border-border rounded-md p-3 space-y-2 bg-card/60');
  });
});

describe('BasicGenerationTab focus ring safe area', () => {
  const src = readSource('BasicGenerationTab.tsx');

  it('left column has pl-2 pr-1 padding', () => {
    expect(src).toContain('flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1');
  });
});

describe('CharacterModelingTab focus ring safe area', () => {
  const src = readSource('CharacterModelingTab.tsx');

  it('left column has pl-2 pr-1 padding', () => {
    expect(src).toContain('flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1');
  });
});

describe('SceneModelingTab focus ring safe area', () => {
  const src = readSource('SceneModelingTab.tsx');

  it('left column has pl-2 pr-1 padding', () => {
    expect(src).toContain('flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1');
  });
});
