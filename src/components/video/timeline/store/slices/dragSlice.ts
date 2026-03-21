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
import type { TimelineStore } from '../useTimelineStore';

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
    if (committed && preview) {
      const state = get();
      const interactionType = snapshot.context.interactionType;

      if (interactionType === 'move') {
        // Final move commit (not preview)
        state.moveItem(preview.itemId, preview.startTime, false);
      } else if (interactionType === 'resize-start' || interactionType === 'resize-end') {
        const edge = interactionType === 'resize-start' ? 'start' : 'end';
        const position = edge === 'start' ? preview.startTime : preview.startTime + preview.duration;
        state.resizeItem(preview.itemId, edge, position);
        // Auto-consolidate: shift subsequent items to close gaps
        state.consolidateTrackAfterItem(preview.itemId);
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
    if (preview && isDraggingQuery(snapshot)) {
      // Move in preview mode (no history recording)
      get().moveItem(preview.itemId, preview.startTime, true);
    }
  },

  endDrag: (event: PointerUpEvent) => {
    const actor = get()._dragActor;
    if (!actor) return;
    actor.send(event);
  },

  cancelDrag: () => {
    const actor = get()._dragActor;
    if (!actor) return;
    actor.send({ type: 'ESCAPE' });
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
    const state = get();
    // Delegate to addItemToTrack action which handles the full flow
    state.addItemToTrack(trackId, material);
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
      } as Partial<TimelineStore>);
    }
  },
});
