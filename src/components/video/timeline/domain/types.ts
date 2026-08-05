/**
 * Domain Layer Type Definitions
 *
 * These types define the plain-object data transfer shapes used for
 * serialization, deserialization, and cross-layer communication.
 * They are intentionally compatible with the existing interfaces in
 * src/types/index.ts so that toPlainObject() output can be consumed
 * by legacy code without any adapter.
 */

// Re-export existing supporting types from the central types file so
// that domain consumers do not need a separate import.
import type {
  SubtitleStyle,
  ImagePosition,
  AudioSentenceSegment,
  MaterialType,
  MaterialItem,
  CameraMotion,
} from '@/types';

export type { SubtitleStyle, ImagePosition, AudioSentenceSegment, MaterialType, CameraMotion };

/**
 * Alias used by the domain DTO layer for the camera-motion payload
 * (camera-motion-2d-3d §5.1). Structurally identical to `CameraMotion` in
 * src/types/index.ts — the alias only keeps the DTO naming consistent with the
 * other `*Data` shapes in this file.
 */
export type CameraMotionData = CameraMotion;

// ---------------------------------------------------------------------------
// TrackType union (also defined as a value-object class, but the raw literal
// union is needed for plain-object shapes).
// ---------------------------------------------------------------------------

/** The three supported track types. */
export type TrackType = 'video' | 'audio' | 'subtitle';

// ---------------------------------------------------------------------------
// Plain-object data shapes (DTOs)
// ---------------------------------------------------------------------------

/**
 * Serialized form of a TimelineItem entity.
 * Structurally identical to the existing `TimelineItem` interface in
 * src/types/index.ts so that consumers are unaffected.
 */
export interface TimelineItemData {
  id: string;
  name: string;
  type: TrackType;
  startTime: number;
  duration: number;
  trackId: string;
  color: string;
  materialId?: string;
  url?: string;
  serverUrl?: string;
  cacheUrl?: string;
  storageKey?: string;
  metadata?: MaterialItem['metadata'];
  clipStart?: number;
  clipEnd?: number;
  originalDuration?: number;
  thumbnailUrl?: string;
  waveformData?: number[];
  text?: string;
  subtitleStyle?: SubtitleStyle;
  imagePosition?: ImagePosition;
  sentenceSegments?: AudioSentenceSegment;
  volume?: number;
  opacity?: number;
  /** Preserved for backward compatibility with existing UI that uses this field. */
  isSelected?: boolean;
  /** Original material type — used to distinguish image items on video tracks. */
  originalMaterialType?: MaterialType;
  /**
   * Whether this video item's embedded audio has been detached to an
   * independent audio track item. When true, composition/export suppress this
   * video item's audio so the derived audio item is the sole contributor.
   */
  audioDetached?: boolean;
  /**
   * Fade-in / cross-dissolve on this clip's leading edge (spec 02 §2.4).
   * Persisted by spec 06 and transferred to the preview/export sequence;
   * preview (02) and export (05) share the transition semantics.
   */
  transitionIn?: SequenceTransitionData;
  /** Fade-out / cross-dissolve on this clip's trailing edge (spec 02 §2.4). */
  transitionOut?: SequenceTransitionData;
  /**
   * 2D / 3D camera motion for this clip (camera-motion-2d-3d §4.6). Video
   * items only; absent means "no motion" and both preview and export take
   * today's code path verbatim.
   */
  cameraMotion?: CameraMotionData;
}

/**
 * Transition metadata carried on a timeline item (preview + export share it).
 * Structurally identical to `playback/types.SequenceTransition`; redeclared
 * here so the domain DTO layer has no dependency on the playback module.
 */
export interface SequenceTransitionData {
  type: 'fade' | 'dissolve';
  duration: number;
}

/**
 * Serialized form of a Track entity.
 * Structurally identical to the existing `Track` interface in
 * src/types/index.ts.
 */
export interface TrackData {
  id: string;
  name: string;
  type: TrackType;
  height: number;
  isLocked: boolean;
  isMuted: boolean;
  isVisible: boolean;
  /** Track-level volume. Stored as 0-200 (percentage) in the plain object
   *  to match the existing `Track` interface in src/types/index.ts.
   *  Internally the Volume value-object normalizes to 0-2.0. */
  volume: number;
  items: TimelineItemData[];
  order: number;
}

/**
 * Serialized form of the entire timeline state.
 * Structurally identical to the existing `TimelineState` interface in
 * src/types/index.ts (minus `selectedItems` which lives in selectionSlice).
 */
export interface TimelineData {
  currentTime: number;
  totalDuration: number;
  zoomLevel: number;
  playbackRate: number;
  isPlaying: boolean;
  snapToGrid: boolean;
  gridSize: number;
  scrollLeft: number;
  tracks: TrackData[];
}

/**
 * A snapshot is a complete serialization of the timeline state, used for
 * undo/redo. It is structurally identical to TimelineData.
 */
export type TimelineSnapshot = TimelineData;

// ---------------------------------------------------------------------------
// MaterialData — a minimal interface describing material metadata that the
// domain layer needs when creating items. It avoids coupling the domain to
// the full MaterialItem interface.
// ---------------------------------------------------------------------------

/**
 * Minimal material metadata needed by the domain layer to create a
 * TimelineItem from external material.
 */
export interface MaterialData {
  id: string;
  name: string;
  type: MaterialType;
  duration?: number;
  thumbnailUrl?: string;
  url?: string;
  serverUrl?: string;
  cacheUrl?: string;
  storageKey?: string;
  metadata?: MaterialItem['metadata'];
  /** For TTS audio materials. */
  sentenceSegments?: AudioSentenceSegment;
}

// ---------------------------------------------------------------------------
// CreateItemProps — used by TimelineItem.create()
// ---------------------------------------------------------------------------

export interface CreateItemProps {
  /** Optional explicit ID. Auto-generated if omitted. */
  id?: string;
  name: string;
  type: TrackType;
  startTime?: number;
  duration?: number;
  trackId: string;
  color?: string;
  materialId?: string;
  url?: string;
  serverUrl?: string;
  cacheUrl?: string;
  storageKey?: string;
  metadata?: MaterialItem['metadata'];
  clipStart?: number;
  clipEnd?: number;
  originalDuration?: number;
  thumbnailUrl?: string;
  waveformData?: number[];
  text?: string;
  subtitleStyle?: SubtitleStyle;
  imagePosition?: ImagePosition;
  sentenceSegments?: AudioSentenceSegment;
  volume?: number;
  opacity?: number;
  originalMaterialType?: MaterialType;
  audioDetached?: boolean;
  transitionIn?: SequenceTransitionData;
  transitionOut?: SequenceTransitionData;
  cameraMotion?: CameraMotionData;
}

// ---------------------------------------------------------------------------
// CreateTrackProps — used by Track.create()
// ---------------------------------------------------------------------------

export interface CreateTrackProps {
  /** Optional explicit ID. Auto-generated if omitted. */
  id?: string;
  name: string;
  type: TrackType;
  height?: number;
  isLocked?: boolean;
  isMuted?: boolean;
  isVisible?: boolean;
  /** Track-level volume as percentage 0-200. Defaults to 100. */
  volume?: number;
  order?: number;
  items?: TimelineItemData[];
}
