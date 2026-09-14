/**
 * Domain Layer — Public API
 *
 * This barrel file re-exports all domain layer constructs so that
 * consumers can import from a single location:
 *
 *   import { TimelineAggregate, Track, TimelineItem, TimePosition, ... }
 *     from '@/components/video/timeline/domain';
 */

// ---------------------------------------------------------------------------
// Value Objects
// ---------------------------------------------------------------------------

export { TimePosition } from './value-objects/TimePosition';
export { Duration, MIN_CLIP_DURATION_SECONDS } from './value-objects/Duration';
export { Volume } from './value-objects/Volume';
export { ZoomLevel } from './value-objects/ZoomLevel';
export { TrackTypeUtils } from './value-objects/TrackType';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export { TimelineItem } from './entities/TimelineItem';
export { Track, TrackLockedError } from './entities/Track';

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

export { TimelineAggregate } from './aggregates/TimelineAggregate';
export type { DetachAudioResult } from './aggregates/TimelineAggregate';

// ---------------------------------------------------------------------------
// Domain Services
// ---------------------------------------------------------------------------

export { TrackSelectionService } from './services/TrackSelectionService';
export { ItemPlacementService } from './services/ItemPlacementService';
export { DragCalculationService } from './services/DragCalculationService';
export { HistoryService } from './services/HistoryService';
export { DurationCalculationService } from './services/DurationCalculationService';
export { SplitService, cutLeavesValidPieces } from './services/SplitService';
export {
  TIME_EPSILON,
  mapTimelineTimeToSourceTime,
  mapSourceTimeToTimelineTime,
} from './services/ClipTimeMapping';

// Service-related types
export type { TimelineAction } from './services/HistoryService';
export type { ClipTimeRef } from './services/ClipTimeMapping';
export type { SplitResult } from './services/SplitService';

// ---------------------------------------------------------------------------
// State Machines
// ---------------------------------------------------------------------------

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
  materialDropMachine,
  createMaterialDropActor,
  isDragOver,
  isDropped,
} from './machines';

export type {
  DragContext,
  DragSnapshot,
  InteractionType as DragInteractionType,
  PointerDownEvent,
  PointerMoveEvent,
  PointerUpEvent,
  EscapeEvent,
  PreviewAppliedEvent,
  CommitCompleteEvent,
  DragEvent,
  MaterialDropContext,
  MaterialDropSnapshot,
  DragEnterEvent,
  DragOverUpdateEvent,
  DragLeaveEvent,
  DropEvent,
  ItemCreatedEvent,
  MaterialDropEvent,
} from './machines';

// ---------------------------------------------------------------------------
// Ports (interfaces for Infrastructure adapters)
// ---------------------------------------------------------------------------

export type {
  CacheState,
  ExportMetadata,
  ITimelineRepository,
  IVideoCachePort,
  ICompositionPort,
  VideoSequenceItem,
  AudioSequenceItem,
} from './ports';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  TrackType,
  TimelineItemData,
  TrackData,
  TimelineData,
  TimelineSnapshot,
  MaterialData,
  CreateItemProps,
  CreateTrackProps,
  SubtitleStyle,
  ImagePosition,
  AudioSentenceSegment,
  MaterialType,
  CameraMotion,
  CameraMotionData,
} from './types';
