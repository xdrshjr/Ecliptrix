/**
 * Machines — Public API
 *
 * Re-exports all state machine definitions and helper utilities.
 */

// Drag state machine
export {
  dragMachine,
  createDragActor,
  isDragging,
  isResizing,
  isActive,
  isInteracting,
  isCommitted,
  getDragPreview,
  detectInteractionType,
  edgeHandleWidthPx,
  MIN_MOVE_ZONE_PX,
} from './dragMachine';

export type {
  DragContext,
  DragSnapshot,
  InteractionType,
  PointerDownEvent,
  PointerMoveEvent,
  PointerUpEvent,
  EscapeEvent,
  PreviewAppliedEvent,
  CommitCompleteEvent,
  DragEvent,
} from './dragMachine';

// Material drop state machine
export {
  materialDropMachine,
  createMaterialDropActor,
  isDragOver,
  isDropped,
} from './materialDropMachine';

export type {
  MaterialDropContext,
  MaterialDropSnapshot,
  DragEnterEvent,
  DragOverUpdateEvent,
  DragLeaveEvent,
  DropEvent,
  ItemCreatedEvent,
  MaterialDropEvent,
} from './materialDropMachine';
