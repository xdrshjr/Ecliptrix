/**
 * @vitest-environment node
 *
 * TimelinePanel — a camera-motion apply or a material drop that the store
 * refuses tells the user why instead of silently doing nothing (S13).
 *
 * Source-level like TimelinePanel.editLock.test.ts: `jsx: "preserve"` keeps
 * Vitest from compiling the panel. The refusals themselves are pinned by
 * setCameraMotion.lock.test.ts and materialDrop.unknownDuration.test.ts;
 * these assertions pin the UI call sites that report them.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelSrc = readFileSync(resolve(__dirname, '..', 'TimelinePanel.tsx'), 'utf-8');

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = panelSrc.indexOf(startMarker);
  const end = panelSrc.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return panelSrc.slice(start, end);
}

describe('TimelinePanel explains refused edits', () => {
  it('a camera motion refused after its track was locked shows a warning', () => {
    const body = sliceBetween(
      'const handleApplyCameraMotion = useCallback(',
      'const handleAddEffect = useCallback(',
    );
    expect(body).toContain('if (setCameraMotionAction(');
    expect(body).toContain('t.timeline.cameraMotion.disabledTrackLocked');
    expect(body).toContain('t.timeline.messages.editLockedByAgent');
  });

  it('a drop whose target track was removed during the probe shows a warning', () => {
    const body = sliceBetween('void dropMaterialWithDuration(', 'if (outcome.durationFallback)');
    expect(body).toMatch(/outcome\.reason === 'track-missing'\) showWarning\(/);
  });
});
