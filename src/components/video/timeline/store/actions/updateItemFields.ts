/**
 * updateItemFields — undoable single-field edits.
 *
 * Inline subtitle text and a confirmed image-overlay position used to write
 * the store directly, so Ctrl+Z skipped them and undid the step before
 * instead (with no way to redo). Both now record one history entry, and a
 * value that did not change records nothing.
 */

import type { TimelineStore } from '../useTimelineStore';
import type { ImagePosition } from '../../domain/types';

const POSITION_EPSILON = 1e-6;
const POSITION_KEYS = ['x', 'y', 'width', 'height', 'zIndex'] as const;

/** The item's entity, or null when it is missing or its track is locked. */
function findEditableItem(get: () => TimelineStore, itemId: string) {
  const found = get()._aggregate.findItem(itemId);
  if (!found || found.track.isLocked) return null;
  return found.item;
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
