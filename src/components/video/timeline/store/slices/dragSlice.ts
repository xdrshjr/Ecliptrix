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
  PointerDownEvent,
  PointerMoveEvent,
  PointerUpEvent,
  MaterialData,
} from '../../domain';
import { DragCalculationService } from '../../domain';
import type { TimelineStore } from '../useTimelineStore';
import { addItemAction } from '../actions/addItem';
import { swapItemsAction } from '../actions/swapItems';

// ---------------------------------------------------------------------------
// Drag preview shape (plain object for React)
// ---------------------------------------------------------------------------

export interface DragPreviewData {
  itemId: string;
  startTime: number;
  duration: number;
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
  dropMaterial: (trackId: string, material: MaterialData) => void;

  // Cleanup
  disposeDragActor: () => void;
}

// ---------------------------------------------------------------------------
// Internal: ensure the drag actor exists and is started
// ---------------------------------------------------------------------------

function ensureDragActor(
  get: () => TimelineStore,
  set: (partial: Partial<TimelineStore>) => void,
): ActorRefFrom<typeof dragMachine> {
  const existing = get()._dragActor;
  if (existing) return existing;

  const actor = createDragActor();

  // Subscribe to state changes to sync derived fields
  actor.subscribe((snapshot) => {
    const dragging = isDraggingQuery(snapshot);
    const resizing = isResizingQuery(snapshot);
    const interacting = isInteractingQuery(snapshot);
    const preview = getDragPreviewQuery(snapshot);
    const committed = isCommittedQuery(snapshot);

    set({
      isDragging: dragging,
      isResizing: resizing,
      isInteracting: interacting,
      dragPreview: preview,
    });

    // When the machine reaches the committed state, apply the final
    // position to the timeline and record history, then send
    // COMMIT_COMPLETE to reset the machine.
    //
    // Previously this path bypassed recordAction/captureNextState entirely,
    // so users could not undo a drag commit. We now wrap the mutation in the
    // same record → mutate → autoOrganize → rAF(capture) pattern used by the
    // orchestrated actions, and branch on swapTargetItemId to dispatch a
    // swap instead of a move when the preview center is parked on a peer.
    if (committed && preview) {
      const state = get();
      const interactionType = snapshot.context.interactionType;
      const originalStartTime = snapshot.context.originalStartTime;
      const swapTargetId = get().swapTargetItemId;

      // Why: updateDrag mutated the aggregate via moveItem(…, true) on every
      // POINTER_MOVE for move interactions (timelineSlice.moveItem currently
      // ignores its isPreview flag), so by commit the dragged item already
      // sits at preview.startTime. If we let recordAction() / swapItemsAction
      // fire as-is, the "before" snapshot would capture the post-preview
      // state and Undo would roll back to the drag's end position — a no-op.
      // Roll the item back to its pre-drag startTime silently (no history,
      // no autoOrganize) so the subsequent recordAction captures true
      // pre-drag state. Resize paths don't hit updateDrag's mutation block
      // (that block is gated on isDragging which returns false for resize
      // states), so rollback is move-only.
      if (interactionType === 'move') {
        state.moveItem(preview.itemId, originalStartTime, false);
      }

      if (interactionType === 'move' && swapTargetId && swapTargetId !== preview.itemId) {
        // Dispatch as a swap; swapItemsAction records history + auto-organizes.
        swapItemsAction(get, preview.itemId, swapTargetId);
        set({ swapTargetItemId: null } as Partial<TimelineStore>);
      } else if (interactionType === 'move') {
        state.recordAction('MOVE_ITEM', {
          itemId: preview.itemId,
          newStartTime: preview.startTime,
        });
        state.moveItem(preview.itemId, preview.startTime, false);
        state.autoOrganize();
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => get().captureNextState());
        } else {
          Promise.resolve().then(() => get().captureNextState());
        }
      } else if (interactionType === 'resize-start' || interactionType === 'resize-end') {
        const edge = interactionType === 'resize-start' ? 'start' : 'end';
        const position = edge === 'start' ? preview.startTime : preview.startTime + preview.duration;
        state.recordAction('UPDATE_ITEM', {
          itemId: preview.itemId,
          edge,
          newPosition: position,
        });
        state.resizeItem(preview.itemId, edge, position);
        state.autoOrganize();
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(() => get().captureNextState());
        } else {
          Promise.resolve().then(() => get().captureNextState());
        }
      }

      // Always clear any lingering swap target at commit boundary.
      if (get().swapTargetItemId !== null) {
        set({ swapTargetItemId: null } as Partial<TimelineStore>);
      }

      // Signal commit complete to reset the machine
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
      // Move in preview mode (no history recording)
      get().moveItem(preview.itemId, preview.startTime, true);

      // Swap-target detection: only for move interactions. Resize drags can
      // never mean "swap", so clear any stale target in that case.
      const interactionType = snapshot.context.interactionType;
      if (interactionType === 'move') {
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
    actor.send({ type: 'ESCAPE' });
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

  dropMaterial: (trackId: string, material: MaterialData) => {
    // Delegate to the orchestrated addItemAction so the drop participates in
    // history + autoOrganize, same as toolbar/panel-triggered adds. Previously
    // this called state.addItemToTrack(...) directly, bypassing both.
    addItemAction(get, trackId, material);
    // Clear drag-over state
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
