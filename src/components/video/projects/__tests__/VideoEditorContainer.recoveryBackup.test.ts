/**
 * @vitest-environment node
 *
 * Source-level wiring checks: rendering the container pulls in the whole
 * editor, while the behaviour itself is pinned in hydrateTimeline.repair.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(resolve(__dirname, '..', 'VideoEditorContainer.tsx'), 'utf-8');

describe('VideoEditorContainer hydration wiring', () => {
  it('backs up an unreadable timeline and repairs materials before the editor mounts', () => {
    const hydrate = src.indexOf('hydrateTimelineFromProjectData(persisted)');
    const backup = src.indexOf('withTimelineRecoveryBackup(persisted, hydration)');
    const repair = src.indexOf('repairProjectMaterials(');
    const setContent = src.indexOf('setContent(hydrated)');

    expect(hydrate).toBeGreaterThan(-1);
    expect(backup).toBeGreaterThan(hydrate);
    expect(src.indexOf('repairProjectMaterials(withTimelineRecoveryBackup')).toBeGreaterThan(-1);
    expect(repair).toBeLessThan(setContent);
    expect(backup).toBeLessThan(setContent);
  });

  it('tells the user when the timeline was repaired or could not be read', () => {
    expect(src).toMatch(/timelineRepaired\.replace\('\{count\}'/);
    expect(src).toMatch(/showError\(messages\.timelineUnreadable\)/);
  });
});
