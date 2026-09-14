/**
 * @vitest-environment node
 *
 * Recovery backup: hydration wiring (source-level — rendering the container
 * pulls in the whole editor) and the restore / discard behaviour behind the
 * editor's backup banner (N-07), exercised against the real timeline store.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TimelineItemData, TrackData } from '@/components/video/timeline/domain/types';
import { useTimelineStore } from '@/components/video/timeline/store';
import type { VideoEditingTaskContent } from '@/types';
import {
  restoreTimelineBackup,
  withCurrentRecoveryBackup,
  withoutTimelineRecoveryBackup,
} from '../hydrateTimeline';

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

  it('the backup banner restores and discards only after a confirmation dialog', () => {
    expect(src).toMatch(/content\?\.timelineRecoveryBackup/);
    expect(src).toMatch(/restoreTimelineBackup\(/);
    expect(src).toMatch(/withoutTimelineRecoveryBackup\(/);
    expect(src).toMatch(/<ConfirmationDialog/);
  });

  it('editor content updates keep the backup the container holds', () => {
    expect(src).toMatch(/setContent\(\(current\) => withCurrentRecoveryBackup\(current, next\)\)/);
  });

  it('a restore that skipped nothing does not mention skipped clips', () => {
    expect(src).toMatch(/skippedCount > 0[\s\S]{0,160}backupRestored\.replace[\s\S]{0,80}backupRestoredAll/);
  });
});

function clip(id: string, startTime: number, overrides: Partial<TimelineItemData> = {}): TimelineItemData {
  return {
    id, name: id, type: 'video', startTime, duration: 5, trackId: 'video-track-1',
    color: '#4A90D9', clipStart: 0, clipEnd: 5, ...overrides,
  };
}

function lane(items: TimelineItemData[]): TrackData {
  return {
    id: 'video-track-1', name: 'Video 1', type: 'video', height: 80, isLocked: false,
    isMuted: false, isVisible: true, volume: 100, order: 0, items,
  };
}

const VIEW = {
  currentTime: 0, totalDuration: 5, zoomLevel: 1, playbackRate: 1, isPlaying: false,
  snapToGrid: true, gridSize: 0.5, scrollLeft: 0,
};

const itemIds = () => useTimelineStore.getState().tracks.flatMap((track) => track.items.map((item) => item.id));
const getStore = () => useTimelineStore.getState();

beforeEach(() => {
  const store = getStore();
  store.setExternalEditLock(null);
  store.importFromData({ ...VIEW, tracks: [lane([clip('current', 0)])] });
  store.clearHistory();
});

afterEach(() => {
  getStore().setExternalEditLock(null);
  vi.restoreAllMocks();
});

describe('timeline recovery backup (N-07)', () => {
  it('restoring the backup replaces the timeline as one undoable step', () => {
    const backup = {
      savedAt: '2026-09-14T10:00:00.000Z',
      data: { ...VIEW, tracks: [lane([clip('backed-up', -2), clip('unbuildable', 5, { originalDuration: Number.POSITIVE_INFINITY })])] },
    };

    const outcome = restoreTimelineBackup(getStore, backup);

    expect({ outcome, ids: itemIds() }).toEqual({ outcome: { kind: 'restored', skippedCount: 1 }, ids: ['backed-up'] });
    getStore().undo();
    expect(itemIds()).toEqual(['current']);
  });

  it('restoring is refused while the agent holds the edit lock', () => {
    getStore().setExternalEditLock('agent');

    const outcome = restoreTimelineBackup(getStore, { savedAt: '', data: { ...VIEW, tracks: [lane([clip('b', 0)])] } });

    expect({ outcome, ids: itemIds() }).toEqual({ outcome: { kind: 'edit-locked' }, ids: ['current'] });
  });

  it('a backup that still cannot be read changes nothing', () => {
    const outcome = restoreTimelineBackup(getStore, { savedAt: '', data: { tracks: 'broken' } });

    expect({ outcome, ids: itemIds(), canUndo: getStore().canUndo })
      .toEqual({ outcome: { kind: 'unreadable' }, ids: ['current'], canUndo: false });
  });

  it('discarding the backup removes it from project data', () => {
    const content = {
      markdownContent: '',
      lastModified: new Date('2026-09-14T10:00:00.000Z'),
      materials: [],
      timelineRecoveryBackup: { savedAt: '2026-09-14T10:00:00.000Z', data: {} },
    } as VideoEditingTaskContent;

    const next = withoutTimelineRecoveryBackup(content);

    expect({ hasBackup: 'timelineRecoveryBackup' in next, materials: next.materials === content.materials })
      .toEqual({ hasBackup: false, materials: true });
  });

  it('an editor update built before the discard cannot bring the backup back', () => {
    const backup = { savedAt: '2026-09-14T10:00:00.000Z', data: {} };
    const discarded = { markdownContent: '', lastModified: new Date(0), materials: [] } as VideoEditingTaskContent;
    const staleUpdate = { ...discarded, markdownContent: 'edited', timelineRecoveryBackup: backup };

    const next = withCurrentRecoveryBackup(discarded, staleUpdate);

    expect({ hasBackup: 'timelineRecoveryBackup' in next, markdown: next.markdownContent })
      .toEqual({ hasBackup: false, markdown: 'edited' });
  });

  it('an editor update keeps the backup the container still holds', () => {
    const backup = { savedAt: '2026-09-14T10:00:00.000Z', data: {} };
    const current = { markdownContent: '', lastModified: new Date(0), timelineRecoveryBackup: backup } as VideoEditingTaskContent;
    const update = { ...current, markdownContent: 'edited' };

    expect(withCurrentRecoveryBackup(current, update)).toBe(update);
  });
});
