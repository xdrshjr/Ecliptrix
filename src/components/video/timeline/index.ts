/**
 * Timeline Module — Public API
 *
 * This barrel file provides a clean public interface for the timeline module,
 * exporting components, domain layer, store, and infrastructure adapters.
 *
 * Usage examples:
 *   import { TimelinePanel, TimelineAggregate, useTimelineStore }
 *     from '@/components/video/timeline';
 */

// ---------------------------------------------------------------------------
// UI Components
// ---------------------------------------------------------------------------

export { default as TimelinePanel } from './TimelinePanel';
export { default as TimelineToolbar } from './TimelineToolbar';
export { default as TimelineRuler } from './TimelineRuler';
export { default as TrackContainer } from './TrackContainer';
export { default as Track } from './Track';
export { default as TimelineItem } from './TimelineItem';

// ---------------------------------------------------------------------------
// Domain Layer (value objects, entities, aggregates, services, machines)
// ---------------------------------------------------------------------------

export {
  // Value Objects
  TimePosition,
  Duration,
  Volume,
  ZoomLevel,
  TrackTypeUtils,
  // Entities
  TimelineItem as TimelineItemEntity,
  Track as TrackEntity,
  TrackLockedError,
  // Aggregates
  TimelineAggregate,
  // Domain Services
  TrackSelectionService,
  ItemPlacementService,
  DragCalculationService,
  HistoryService,
  DurationCalculationService,
  // State Machines
  dragMachine,
  createDragActor,
  isDragging,
  isResizing,
  isActive,
  isCommitted,
  getDragPreview,
  materialDropMachine,
  createMaterialDropActor,
  isDragOver,
  isDropped,
} from './domain';

export type {
  // Domain Types
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
  // Port interfaces
  CacheState,
  ExportMetadata,
  ITimelineRepository,
  IVideoCachePort,
  ICompositionPort,
  VideoSequenceItem,
  AudioSequenceItem,
  // Service types
  ResizeResult,
  InteractionType,
  TimelineAction,
  // Machine types
  DragContext,
  DragSnapshot,
  DragInteractionType,
  MaterialDropContext,
  MaterialDropSnapshot,
} from './domain';

// ---------------------------------------------------------------------------
// Store (Zustand-based state management)
// ---------------------------------------------------------------------------

export {
  useTimelineStore,
  // Orchestrated actions
  addItemAction,
  moveItemAction,
  resizeItemAction,
  removeItemAction,
  removeItemsAction,
  toggleTrackLockAction,
  toggleTrackMuteAction,
  toggleTrackVisibilityAction,
  setTrackVolumeAction,
  setTrackVolumePreviewAction,
  commitTrackVolumeAction,
  undoAction,
  redoAction,
  clearHistoryAction,
  // Utility re-export
  shallow,
} from './store';

export type {
  TimelineStore,
  TimelineSlice,
  SelectionSlice,
  HistorySlice,
  DragSlice,
  DragPreviewData,
  MaterialDragOverData,
  UISlice,
  VolumeSliderState,
  TimelineToolType,
} from './store';

// ---------------------------------------------------------------------------
// Infrastructure (adapters for persistence, caching, composition)
// ---------------------------------------------------------------------------

export {
  TimelineRepository,
  VideoCacheAdapter,
  CompositionAdapter,
  TimelineExportError,
  TimelineImportError,
  VideoCacheError,
} from './infrastructure';

export type {
  TimelineExportData,
  VideoCacheConfig,
  CompositionMaterialData,
} from './infrastructure';
