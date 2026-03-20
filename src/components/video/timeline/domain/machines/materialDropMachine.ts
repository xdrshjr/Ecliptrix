/**
 * Material Drop State Machine — XState v5
 *
 * Manages the state of dragging a material from the material panel
 * onto a track on the timeline. This is simpler than the drag machine
 * since it deals with HTML5 drag-and-drop (dragOver/drop) rather than
 * pointer events.
 *
 * States: idle → dragOver → dropped → idle
 *
 * Pure machine definition — no React or DOM dependencies.
 */

import { setup, assign, createActor, type SnapshotFrom } from 'xstate';

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface MaterialDropContext {
  /** The type of material being dragged (e.g. 'video', 'audio', 'image'). */
  materialType: string | null;
  /** The ID of the material being dragged. */
  materialId: string | null;
  /** The track the material is currently hovering over. */
  targetTrackId: string | null;
  /** The track type of the target track. */
  targetTrackType: string | null;
  /** Whether the material is compatible with the target track. */
  isCompatible: boolean;
  /** Drop position in seconds on the timeline. */
  dropTimePosition: number | null;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type DragEnterEvent = {
  type: 'DRAG_ENTER';
  materialType: string;
  materialId: string;
  targetTrackId: string;
  targetTrackType: string;
  isCompatible: boolean;
  timePosition: number;
};

export type DragOverUpdateEvent = {
  type: 'DRAG_OVER_UPDATE';
  targetTrackId: string;
  targetTrackType: string;
  isCompatible: boolean;
  timePosition: number;
};

export type DragLeaveEvent = { type: 'DRAG_LEAVE' };

export type DropEvent = {
  type: 'DROP';
  timePosition: number;
};

export type ItemCreatedEvent = { type: 'ITEM_CREATED' };

export type MaterialDropEvent =
  | DragEnterEvent
  | DragOverUpdateEvent
  | DragLeaveEvent
  | DropEvent
  | ItemCreatedEvent;

// ---------------------------------------------------------------------------
// Initial context
// ---------------------------------------------------------------------------

const initialContext: MaterialDropContext = {
  materialType: null,
  materialId: null,
  targetTrackId: null,
  targetTrackType: null,
  isCompatible: false,
  dropTimePosition: null,
};

// ---------------------------------------------------------------------------
// Machine definition
// ---------------------------------------------------------------------------

export const materialDropMachine = setup({
  types: {
    context: {} as MaterialDropContext,
    events: {} as MaterialDropEvent,
  },
  actions: {
    captureDragEnter: assign(({ event }) => {
      const e = event as MaterialDropEvent & { type: 'DRAG_ENTER' };
      return {
        materialType: e.materialType,
        materialId: e.materialId,
        targetTrackId: e.targetTrackId,
        targetTrackType: e.targetTrackType,
        isCompatible: e.isCompatible,
        dropTimePosition: e.timePosition,
      };
    }),

    updateDragOver: assign(({ event }) => {
      const e = event as MaterialDropEvent & { type: 'DRAG_OVER_UPDATE' };
      return {
        targetTrackId: e.targetTrackId,
        targetTrackType: e.targetTrackType,
        isCompatible: e.isCompatible,
        dropTimePosition: e.timePosition,
      };
    }),

    captureDropPosition: assign(({ event }) => {
      const e = event as MaterialDropEvent & { type: 'DROP' };
      return {
        dropTimePosition: e.timePosition,
      };
    }),

    resetContext: assign(() => ({
      materialType: null as string | null,
      materialId: null as string | null,
      targetTrackId: null as string | null,
      targetTrackType: null as string | null,
      isCompatible: false,
      dropTimePosition: null as number | null,
    })),
  },
}).createMachine({
  id: 'materialDrop',
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        DRAG_ENTER: {
          target: 'dragOver',
          actions: 'captureDragEnter',
        },
      },
    },

    dragOver: {
      on: {
        DRAG_OVER_UPDATE: {
          // Stay in dragOver but update the context (e.g. hover position)
          actions: 'updateDragOver',
        },
        DRAG_ENTER: {
          // Material moved to a different track
          actions: 'captureDragEnter',
        },
        DROP: {
          target: 'dropped',
          actions: 'captureDropPosition',
        },
        DRAG_LEAVE: {
          target: 'idle',
          actions: 'resetContext',
        },
      },
    },

    dropped: {
      on: {
        ITEM_CREATED: {
          target: 'idle',
          actions: 'resetContext',
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------

export type MaterialDropSnapshot = SnapshotFrom<typeof materialDropMachine>;

export function createMaterialDropActor() {
  return createActor(materialDropMachine);
}

/** Whether a material is hovering over a track. */
export function isDragOver(snapshot: MaterialDropSnapshot): boolean {
  return snapshot.matches('dragOver');
}

/** Whether a material was just dropped and awaiting item creation. */
export function isDropped(snapshot: MaterialDropSnapshot): boolean {
  return snapshot.matches('dropped');
}
