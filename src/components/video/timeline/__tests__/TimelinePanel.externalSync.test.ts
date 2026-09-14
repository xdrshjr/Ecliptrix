/**
 * @vitest-environment node
 *
 * TimelinePanel — external timeline sync (agent operations, agent undo,
 * imports and pending timeline data) must never crash the editor and must
 * never leave the owner holding data the store refused (AG2-08 / RV-01 / RV-03).
 *
 * Source-level like TimelinePanel.lockGuards.test.ts: `jsx: "preserve"` keeps
 * Vitest from compiling the panel. `replaceTimelineAction` itself (build
 * before record, lock refusal) is covered by the store action tests.
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

const syncBody = sliceBetween('External timeline state sync', 'Global pointer event listeners for drag');

describe('TimelinePanel external timeline sync', () => {
  it('external sync catches and reports rejected timelines', () => {
    const tryIndex = syncBody.indexOf('try {');
    const replaceIndex = syncBody.indexOf('replaceTimelineAction(');
    const catchIndex = syncBody.indexOf('} catch (error) {');
    expect(tryIndex).toBeGreaterThanOrEqual(0);
    expect(tryIndex).toBeLessThan(replaceIndex);
    expect(catchIndex).toBeGreaterThan(replaceIndex);

    const catchBody = syncBody.slice(catchIndex);
    expect(catchBody).toMatch(/console\.error\('\[TimelinePanel\] external timeline update rejected', \{ reason, error \}\)/);
    expect(catchBody).toMatch(/showError\(t\.timeline\.messages\.externalUpdateRejected\)/);
  });

  it('a rejected or lock-refused external update resyncs the owner from the store', () => {
    const lockIndex = syncBody.indexOf('isEditLocked(useTimelineStore.getState()) && !isAgentReason(reason)');
    const replaceIndex = syncBody.indexOf('replaceTimelineAction(');
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(lockIndex).toBeLessThan(replaceIndex);

    const lockBranch = syncBody.slice(lockIndex, replaceIndex);
    expect(lockBranch).toMatch(/showWarning\(t\.timeline\.messages\.editLockedByAgent\)/);
    expect(lockBranch).toMatch(/resyncOwnerFromStore\(\);\s*return;/);
    expect(syncBody.slice(syncBody.indexOf('} catch (error) {'))).toMatch(/resyncOwnerFromStore\(\)/);
  });

  it('the resync reaches both owner callbacks even when the shape matches the last emit', () => {
    const resync = sliceBetween('const resyncOwnerFromStore = useCallback(', '}, [computeShapeJson]);');
    expect(resync).toMatch(/toTimelineState\(useTimelineStore\.getState\(\)\)/);
    expect(resync).toMatch(/onTimelineStateChangeRef\.current\?\.\(ts\)/);
    expect(resync).toMatch(/onTimelineCompositionChangeRef\.current\?\.\(ts\)/);
    // No early return on an identical shape: dedup must not swallow the resync.
    expect(resync).not.toMatch(/return;/);
  });

  it('only the agent and agent undo pass the edit lock', () => {
    expect(panelSrc).toMatch(/return reason === 'agent' \|\| reason === 'agent-undo';/);
  });
});
