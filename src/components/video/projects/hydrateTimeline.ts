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
 *
 * Why hydration must run BEFORE `setContent`: setContent triggers the
 * VideoEditingInterface → TimelinePanel mount path. TimelinePanel inspects
 * `useTimelineStore.getState().tracks.length === 0` to decide whether to
 * seed five default empty tracks. If the store is empty when the panel
 * mounts, those defaults are emitted upward and autosave eagerly persists
 * an empty timeline — overwriting whatever the user saved last session.
 */

import { useTimelineStore } from '@/components/video/timeline/store';
import type { TimelineData } from '@/components/video/timeline/domain/types';

/**
 * Empty `TimelineData` used when the persisted payload is missing or
 * structurally invalid. Mirrors the slice's DEFAULT_INITIAL_DATA so the
 * store's derived fields land on the same defaults as a fresh page load.
 */
const EMPTY_TIMELINE_DATA: TimelineData = {
  currentTime: 0,
  totalDuration: 0,
  zoomLevel: 1.0,
  playbackRate: 1.0,
  isPlaying: false,
  snapToGrid: true,
  gridSize: 0.5,
  scrollLeft: 0,
  tracks: [],
};

function hasTracksArray(value: unknown): value is { tracks: unknown[] } & Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { tracks?: unknown }).tracks)
  );
}

/**
 * Hydrate the timeline store from `record.project_data`. Idempotent — safe
 * to call multiple times, including under React StrictMode double-effect.
 */
export function hydrateTimelineFromProjectData(
  projectData: Record<string, unknown> | undefined,
): void {
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
    try {
      store.importFromData(rest as unknown as TimelineData);
      store.clearHistory();
      store.deselectAll();
      return;
    } catch (err) {
      // TimelineAggregate.fromPlainObject can throw on malformed item data
      // (e.g. NaN durations). Fall through to the empty-state branch so the
      // editor still opens — better an empty timeline than a crash loop.
      console.warn(
        '[hydrateTimeline] importFromData threw; falling back to empty store',
        { err, keys: Object.keys(persisted) },
      );
    }
  } else if (persisted !== undefined) {
    // `persisted` could be `null` (legitimate JSON value) or a non-object
    // primitive — guard `Object.keys` against those before logging, otherwise
    // the defensive helper itself throws and the editor never opens.
    const keys =
      persisted !== null && typeof persisted === 'object'
        ? Object.keys(persisted as object)
        : [];
    console.warn(
      '[hydrateTimeline] persisted timeline shape invalid; using defaults',
      { type: persisted === null ? 'null' : typeof persisted, keys },
    );
  }

  // Fresh project, missing uiState, or invalid schema. Reset to empty tracks.
  // TimelinePanel's mount effect detects `tracks.length === 0` and seeds the
  // five default tracks — but only for *this* project, because we've cleared
  // any state inherited from a previous A → B switch.
  store.importFromData(EMPTY_TIMELINE_DATA);
  store.clearHistory();
  store.deselectAll();
}
