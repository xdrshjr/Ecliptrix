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

/** Where an external whole-timeline write came from (history payload only). */
export type ReplaceTimelineReason =
  | 'ai-mix'
  | 'auto-mix'
  | 'agent'
  | 'agent-undo'
  | 'import'
  | 'subtitles';

/**
 * Replace the timeline with `data`, recording a single history entry.
 *
 * Both sides are compared after the same domain normalisation the store
 * applies on import, so a write whose tracks are unchanged records nothing
 * (an undo entry that does nothing on Ctrl+Z only confuses the user).
 *
 * @returns whether a history entry was written.
 */
export function replaceTimelineAction(
  get: () => TimelineStore,
  data: TimelineData,
  reason: ReplaceTimelineReason,
): boolean {
  const state = get();
  const incomingTracks = TimelineAggregate.fromPlainObject(data).toPlainObject().tracks;
  if (JSON.stringify(incomingTracks) === JSON.stringify(state.exportToData().tracks)) {
    return false;
  }

  state.recordAction('REPLACE_TIMELINE', { reason });
  state.importFromData(data);
  get().pruneSelection();
  get().captureNextState();
  return true;
}
