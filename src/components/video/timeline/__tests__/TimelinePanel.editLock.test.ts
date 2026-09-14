/**
 * @vitest-environment node
 *
 * TimelinePanel — edit-lock coverage for call sites that mutate slices
 * directly or start edits outside the action layer (S9 / TL2-19 / RV-03),
 * plus drag-safety of keyboard shortcuts (TL2-17 / TL2-18).
 *
 * Source-level like TimelinePanel.lockGuards.test.ts: `jsx: "preserve"` keeps
 * Vitest from compiling the panel. The store-level refusals are pinned by the
 * store action tests; these assertions pin the UI call sites.
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

/** First statement inside a `useCallback((...) => { ... })` body. */
function firstStatement(body: string): string {
  const open = body.indexOf('=> {');
  return body.slice(open + 4).trim().split('\n')[0].trim();
}

const LOCK_CHECK = 'if (isEditLocked(useTimelineStore.getState())) {';

describe('TimelinePanel direct slice mutations check the edit lock', () => {
  it('copying clips is refused while locked and records no history', () => {
    const body = sliceBetween('const handleCopy = useCallback(', 'const handleOrganizeMaterials = useCallback(');
    expect(firstStatement(body)).toBe(LOCK_CHECK);
    expect(body.indexOf('isEditLocked(')).toBeLessThan(body.indexOf('recordAction('));
    expect(body.indexOf('isEditLocked(')).toBeLessThan(body.indexOf('importFromData('));
  });

  it('organize materials is refused while locked', () => {
    const body = sliceBetween('const handleOrganizeMaterials = useCallback(', '// Camera motion');
    expect(firstStatement(body)).toBe(LOCK_CHECK);
    expect(body.indexOf('isEditLocked(')).toBeLessThan(body.indexOf('recordAction('));
    expect(body.indexOf('isEditLocked(')).toBeLessThan(body.indexOf('autoOrganize()'));
  });
});

describe('TimelinePanel edit entry points check the edit lock', () => {
  it('adding materials and tracks is refused while locked', () => {
    const drop = sliceBetween('const handleMaterialDrop = useCallback(', 'const handleMaterialDropById = useCallback(');
    expect(drop.indexOf('isEditLocked(state)')).toBeGreaterThanOrEqual(0);
    expect(drop.indexOf('isEditLocked(state)')).toBeLessThan(drop.indexOf('addItemAction('));

    const batch = sliceBetween('const handleAddMaterialsToTimeline = useCallback(', 'useEffect(');
    expect(batch).toContain(LOCK_CHECK);
    const addTrack = sliceBetween('const handleAddTrack = useCallback(', 'Toolbar action handlers');
    expect(firstStatement(addTrack)).toBe(LOCK_CHECK);
  });

  it('a JSON import is refused while locked, before and after its request', () => {
    const body = sliceBetween('const handleImportJSON = useCallback(', 'Subtitle editing (modal state)');
    expect(firstStatement(body)).toBe(LOCK_CHECK);
    const request = body.indexOf("'/api/timeline-import'");
    const write = body.indexOf('replaceTimelineAction(');
    const recheck = body.indexOf('isEditLocked(', request);
    expect(recheck).toBeGreaterThan(request);
    expect(recheck).toBeLessThan(write);
  });

  it('the subtitle dialog save goes through getSubtitleCommitBlocker and reports refusal', () => {
    const body = sliceBetween('const handleSaveSubtitleChanges = useCallback(', 'const memoizedSubtitles = useMemo(');
    expect(body.indexOf('getSubtitleCommitBlocker(')).toBeLessThan(body.indexOf('replaceTimelineAction('));
    expect(body).toMatch(/showSubtitleCommitBlocker\(blocker\);\s*return false;/);
    expect(panelSrc).toMatch(/isEditLocked=\{externalEditLock !== null\}/);
  });

  it('the cut tool falls back to select when the agent takes the timeline', () => {
    const body = sliceBetween('useEffect(() => useTimelineStore.subscribe(', '// Material drop handler');
    expect(body).toMatch(/\(state\) => state\.externalEditLock/);
    expect(body).toMatch(/if \(store\.activeTool === 'cut'\) store\.setActiveTool\('select'\)/);
  });
});

describe('TimelinePanel drag safety', () => {
  it('mutating shortcuts are ignored while a drag is in flight', () => {
    expect(panelSrc).toMatch(/if \(store\.isInteracting && MUTATING_TIMELINE_SHORTCUTS\.has\(shortcut\)\) \{\s*e\.preventDefault\(\);\s*return;/);
  });

  it('pointer moves carry a vertical delta so a straight drag to another lane starts a move', () => {
    expect(panelSrc).toMatch(/dragStartYRef\.current = snapshot\.context\?\.pointerDownPosition\?\.y \?\? 0/);
    expect(panelSrc).toMatch(/deltaY: e\.clientY - dragStartYRef\.current/);
  });

  it('material drops resolve the id against the library', () => {
    const body = sliceBetween('const handleMaterialDropById = useCallback(', 'Programmatic material add');
    expect(body).toMatch(/showError\(t\.timeline\.messages\.materialNotFound\)/);
    expect(body).toMatch(/handleMaterialDrop\(material, trackId\)/);
    expect(panelSrc).toMatch(/onMaterialDrop=\{handleMaterialDropById\}/);
  });
});
