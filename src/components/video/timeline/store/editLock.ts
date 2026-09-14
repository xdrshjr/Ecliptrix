/**
 * editLock — the single predicate for "a non-user writer owns the timeline".
 *
 * While the editing agent runs, `uiSlice.externalEditLock` is set. Every user
 * edit action (and every UI call site that mutates a slice directly) checks
 * this first so the lock cannot be bypassed from outside the toolbar.
 */

import type { TimelineStore } from './useTimelineStore';

export function isEditLocked(state: Pick<TimelineStore, 'externalEditLock'>): boolean {
  return state.externalEditLock !== null;
}
