/**
 * dragSlice — Drag and resize interaction state.
 *
 * Integrates the XState drag machine and material drop machine to
 * manage drag/resize lifecycle and material-onto-track drag-over state.
 *
 * The drag actor is created lazily on the first interaction and
 * subscribes to state changes to keep the Zustand-side derived fields
 * (isDragging, isResizing, dragPreview) in sync.
 */

import type { StateCreator } from 'zustand';
import type { ActorRefFrom } from 'xstate';
import {
  dragMachine,
  createDragActor,
  isDragging as isDraggingQuery,
  isResizing as isResizingQuery,
  isInteracting as isInteractingQuery,
  getDragPreview as getDragPreviewQuery,
  isCommitted as isCommittedQuery,
} from '../../domain';
import type {
  DragContext,
  DragSnapshot,
  PointerDownEvent,
  PointerMoveEvent,
  PointerUpEvent,
} from '../../domain';
import { DragCalculationService } from '../../domain';
import type { TimelineStore } from '../useTimelineStore';
import { moveItemAction } from '../actions/moveItem';
import { resizeItemAction } from '../actions/resizeItem';
import { swapItemsAction } from '../actions/swapItems';
import { isEditLocked } from '../editLock';

// ---------------------------------------------------------------------------
// Drag preview shape (plain object for React)
// ---------------------------------------------------------------------------

export interface DragPreviewData {
  itemId: string;
  startTime: number;
  duration: number;
  /** Track under the pointer (move drags only); null outside any lane. */
  targetTrackId?: string | null;
}

// ---------------------------------------------------------------------------
// Material drag-over shape
// ---------------------------------------------------------------------------

export interface MaterialDragOverData {
  trackId: string;
  materialType: string;
  isCompatible: boolean;
}

// ---------------------------------------------------------------------------
// Slice state + actions interface
// ---------------------------------------------------------------------------

export interface DragSlice {
  _dragActor: ActorRefFrom<typeof dragMachine> | null;

  // Derived convenience state
  isDragging: boolean;
  isResizing: boolean;
  /** True when the drag machine is in any non-idle state (including detecting). */
  isInteracting: boolean;
  dragPreview: DragPreviewData | null;

  /**
   * When a drag-move preview's center falls inside the middle 60% of another
   * item on the same video/audio track, that item's id is held here so the
   * UI can highlight it and the commit path can trigger a swap instead of a
   * plain move. Null when no swap target is under the pointer or the drag
   * is a resize/subtitle/locked-track interaction.
   */
  swapTargetItemId: string | null;

  // Material drag-over state (HTML5 DnD from material panel)
  materialDragOver: MaterialDragOverData | null;

  // Item drag/resize actions
  startDrag: (event: PointerDownEvent) => void;
  updateDrag: (event: PointerMoveEvent) => void;
  endDrag: (event: PointerUpEvent) => void;
  cancelDrag: () => void;

  // Material drag-over actions
  setMaterialDragOver: (trackId: string, materialType: string, isCompatible: boolean) => void;
  clearMaterialDragOver: () => void;

  // Cleanup
  disposeDragActor: () => void;
}

// ---------------------------------------------------------------------------
// Commit decisions (pure)
// ---------------------------------------------------------------------------

const CHANGE_EPSILON_SECONDS = 1e-6;

type CommitContext = Pick<DragContext, 'trackId' | 'originalStartTime' | 'originalDuration'>;

type SetStore = (partial: Partial<TimelineStore>) => void;

/** The pointer finished over a different lane than the clip started on. */
function isCrossTrackMove(preview: DragPreviewData, context: CommitContext): boolean {
  return !!preview.targetTrackId && preview.targetTrackId !== context.trackId;
}

/** A move commit changes something: another lane, a swap, or a new start time. */
function hasMoveChanged(
  preview: DragPreviewData,
  context: CommitContext,
  swapTargetId: string | null,
): boolean {
  if (isCrossTrackMove(preview, context)) return true;
  if (swapTargetId !== null && swapTargetId !== preview.itemId) return true;
  return Math.abs(preview.startTime - context.originalStartTime) > CHANGE_EPSILON_SECONDS;
}

/** A trim commit changes the clip's start or length. */
function hasResizeChanged(preview: DragPreviewData, context: CommitContext): boolean {
  return (
    Math.abs(preview.startTime - context.originalStartTime) > CHANGE_EPSILON_SECONDS ||
    Math.abs(preview.duration - context.originalDuration) > CHANGE_EPSILON_SECONDS
  );
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function commitCrossTrackMove(get: () => TimelineStore, preview: DragPreviewData): void {
  const state = get();
  const targetTrackId = preview.targetTrackId as string;
  // Transfer the clip to the track under the pointer. moveItem guards the
  // target (unlocked + type-compatible) and falls back to a same-track
  // move if it can't accept, so the clip is never dropped (§8.3).
  state.recordAction('MOVE_ITEM', {
    itemId: preview.itemId,
    newStartTime: preview.startTime,
    targetTrackId,
  });
  state.moveItem(preview.itemId, preview.startTime, false, targetTrackId);
  state.autoOrganize();
  // Fix C: the clip has correctly transferred to the target track, but
  // autoOrganize repacks that track flush-from-0, so a short clip dropped
  // onto a track that already holds a long clip lands past the right edge of
  // the viewport and reads as "lost". Select it and ask the panel to scroll it
  // into view so the cross-track move is observable.
  state.selectItem(preview.itemId);
  state.requestScrollItemIntoView(preview.itemId);
  get().captureNextState();
}

function commitMove(
  get: () => TimelineStore,
  set: SetStore,
  context: DragContext,
  preview: DragPreviewData,
): void {
  const state = get();
  const swapTargetId = state.swapTargetItemId;

  // Why: updateDrag mutated the aggregate via moveItem(…, true) on every
  // POINTER_MOVE, so by commit the dragged item already sits at
  // preview.startTime. Roll it back to its pre-drag startTime silently (no
  // history, no autoOrganize) so a recorded before-snapshot captures the true
  // pre-drag state, and so a refused or unchanged commit leaves it in place.
  state.moveItem(preview.itemId, context.originalStartTime, false);

  // Releasing at the origin is not an edit, and the agent may have taken the
  // timeline mid-gesture.
  if (isEditLocked(get()) || !hasMoveChanged(preview, context, swapTargetId)) return;

  if (isCrossTrackMove(preview, context)) {
    // Cross-track transfers skip the swap branch: findSwapTarget only scans
    // the source track, so a swap target held here is stale.
    commitCrossTrackMove(get, preview);
  } else if (swapTargetId !== null && swapTargetId !== preview.itemId) {
    // Dispatch as a swap; swapItemsAction records history + auto-organizes.
    swapItemsAction(get, preview.itemId, swapTargetId);
    set({ swapTargetItemId: null });
  } else {
    moveItemAction(get, preview.itemId, preview.startTime);
  }
}

function commitResize(
  get: () => TimelineStore,
  context: DragContext,
  preview: DragPreviewData,
): void {
  if (!hasResizeChanged(preview, context)) return;
  const edge = context.interactionType === 'resize-start' ? 'start' : 'end';
  const position = edge === 'start' ? preview.startTime : preview.startTime + preview.duration;
  // resizeItemAction owns the lock check, history, trim, camera-motion window
  // shift and auto-organize; the drag path used to bypass all of it (TL2-02).
  resizeItemAction(get, preview.itemId, edge, position);
}

/**
 * Apply a committed interaction. Nothing is recorded when nothing changed,
 * and a clip that vanished mid-drag (undo, delete or an external replace
 * landed under the gesture) is left alone (TL2-18).
 */
function commitInteraction(get: () => TimelineStore, set: SetStore, snapshot: DragSnapshot): void {
  const preview = getDragPreviewQuery(snapshot);
  if (!preview || get()._aggregate.findItem(preview.itemId) === null) return;
  const { context } = snapshot;
  if (context.interactionType === 'move') {
    commitMove(get, set, context, preview);
  } else if (context.interactionType === 'resize-start' || context.interactionType === 'resize-end') {
    commitResize(get, context, preview);
  }
}

// ---------------------------------------------------------------------------
// Internal: ensure the drag actor exists and is started
// ---------------------------------------------------------------------------

function ensureDragActor(
  get: () => TimelineStore,
  set: SetStore,
): ActorRefFrom<typeof dragMachine> {
  const existing = get()._dragActor;
  if (existing) return existing;

  const actor = createDragActor();

  // Subscribe to state changes to sync derived fields
  actor.subscribe((snapshot) => {
    set({
      isDragging: isDraggingQuery(snapshot),
      isResizing: isResizingQuery(snapshot),
      isInteracting: isInteractingQuery(snapshot),
      dragPreview: getDragPreviewQuery(snapshot),
    });

    // Reaching `committed` must ALWAYS end with COMMIT_COMPLETE. It used to be
    // sent only when a preview existed, so a flick released right after the
    // threshold parked the machine in `committed` and killed every later drag
    // of the session (TL2-16).
    if (isCommittedQuery(snapshot)) {
      commitInteraction(get, set, snapshot);
      if (get().swapTargetItemId !== null) {
        set({ swapTargetItemId: null });
      }
      actor.send({ type: 'COMMIT_COMPLETE' });
    }
  });

  actor.start();
  set({ _dragActor: actor } as Partial<TimelineStore>);
  return actor;
}

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createDragSlice: StateCreator<
  TimelineStore,
  [],
  [],
  DragSlice
> = (set, get) => ({
  _dragActor: null,
  isDragging: false,
  isResizing: false,
  isInteracting: false,
  dragPreview: null,
  swapTargetItemId: null,
  materialDragOver: null,

  startDrag: (event: PointerDownEvent) => {
    // Refuse at the source: a drag started under the agent's lock would still
    // preview-move the clip in the store even though its commit is refused.
    if (isEditLocked(get())) return;
    const actor = ensureDragActor(get, set);
    actor.send(event);
  },

  updateDrag: (event: PointerMoveEvent) => {
    const actor = get()._dragActor;
    if (!actor) return;

    actor.send(event);

    // Apply preview position to the timeline (preview mode)
    const snapshot = actor.getSnapshot();
    const preview = getDragPreviewQuery(snapshot);
    const dragging = isDraggingQuery(snapshot);
    if (preview && dragging) {
      // Move in preview mode (no history recording). Preview never transfers
      // tracks — the clip stays on its source track and only its start time
      // tracks the pointer; the actual cross-track transfer happens once, at
      // commit (analysis constraint #2). So no targetTrackId is passed here.
      get().moveItem(preview.itemId, preview.startTime, true);

      // Swap-target detection: only for same-track move interactions. Resize
      // drags can never mean "swap"; neither can a cross-track move (the clip
      // is heading to another lane, not swapping with a peer on this one), so
      // clear any stale target in those cases.
      const interactionType = snapshot.context.interactionType;
      const crossTrack =
        !!preview.targetTrackId && preview.targetTrackId !== snapshot.context.trackId;
      if (interactionType === 'move' && !crossTrack) {
        const tracks = get().tracks;
        const nextTarget = DragCalculationService.findSwapTarget(
          tracks,
          preview.itemId,
          { startTime: preview.startTime, duration: preview.duration },
        );
        if (nextTarget !== get().swapTargetItemId) {
          set({ swapTargetItemId: nextTarget } as Partial<TimelineStore>);
        }
      } else if (get().swapTargetItemId !== null) {
        set({ swapTargetItemId: null } as Partial<TimelineStore>);
      }
    }
  },

  endDrag: (event: PointerUpEvent) => {
    const actor = get()._dragActor;
    if (!actor) return;
    actor.send(event);
    // Committed branch (in ensureDragActor) will clear swapTargetItemId
    // after dispatching swap-or-move, so no clean-up here.
  },

  cancelDrag: () => {
    const actor = get()._dragActor;
    if (!actor) return;
    const snapshot = actor.getSnapshot();
    const { itemId, originalStartTime } = snapshot.context;
    // Only a move drag writes its preview into the store (updateDrag's
    // mutation is gated on isDragging); resize previews live in the machine.
    const wasDragging = isDraggingQuery(snapshot);
    actor.send({ type: 'ESCAPE' });
    if (wasDragging && itemId) {
      const current = get().tracks
        .flatMap(track => track.items)
        .find(item => item.id === itemId);
      if (current && Math.abs(current.startTime - originalStartTime) > 1e-6) {
        // Preview mode: roll back the preview without recording history.
        get().moveItem(itemId, originalStartTime, true);
      }
    }
    if (get().swapTargetItemId !== null) {
      set({ swapTargetItemId: null } as Partial<TimelineStore>);
    }
  },

  setMaterialDragOver: (trackId: string, materialType: string, isCompatible: boolean) => {
    set({
      materialDragOver: { trackId, materialType, isCompatible },
    });
  },

  clearMaterialDragOver: () => {
    set({ materialDragOver: null });
  },

  disposeDragActor: () => {
    const actor = get()._dragActor;
    if (actor) {
      actor.stop();
      set({
        _dragActor: null,
        isDragging: false,
        isResizing: false,
        isInteracting: false,
        dragPreview: null,
        swapTargetItemId: null,
      } as Partial<TimelineStore>);
    }
  },
});
