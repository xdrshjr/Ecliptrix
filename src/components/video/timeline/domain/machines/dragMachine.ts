/**
 * Drag State Machine — XState v5
 *
 * Manages the drag/resize interaction lifecycle for timeline items.
 * This is a pure machine definition with no React or DOM dependencies.
 *
 * States: idle → detecting → dragging/resizingStart/resizingEnd →
 *         previewing/resizePreviewing → committed → idle
 *
 * The machine captures pointer events and computes preview positions
 * using inline drag calculation logic (same math as DragCalculationService:
 * RESIZE_HANDLE_WIDTH=8, pixelsPerSecond=zoomLevel*50).
 *
 * Extracted from: src/components/video/timeline/TimelineItem.tsx
 */

import { setup, assign, createActor, type SnapshotFrom } from 'xstate';

// ---------------------------------------------------------------------------
// Constants (same as DragCalculationService)
// ---------------------------------------------------------------------------

/** Width in pixels of the resize handle at each edge of an item. */
const RESIZE_HANDLE_WIDTH = 8;

/** Base pixels-per-second ratio (matches ZoomLevel.PIXELS_PER_SECOND_BASE). */
const PIXELS_PER_SECOND_BASE = 50;

/** Minimum item duration in seconds (prevents zero-length items). */
const MIN_DURATION = 0.1;

// ---------------------------------------------------------------------------
// Interaction type detection (inline — same logic as DragCalculationService)
// ---------------------------------------------------------------------------

export type InteractionType = 'move' | 'resize-start' | 'resize-end';

/**
 * Determine the interaction type based on where the user clicked
 * relative to the item's left edge.
 */
function detectInteractionType(
  relativeX: number,
  itemWidth: number
): InteractionType {
  if (relativeX <= RESIZE_HANDLE_WIDTH) {
    return 'resize-start';
  }
  if (relativeX >= itemWidth - RESIZE_HANDLE_WIDTH) {
    return 'resize-end';
  }
  return 'move';
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface DragContext {
  /** ID of the item being dragged. */
  itemId: string | null;
  /** ID of the track the item belongs to. */
  trackId: string | null;
  /**
   * Track id under the pointer during a move drag, or null. Differs from
   * `trackId` (the source track) once the pointer crosses into another track,
   * which is what signals a cross-track move at commit time.
   */
  targetTrackId: string | null;

  /** Original start time (seconds) — used for ESC restore. */
  originalStartTime: number;
  /** Original duration (seconds) — used for ESC restore. */
  originalDuration: number;

  /** Detected interaction type (set on POINTER_DOWN). */
  interactionType: InteractionType | null;

  /** The screen position where the pointer was pressed. */
  pointerDownPosition: { x: number; y: number } | null;
  /** Cumulative pixel delta from the pointer-down position. */
  currentDelta: { x: number; y: number };

  /** Computed preview start time (seconds). null = no preview yet. */
  previewStartTime: number | null;
  /** Computed preview duration (seconds). null = no preview yet. */
  previewDuration: number | null;

  /** Pixel threshold before an interaction counts as a drag (not a click). */
  moveThreshold: number;
  /** Throttle interval hint for the UI layer (ms). */
  throttleMs: number;

  /** Current zoom level — needed to convert pixels to seconds. */
  zoomLevel: number;

  /** Original clip info for constraining resizes. */
  originalClipStart: number;
  originalClipEnd: number;
  originalMediaDuration: number;
}

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type PointerDownEvent = {
  type: 'POINTER_DOWN';
  itemId: string;
  trackId: string;
  clientX: number;
  clientY: number;
  /** X position relative to the item's left edge (for interaction detection). */
  relativeX: number;
  /** Current pixel width of the item. */
  itemWidth: number;
  originalStartTime: number;
  originalDuration: number;
  zoomLevel: number;
  /** Original clip start within the source media (seconds). 0 if not clipped. */
  clipStart?: number;
  /** Original clip end within the source media (seconds). Defaults to originalMediaDuration. */
  clipEnd?: number;
  /** Total duration of the source media (seconds). Defaults to originalDuration. */
  originalMediaDuration?: number;
};

export type PointerMoveEvent = {
  type: 'POINTER_MOVE';
  clientX: number;
  clientY: number;
  /** Total pixel delta from the pointer-down position (clientX - downX). */
  deltaX: number;
  /**
   * Track id under the pointer, resolved by the UI layer via hit-testing
   * (document.elementFromPoint → closest('[data-track-id]')). Null when the
   * pointer is outside any track. Used to enable cross-track moves; the
   * machine stays DOM-free and only stores what the UI computes.
   */
  targetTrackId?: string | null;
};

export type PointerUpEvent = {
  type: 'POINTER_UP';
  clientX: number;
  clientY: number;
};

export type EscapeEvent = { type: 'ESCAPE' };
export type PreviewAppliedEvent = { type: 'PREVIEW_APPLIED' };
export type CommitCompleteEvent = { type: 'COMMIT_COMPLETE' };

export type DragEvent =
  | PointerDownEvent
  | PointerMoveEvent
  | PointerUpEvent
  | EscapeEvent
  | PreviewAppliedEvent
  | CommitCompleteEvent;

// ---------------------------------------------------------------------------
// Initial context
// ---------------------------------------------------------------------------

const initialContext: DragContext = {
  itemId: null,
  trackId: null,
  targetTrackId: null,
  originalStartTime: 0,
  originalDuration: 0,
  interactionType: null,
  pointerDownPosition: null,
  currentDelta: { x: 0, y: 0 },
  previewStartTime: null,
  previewDuration: null,
  moveThreshold: 3,
  throttleMs: 16,
  zoomLevel: 1,
  originalClipStart: 0,
  originalClipEnd: 0,
  originalMediaDuration: 0,
};

// ---------------------------------------------------------------------------
// Helper: pixels-to-seconds conversion
// ---------------------------------------------------------------------------

function pixelsToSeconds(px: number, zoomLevel: number): number {
  const pps = zoomLevel * PIXELS_PER_SECOND_BASE;
  return pps === 0 ? 0 : px / pps;
}

// ---------------------------------------------------------------------------
// Helper: calculate move preview
// ---------------------------------------------------------------------------

function calculateMovePreview(
  originalStartTime: number,
  deltaX: number,
  zoomLevel: number
): number {
  const deltaTime = pixelsToSeconds(deltaX, zoomLevel);
  return Math.max(0, originalStartTime + deltaTime);
}

// ---------------------------------------------------------------------------
// Helper: calculate resize-end preview
// ---------------------------------------------------------------------------

function calculateResizeEndPreview(
  originalDuration: number,
  deltaX: number,
  zoomLevel: number,
  originalClipStart: number,
  originalMediaDuration: number
): { duration: number } {
  const deltaTime = pixelsToSeconds(deltaX, zoomLevel);
  const requestedDuration = originalDuration + deltaTime;

  // Constrain: max duration limited by remaining source media after clipStart
  const maxAllowedDuration = originalMediaDuration - originalClipStart;
  const constrainedDuration = Math.max(
    MIN_DURATION,
    Math.min(requestedDuration, maxAllowedDuration)
  );

  return { duration: constrainedDuration };
}

// ---------------------------------------------------------------------------
// Helper: calculate resize-start preview
// ---------------------------------------------------------------------------

function calculateResizeStartPreview(
  originalStartTime: number,
  originalDuration: number,
  deltaX: number,
  zoomLevel: number,
  originalClipStart: number,
  originalMediaDuration: number
): { startTime: number; duration: number } {
  const deltaTime = pixelsToSeconds(deltaX, zoomLevel);
  const originalEndTime = originalStartTime + originalDuration;

  // How far left we can extend (limited by clipStart reaching 0)
  const maxLeftExtension = originalClipStart;
  const minAllowedStartTime = Math.max(0, originalStartTime - maxLeftExtension);
  const maxAllowedStartTime = originalEndTime - MIN_DURATION;

  // Apply constraints
  const requestedStartTime = originalStartTime + deltaTime;
  const constrainedStartTime = Math.max(
    minAllowedStartTime,
    Math.min(requestedStartTime, maxAllowedStartTime)
  );

  const constrainedDuration = originalEndTime - constrainedStartTime;

  // Final check: duration must not exceed original media duration
  const finalDuration = Math.min(constrainedDuration, originalMediaDuration);
  const finalStartTime = originalEndTime - finalDuration;

  return { startTime: finalStartTime, duration: finalDuration };
}

// ---------------------------------------------------------------------------
// Machine definition (XState v5 setup API)
// ---------------------------------------------------------------------------

export const dragMachine = setup({
  types: {
    context: {} as DragContext,
    events: {} as DragEvent,
  },
  guards: {
    isMoveInteraction: ({ event }) => {
      if (event.type !== 'POINTER_DOWN') return false;
      const e = event as PointerDownEvent;
      return detectInteractionType(e.relativeX, e.itemWidth) === 'move';
    },
    isResizeStartInteraction: ({ event }) => {
      if (event.type !== 'POINTER_DOWN') return false;
      const e = event as PointerDownEvent;
      return detectInteractionType(e.relativeX, e.itemWidth) === 'resize-start';
    },
    isResizeEndInteraction: ({ event }) => {
      if (event.type !== 'POINTER_DOWN') return false;
      const e = event as PointerDownEvent;
      return detectInteractionType(e.relativeX, e.itemWidth) === 'resize-end';
    },
    exceedsThreshold: ({ context, event }) => {
      if (event.type !== 'POINTER_MOVE') return false;
      const e = event as PointerMoveEvent;
      return Math.abs(e.deltaX) > context.moveThreshold;
    },
    // isWithinThreshold is implied by the absence of exceedsThreshold.
    // Removed as dead code — detecting → idle on POINTER_UP is unconditional.
  },
  actions: {
    capturePointerDown: assign(({ event }) => {
      const e = event as PointerDownEvent;
      return {
        itemId: e.itemId,
        trackId: e.trackId,
        targetTrackId: null as string | null,
        originalStartTime: e.originalStartTime,
        originalDuration: e.originalDuration,
        pointerDownPosition: { x: e.clientX, y: e.clientY },
        interactionType: detectInteractionType(e.relativeX, e.itemWidth),
        currentDelta: { x: 0, y: 0 },
        previewStartTime: null as number | null,
        previewDuration: null as number | null,
        zoomLevel: e.zoomLevel,
        originalClipStart: e.clipStart ?? 0,
        originalClipEnd: e.clipEnd ?? (e.originalMediaDuration ?? e.originalDuration),
        originalMediaDuration: e.originalMediaDuration ?? e.originalDuration,
      };
    }),

    calculateMovePreview: assign(({ context, event }) => {
      const e = event as PointerMoveEvent;
      return {
        previewStartTime: calculateMovePreview(
          context.originalStartTime,
          e.deltaX,
          context.zoomLevel
        ),
        previewDuration: context.originalDuration,
        currentDelta: { x: e.deltaX, y: 0 },
        // Track the hovered track so the commit path can transfer the clip.
        // Falls back to the source track when the pointer is outside any lane.
        targetTrackId: (e.targetTrackId ?? context.trackId) as string | null,
      };
    }),

    calculateResizeStartPreview: assign(({ context, event }) => {
      const e = event as PointerMoveEvent;
      const result = calculateResizeStartPreview(
        context.originalStartTime,
        context.originalDuration,
        e.deltaX,
        context.zoomLevel,
        context.originalClipStart,
        context.originalMediaDuration
      );
      return {
        previewStartTime: result.startTime,
        previewDuration: result.duration,
        currentDelta: { x: e.deltaX, y: 0 },
      };
    }),

    calculateResizeEndPreview: assign(({ context, event }) => {
      const e = event as PointerMoveEvent;
      const result = calculateResizeEndPreview(
        context.originalDuration,
        e.deltaX,
        context.zoomLevel,
        context.originalClipStart,
        context.originalMediaDuration
      );
      return {
        previewStartTime: context.originalStartTime,
        previewDuration: result.duration,
        currentDelta: { x: e.deltaX, y: 0 },
      };
    }),

    restoreOriginal: assign(({ context }) => ({
      previewStartTime: context.originalStartTime,
      previewDuration: context.originalDuration,
    })),

    resetContext: assign(() => ({
      itemId: null as string | null,
      trackId: null as string | null,
      targetTrackId: null as string | null,
      originalStartTime: 0,
      originalDuration: 0,
      interactionType: null as InteractionType | null,
      pointerDownPosition: null as { x: number; y: number } | null,
      currentDelta: { x: 0, y: 0 },
      previewStartTime: null as number | null,
      previewDuration: null as number | null,
      zoomLevel: 1,
      originalClipStart: 0,
      originalClipEnd: 0,
      originalMediaDuration: 0,
    })),
  },
}).createMachine({
  id: 'drag',
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        POINTER_DOWN: {
          target: 'detecting',
          actions: 'capturePointerDown',
        },
      },
    },

    detecting: {
      on: {
        POINTER_MOVE: [
          {
            guard: 'exceedsThreshold',
            target: 'routeByInteraction',
          },
          // Stays in detecting if within threshold (implicit — no transition)
        ],
        POINTER_UP: {
          // Did not exceed threshold → treat as a click, go back to idle
          target: 'idle',
          actions: 'resetContext',
        },
        ESCAPE: {
          target: 'idle',
          actions: 'resetContext',
        },
      },
    },

    // Intermediate routing state — immediately transitions based on interaction type.
    routeByInteraction: {
      always: [
        {
          guard: ({ context }) => context.interactionType === 'move',
          target: 'dragging',
        },
        {
          guard: ({ context }) => context.interactionType === 'resize-start',
          target: 'resizingStart',
        },
        {
          guard: ({ context }) => context.interactionType === 'resize-end',
          target: 'resizingEnd',
        },
        {
          // Fallback — should not happen, but go idle as a safety measure
          target: 'idle',
          actions: 'resetContext',
        },
      ],
    },

    dragging: {
      on: {
        POINTER_MOVE: {
          target: 'previewing',
          actions: 'calculateMovePreview',
        },
        POINTER_UP: {
          target: 'committed',
        },
        ESCAPE: {
          target: 'idle',
          actions: ['restoreOriginal', 'resetContext'],
        },
      },
    },

    previewing: {
      on: {
        PREVIEW_APPLIED: {
          target: 'dragging',
        },
        POINTER_MOVE: {
          // Allow direct POINTER_MOVE in previewing to handle rapid movement
          // without waiting for PREVIEW_APPLIED (UI can throttle sends)
          actions: 'calculateMovePreview',
        },
        POINTER_UP: {
          target: 'committed',
        },
        ESCAPE: {
          target: 'idle',
          actions: ['restoreOriginal', 'resetContext'],
        },
      },
    },

    resizingStart: {
      on: {
        POINTER_MOVE: {
          target: 'resizePreviewing',
          actions: 'calculateResizeStartPreview',
        },
        POINTER_UP: {
          target: 'committed',
        },
        ESCAPE: {
          target: 'idle',
          actions: ['restoreOriginal', 'resetContext'],
        },
      },
    },

    resizingEnd: {
      on: {
        POINTER_MOVE: {
          target: 'resizePreviewing',
          actions: 'calculateResizeEndPreview',
        },
        POINTER_UP: {
          target: 'committed',
        },
        ESCAPE: {
          target: 'idle',
          actions: ['restoreOriginal', 'resetContext'],
        },
      },
    },

    resizePreviewing: {
      on: {
        PREVIEW_APPLIED: [
          {
            guard: ({ context }) => context.interactionType === 'resize-start',
            target: 'resizingStart',
          },
          {
            guard: ({ context }) => context.interactionType === 'resize-end',
            target: 'resizingEnd',
          },
        ],
        POINTER_MOVE: [
          {
            guard: ({ context }) => context.interactionType === 'resize-start',
            actions: 'calculateResizeStartPreview',
          },
          {
            guard: ({ context }) => context.interactionType === 'resize-end',
            actions: 'calculateResizeEndPreview',
          },
        ],
        POINTER_UP: {
          target: 'committed',
        },
        ESCAPE: {
          target: 'idle',
          actions: ['restoreOriginal', 'resetContext'],
        },
      },
    },

    committed: {
      on: {
        COMMIT_COMPLETE: {
          target: 'idle',
          actions: 'resetContext',
        },
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Type exports for consumers (Zustand dragSlice, UI layer)
// ---------------------------------------------------------------------------

/** The type of a snapshot from the drag machine. */
export type DragSnapshot = SnapshotFrom<typeof dragMachine>;

/** Helper to create and start a drag machine actor. */
export function createDragActor() {
  return createActor(dragMachine);
}

// ---------------------------------------------------------------------------
// Convenience query functions on a snapshot
// ---------------------------------------------------------------------------

/** Whether the machine is in any active drag state (not idle/committed). */
export function isDragging(snapshot: DragSnapshot): boolean {
  return snapshot.matches('dragging') || snapshot.matches('previewing');
}

/** Whether the machine is in any resize state. */
export function isResizing(snapshot: DragSnapshot): boolean {
  return (
    snapshot.matches('resizingStart') ||
    snapshot.matches('resizingEnd') ||
    snapshot.matches('resizePreviewing')
  );
}

/** Whether there is any active interaction (drag or resize). */
export function isActive(snapshot: DragSnapshot): boolean {
  return !snapshot.matches('idle') && !snapshot.matches('committed');
}

/** Whether the machine is in any non-idle state (including detecting). */
export function isInteracting(snapshot: DragSnapshot): boolean {
  return !snapshot.matches('idle');
}

/** Whether the machine is in the committed state (awaiting store commit). */
export function isCommitted(snapshot: DragSnapshot): boolean {
  return snapshot.matches('committed');
}

/** Extract the current drag preview from the snapshot, or null. */
export function getDragPreview(
  snapshot: DragSnapshot
): { itemId: string; startTime: number; duration: number; targetTrackId: string | null } | null {
  const ctx = snapshot.context;
  if (
    ctx.itemId != null &&
    ctx.previewStartTime != null &&
    ctx.previewDuration != null
  ) {
    return {
      itemId: ctx.itemId,
      startTime: ctx.previewStartTime,
      duration: ctx.previewDuration,
      targetTrackId: ctx.targetTrackId,
    };
  }
  return null;
}
