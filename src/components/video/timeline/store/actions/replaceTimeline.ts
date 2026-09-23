/**
 * replaceTimelineAction — replace the whole timeline as ONE undoable step.
 *
 * Every write that reaches the store from outside a hand edit (AI auto edit,
 * script auto-mix, agent operations and their undo, subtitle replacement,
 * JSON import) goes through here instead of `importFromData + clearHistory`,
 * so the user's own undo history survives and the external write itself can
 * be undone with Ctrl+Z.
 *
 * Opening a project is deliberately NOT routed here (projects/hydrateTimeline
 * keeps clearHistory): loading a file must not produce an undo entry.
 */

import type { TimelineStore } from '../useTimelineStore';
import { TimelineAggregate } from '../../domain';
import type { TimelineData } from '../../domain';
import { isEditLocked } from '../editLock';
import { tracksEqual } from '../../domain/services/snapshotEquality';
import { carryViewFlags } from '../../domain/services/trackViewFlags';
import type { HistoryCompanion } from '../historyCompanion';

/** Where an external whole-timeline write came from (history payload only). */
export type ReplaceTimelineReason =
  | 'ai-mix'
  | 'auto-mix'
  | 'agent'
  | 'agent-undo'
  | 'import'
  | 'subtitles'
  | 'segment';

export interface ReplaceTimelineOptions {
  /** Script patch undone/redone together with this entry (R2 §3.3). */
  companion?: HistoryCompanion;
}

/**
 * Writers that pass the external edit lock: the lock exists so the agent can
 * drive the timeline, so its operations and their undo still land. Every
 * other entry point checks the lock first and tells the user why; refusing
 * here is the last line of defence.
 */
const LOCK_EXEMPT_REASONS: ReadonlySet<ReplaceTimelineReason> = new Set<ReplaceTimelineReason>([
  'agent',
  'agent-undo',
]);

/**
 * Replace the timeline content with `data`, recording a single history entry.
 *
 * Both sides are compared after the same domain normalisation the store
 * applies on import, so a write whose tracks are unchanged records nothing
 * (an undo entry that does nothing on Ctrl+Z only confuses the user).
 *
 * Only tracks are taken from `data`: zoom, scroll and playhead stay as the
 * user left them, with the playhead clamped to the new end (TL2-04).
 *
 * Lock, mute and visibility are view flags (S12, D-31): every write except a
 * JSON import keeps the flags tracks with the same id have now, so undoing an
 * agent turn never unmutes a track the user muted after it.
 *
 * @returns whether a history entry was written.
 * @throws when `data` cannot be turned into a timeline — before any history
 *   entry or state change exists.
 */
export function replaceTimelineAction(
  get: () => TimelineStore,
  data: TimelineData,
  reason: ReplaceTimelineReason,
  options: ReplaceTimelineOptions = {},
): boolean {
  if (isEditLocked(get()) && !LOCK_EXEMPT_REASONS.has(reason)) {
    console.warn('[replaceTimelineAction] refused while edit-locked', { reason });
    return false;
  }
  const tracks = reason === 'import'
    ? data.tracks
    : carryViewFlags(data.tracks, get().exportToData().tracks);
  // Construct first: a malformed timeline throws here, before any history
  // entry, state change or cancelled gesture exists (AG2-08).
  const incoming = TimelineAggregate.fromPlainObject({ ...data, tracks });
  const incomingTracks = incoming.toPlainObject().tracks;
  // A write landing under a live drag would be overwritten by its release.
  if (get().isInteracting) get().cancelDrag();

  const state = get();
  const { companion } = options;
  // Unchanged tracks record nothing — unless a script patch rides along
  // (e.g. deleting a segment that has nothing on the timeline).
  if (!companion && tracksEqual(incomingTracks, state.exportToData().tracks)) {
    return false;
  }

  state.recordAction('REPLACE_TIMELINE', companion ? { reason, companion } : { reason });
  const view = state.exportToData();
  const totalDuration = incoming.calculateTotalDuration().value;
  state.importFromData({
    ...view,
    tracks,
    totalDuration,
    currentTime: Math.min(view.currentTime, totalDuration),
  });
  get().pruneSelection();
  get().captureNextState();
  return true;
}
