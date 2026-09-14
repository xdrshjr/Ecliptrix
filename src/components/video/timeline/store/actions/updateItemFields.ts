/**
 * updateItemFields — undoable single-field edits.
 *
 * Inline subtitle text and a confirmed image-overlay position used to write
 * the store directly, so Ctrl+Z skipped them and undid the step before
 * instead (with no way to redo). Both now record one history entry, and a
 * value that did not change records nothing. Every edit here is refused on a
 * locked track and while the agent holds the external edit lock.
 */

import type { TimelineStore } from '../useTimelineStore';
import type { ImagePosition } from '../../domain/types';
import { isEditLocked } from '../editLock';

const POSITION_EPSILON = 1e-6;
const POSITION_KEYS = ['x', 'y', 'width', 'height', 'zIndex'] as const;

/** Why a field edit on an item is refused. */
export type ImageEditBlocker = 'agent-lock' | 'track-locked' | 'missing';

/**
 * The reason an edit to `itemId` would be refused right now, or null when it
 * is allowed. The UI uses it to put a refused image drag back (S13).
 */
export function imageEditBlocker(
  get: () => TimelineStore,
  itemId: string,
): ImageEditBlocker | null {
  if (isEditLocked(get())) return 'agent-lock';
  const found = get()._aggregate.findItem(itemId);
  if (!found) return 'missing';
  return found.track.isLocked ? 'track-locked' : null;
}

/** The stored image position of `itemId` (read-only; keeps `_aggregate` inside the store). */
export function readImagePosition(
  get: () => TimelineStore,
  itemId: string,
): ImagePosition | undefined {
  return get()._aggregate.findItem(itemId)?.item.imagePosition;
}

/**
 * The item's entity, or null when it is missing, its track is locked or the
 * agent holds the edit lock — the single entry point for every field edit.
 */
function findEditableItem(get: () => TimelineStore, itemId: string) {
  if (imageEditBlocker(get, itemId) !== null) return null;
  return get()._aggregate.findItem(itemId)?.item ?? null;
}

function isSamePosition(current: ImagePosition | undefined, next: ImagePosition): boolean {
  if (!current) return false;
  return POSITION_KEYS.every(
    key => Math.abs((current[key] ?? 0) - (next[key] ?? 0)) < POSITION_EPSILON,
  );
}

/**
 * Change a subtitle item's text as one undoable step.
 * @returns whether the edit was applied.
 */
export function updateSubtitleTextAction(
  get: () => TimelineStore,
  itemId: string,
  text: string,
): boolean {
  const item = findEditableItem(get, itemId);
  if (!item || (item.text ?? '') === text) return false;

  const state = get();
  state.recordAction('UPDATE_ITEM', { itemId, field: 'text' });
  state.updateItemSubtitle(itemId, text);
  get().captureNextState();
  return true;
}

/**
 * Commit an image overlay's position/scale as one undoable step. Live drag
 * previews stay outside history; only the confirmed value is recorded.
 * @returns whether the edit was applied.
 */
export function updateImagePositionAction(
  get: () => TimelineStore,
  itemId: string,
  position: ImagePosition,
): boolean {
  const item = findEditableItem(get, itemId);
  if (!item || isSamePosition(item.imagePosition, position)) return false;

  const state = get();
  state.recordAction('UPDATE_ITEM', { itemId, field: 'imagePosition' });
  state.updateItemImagePosition(itemId, position);
  get().captureNextState();
  return true;
}

/**
 * Write an image position that is not a user edit — the overlay's first
 * auto-fit to the image's aspect ratio — without an undo entry. It still has
 * to reach the store: export and autosave read the store, and a position that
 * lived only in component state was later overwritten by the next edit (ME-05).
 * @returns whether the store changed.
 */
export function fitImagePositionAction(
  get: () => TimelineStore,
  itemId: string,
  position: ImagePosition,
): boolean {
  const item = findEditableItem(get, itemId);
  if (!item || isSamePosition(item.imagePosition, position)) return false;

  get().updateItemImagePosition(itemId, position);
  return true;
}
