/**
 * @vitest-environment node
 *
 * Track — material drag-and-drop from the materials panel (ME-10) and locked
 * lane interaction (TL2-23).
 *
 * Source-level like the sibling TimelinePanel / TimelineItem tests: tsconfig
 * keeps JSX as `preserve`, so the lane is not rendered here. The decisions
 * live in pure helpers with their own unit tests (`lib/materialDragTypes`,
 * `lib/trackForMaterial`); these assertions pin that the lane uses them.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const trackSrc = readFileSync(resolve(__dirname, '..', 'Track.tsx'), 'utf-8');

function functionBody(startMarker: string, endMarker: string): string {
  const start = trackSrc.indexOf(startMarker);
  const end = trackSrc.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return trackSrc.slice(start, end);
}

describe('Track material drag-and-drop', () => {
  it('track dragover uses readDraggedMaterialType', () => {
    const body = functionBody('const evaluateMaterialDrag = ', 'const handleDragLeave = ');
    expect(body).toMatch(/readDraggedMaterialType\(Array\.from\(e\.dataTransfer\.types\)\)/);
    // getData() is always empty during dragenter / dragover.
    expect(body).not.toMatch(/getData\(/);
    expect(body).toMatch(/isTrackCompatibleWithMaterial\(track, materialType\)/);
    expect(body).toMatch(/dropEffect = 'none'/);
    expect(trackSrc).toMatch(/onDragEnter=\{evaluateMaterialDrag\}/);
    expect(trackSrc).toMatch(/onDragOver=\{evaluateMaterialDrag\}/);
  });

  it('track drop routes through onMaterialDrop', () => {
    const body = functionBody('const handleDrop = ', '// Track control handlers');
    expect(body).toMatch(/onMaterialDrop\(dropped\.id, trackId\)/);
    expect(trackSrc).not.toMatch(/dropMaterial/);
  });

  it('explains a refused drop on locked and incompatible lanes', () => {
    expect(trackSrc).toMatch(/track\.isLocked \? t\.timeline\.track\.trackLocked : t\.timeline\.messages\.incompatibleTrack/);
  });

  it('dragleave ignores moves onto the lane\'s own clips', () => {
    const body = functionBody('const handleDragLeave = ', 'const handleDrop = ');
    expect(body).toMatch(/e\.currentTarget\.contains\(next\)/);
  });

  it('locked lanes keep pointer events', () => {
    expect(trackSrc).not.toMatch(/pointerEvents:\s*track\.isLocked/);
  });
});

describe('Track header edits', () => {
  it('a lane removal refused by the agent edit lock says why', () => {
    const body = functionBody('const handleRemoveTrackClick = ', 'showConfirm(');
    expect(body).toMatch(
      /result\.reason === 'EDIT_LOCKED'\) \{\s*showWarning\(t\.timeline\.messages\.editLockedByAgent\);\s*return;/,
    );
  });
});
