/**
 * Timeline-store hydration helper for the project editor.
 *
 * Lives outside `VideoEditorContainer.tsx` so unit tests can exercise the
 * shape-handling branches (valid persist, schema drift, fresh project) in
 * isolation, without needing to render the React tree.
 *
 * Contract:
 *  - Always leaves the singleton `useTimelineStore` in a deterministic state
 *    keyed only on the supplied `projectData` (no leakage from a prior
 *    project's session).
 *  - Logs a `console.warn` (no throw) when the persisted shape is
 *    structurally invalid; the editor must keep working.
 *  - A timeline the aggregate refuses is repaired and imported again before
 *    falling back to an empty store; the caller learns which happened so it
 *    can tell the user and back up the unreadable original (RV-01).
 *
 * Why hydration must run BEFORE `setContent`: setContent triggers the
 * VideoEditingInterface → TimelinePanel mount path. TimelinePanel inspects
 * `useTimelineStore.getState().tracks.length === 0` to decide whether to
 * seed five default empty tracks. If the store is empty when the panel
 * mounts, those defaults are emitted upward and autosave eagerly persists
 * an empty timeline — overwriting whatever the user saved last session.
 */

import { useTimelineStore } from '@/components/video/timeline/store';
import type { TimelineStore } from '@/components/video/timeline/store';
import type { TimelineData } from '@/components/video/timeline/domain/types';
import { replaceTimelineAction } from '@/components/video/timeline/store/actions/replaceTimeline';
import { isEditLocked } from '@/components/video/timeline/store/editLock';
import {
  EMPTY_TIMELINE_DATA,
  repairTimelineData,
  salvageTimelineData,
  type TimelineRepairReport,
} from './repairTimelineData';

export type HydrationResult =
  | { status: 'loaded' }
  | { status: 'repaired'; report: TimelineRepairReport }
  | { status: 'failed' };

export interface TimelineRecoveryBackup {
  savedAt: string;
  data: unknown;
}

export type RestoreBackupOutcome =
  | { kind: 'restored'; skippedCount: number }
  | { kind: 'edit-locked' }
  | { kind: 'unreadable' };

function hasTracksArray(value: unknown): value is { tracks: unknown[] } & Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { tracks?: unknown }).tracks)
  );
}

function importFresh(store: TimelineStore, data: TimelineData): void {
  store.importFromData(data);
  store.clearHistory();
  store.deselectAll();
}

function importPersistedTimeline(store: TimelineStore, data: TimelineData, keys: string[]): HydrationResult {
  try {
    importFresh(store, data);
    return { status: 'loaded' };
  } catch (err) {
    // TimelineAggregate.fromPlainObject throws on malformed item data (e.g. a
    // negative start written by an older agent). Repair what can be repaired
    // instead of opening empty, which the next autosave would persist.
    const { data: repaired, report } = repairTimelineData(data);
    if (report.clampedItemIds.length + report.droppedItemIds.length === 0) {
      console.warn('[hydrateTimeline] importFromData threw; falling back to empty store', { err, keys, status: 'failed' });
      return { status: 'failed' };
    }
    try {
      importFresh(store, repaired);
      console.warn('[hydrateTimeline] importFromData threw; imported the repaired timeline', { err, keys, status: 'repaired', report });
      return { status: 'repaired', report };
    } catch (retryErr) {
      console.warn('[hydrateTimeline] repaired timeline still threw; falling back to empty store', { err: retryErr, keys, status: 'failed' });
      return { status: 'failed' };
    }
  }
}

/**
 * Hydrate the timeline store from `record.project_data`. Idempotent — safe
 * to call multiple times, including under React StrictMode double-effect.
 *
 * `failed` means persisted timeline content existed but could not be read;
 * a fresh project, a missing uiState or a `null` timeline report `loaded`
 * because there is nothing to recover.
 */
export function hydrateTimelineFromProjectData(
  projectData: Record<string, unknown> | undefined,
): HydrationResult {
  const persisted = (projectData?.uiState as Record<string, unknown> | undefined)
    ?.currentTimelineState as Record<string, unknown> | undefined;
  const store = useTimelineStore.getState();

  if (hasTracksArray(persisted)) {
    // `selectedItems` lives in selectionSlice, not TimelineData; importFromData
    // would silently ignore it, but stripping explicitly avoids confusion if a
    // future refactor accidentally consumes it.
    const { selectedItems: _ignore, ...rest } = persisted as {
      selectedItems?: unknown;
    } & Record<string, unknown>;
    void _ignore;
    const result = importPersistedTimeline(store, rest as unknown as TimelineData, Object.keys(persisted));
    if (result.status !== 'failed') return result;
    importFresh(store, EMPTY_TIMELINE_DATA);
    return result;
  }

  const hasUnreadableContent = persisted !== undefined && persisted !== null && typeof persisted === 'object';
  if (persisted !== undefined) {
    // `persisted` could be `null` (legitimate JSON value) or a non-object
    // primitive — guard `Object.keys` against those before logging, otherwise
    // the defensive helper itself throws and the editor never opens.
    const keys = hasUnreadableContent ? Object.keys(persisted as object) : [];
    console.warn(
      '[hydrateTimeline] persisted timeline shape invalid; using defaults',
      { type: persisted === null ? 'null' : typeof persisted, keys },
    );
  }

  // Fresh project, missing uiState, or invalid schema. Reset to empty tracks.
  // TimelinePanel's mount effect detects `tracks.length === 0` and seeds the
  // five default tracks — but only for *this* project, because we've cleared
  // any state inherited from a previous A → B switch.
  importFresh(store, EMPTY_TIMELINE_DATA);
  return hasUnreadableContent ? { status: 'failed' } : { status: 'loaded' };
}

/** A repair that removed clips loses data the user may want back (DS3-01). */
function lostTimelineContent(hydration: HydrationResult): boolean {
  if (hydration.status === 'failed') return true;
  return hydration.status === 'repaired' && hydration.report.droppedItemIds.length > 0;
}

/**
 * The project data to open after hydration. When the timeline could not be
 * read, or its repair dropped clips, the ORIGINAL
 * `uiState.currentTimelineState` is copied to the top-level
 * `timelineRecoveryBackup` so the timeline the editor opens with (and then
 * autosaves) cannot erase it. Top level, because the editor rebuilds
 * `uiState` field by field and drops unknown keys. An existing backup is never
 * overwritten: the earliest original is the one worth keeping.
 */
export function withTimelineRecoveryBackup(
  projectData: Record<string, unknown>,
  hydration: HydrationResult,
  now: Date = new Date(),
): Record<string, unknown> {
  if (!lostTimelineContent(hydration) || projectData.timelineRecoveryBackup !== undefined) {
    return projectData;
  }
  const uiState = projectData.uiState as Record<string, unknown> | undefined;
  const backup: TimelineRecoveryBackup = {
    savedAt: now.toISOString(),
    data: uiState?.currentTimelineState,
  };
  return { ...projectData, timelineRecoveryBackup: backup };
}

/**
 * Replace the current timeline with what can still be read from a recovery
 * backup, as ONE undoable step (N-07). The backup itself stays in the project
 * until the user discards it.
 */
export function restoreTimelineBackup(
  getStore: () => TimelineStore,
  backup: TimelineRecoveryBackup,
): RestoreBackupOutcome {
  if (isEditLocked(getStore())) return { kind: 'edit-locked' };
  const salvaged = salvageTimelineData(backup.data);
  if (!salvaged) return { kind: 'unreadable' };
  try {
    replaceTimelineAction(getStore, salvaged.data, 'import');
  } catch (err) {
    console.warn('[hydrateTimeline] salvaged backup could not be imported', { err, savedAt: backup.savedAt });
    return { kind: 'unreadable' };
  }
  return { kind: 'restored', skippedCount: salvaged.report.droppedItemIds.length };
}

/** Project content without its recovery backup (the user discarded it). */
export function withoutTimelineRecoveryBackup<T extends { timelineRecoveryBackup?: unknown }>(content: T): T {
  const { timelineRecoveryBackup: _removed, ...rest } = content;
  void _removed;
  return rest as T;
}

/**
 * The editor's content update carrying the backup the container holds now.
 * Only the container creates (on load) or discards the backup, so an update
 * the editor built from content rendered before "discard" cannot bring it back.
 */
export function withCurrentRecoveryBackup<T extends { timelineRecoveryBackup?: TimelineRecoveryBackup }>(
  current: T | null,
  next: T,
): T {
  const held = current?.timelineRecoveryBackup;
  if (next.timelineRecoveryBackup === held) return next;
  const rest = withoutTimelineRecoveryBackup(next);
  return held === undefined ? rest : { ...rest, timelineRecoveryBackup: held };
}
