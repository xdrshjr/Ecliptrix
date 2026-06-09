/**
 * TimelineItem Entity
 *
 * Represents a single clip (video, audio, or subtitle) placed on a track.
 * Identified by a unique id. Mutable internally but only through explicit
 * methods that enforce invariants.
 *
 * Invariants:
 * - startTime >= 0
 * - duration > 0
 * - opacity in [0, 1]
 */

import { TimePosition } from '../value-objects/TimePosition';
import { Duration } from '../value-objects/Duration';
import { Volume } from '../value-objects/Volume';
import type {
  TrackType,
  TimelineItemData,
  CreateItemProps,
  SubtitleStyle,
  ImagePosition,
  AudioSentenceSegment,
  MaterialType,
} from '../types';

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

function generateItemId(): string {
  return `item-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

// ---------------------------------------------------------------------------
// Default color assignment by item type
// ---------------------------------------------------------------------------

function getDefaultColor(type: TrackType): string {
  switch (type) {
    case 'video':
      return '#4A90D9';
    case 'audio':
      return '#27AE60';
    case 'subtitle':
      return '#E67E22';
    default:
      return '#4A90D9';
  }
}

// ---------------------------------------------------------------------------
// TimelineItem entity
// ---------------------------------------------------------------------------

export class TimelineItem {
  // Identity
  readonly id: string;

  // Core properties
  private _name: string;
  private _type: TrackType;
  private _startTime: TimePosition;
  private _duration: Duration;
  private _trackId: string;
  private _color: string;

  // Material association
  private _materialId?: string;
  private _url?: string;
  private _serverUrl?: string;
  private _cacheUrl?: string;
  private _storageKey?: string;
  private _metadata?: TimelineItemData['metadata'];

  // Clip info
  private _clipStart?: TimePosition;
  private _clipEnd?: TimePosition;
  private _originalDuration?: Duration;

  // Media-specific properties
  private _thumbnailUrl?: string;
  private _waveformData?: number[];
  private _text?: string;
  private _subtitleStyle?: SubtitleStyle;
  private _imagePosition?: ImagePosition;
  private _sentenceSegments?: AudioSentenceSegment;

  // Effect properties
  private _volume: Volume;
  private _opacity: number;

  // Original material type (for distinguishing image items on video tracks)
  private _originalMaterialType?: MaterialType;

  // Whether this video item's embedded audio has been detached to an
  // independent audio track item. When true, composition/export must NOT let
  // this video item contribute audio (the derived audio item does instead),
  // avoiding double-audio. See spec 01 §2.4.
  private _audioDetached?: boolean;

  // ------------------------------------------------------------------
  // Construction (private — use factory methods)
  // ------------------------------------------------------------------

  private constructor(params: {
    id: string;
    name: string;
    type: TrackType;
    startTime: TimePosition;
    duration: Duration;
    trackId: string;
    color: string;
    materialId?: string;
    url?: string;
    serverUrl?: string;
    cacheUrl?: string;
    storageKey?: string;
    metadata?: TimelineItemData['metadata'];
    clipStart?: TimePosition;
    clipEnd?: TimePosition;
    originalDuration?: Duration;
    thumbnailUrl?: string;
    waveformData?: number[];
    text?: string;
    subtitleStyle?: SubtitleStyle;
    imagePosition?: ImagePosition;
    sentenceSegments?: AudioSentenceSegment;
    volume: Volume;
    opacity: number;
    originalMaterialType?: MaterialType;
    audioDetached?: boolean;
  }) {
    this.id = params.id;
    this._name = params.name;
    this._type = params.type;
    this._startTime = params.startTime;
    this._duration = params.duration;
    this._trackId = params.trackId;
    this._color = params.color;
    this._materialId = params.materialId;
    this._url = params.url;
    this._serverUrl = params.serverUrl;
    this._cacheUrl = params.cacheUrl;
    this._storageKey = params.storageKey;
    this._metadata = params.metadata;
    this._clipStart = params.clipStart;
    this._clipEnd = params.clipEnd;
    this._originalDuration = params.originalDuration;
    this._thumbnailUrl = params.thumbnailUrl;
    this._waveformData = params.waveformData;
    this._text = params.text;
    this._subtitleStyle = params.subtitleStyle;
    this._imagePosition = params.imagePosition;
    this._sentenceSegments = params.sentenceSegments;
    this._volume = params.volume;
    this._opacity = Math.min(1, Math.max(0, params.opacity));
    this._originalMaterialType = params.originalMaterialType;
    this._audioDetached = params.audioDetached;
  }

  // ------------------------------------------------------------------
  // Property accessors
  // ------------------------------------------------------------------

  get name(): string { return this._name; }
  set name(value: string) { this._name = value; }

  get type(): TrackType { return this._type; }

  get startTime(): TimePosition { return this._startTime; }

  get duration(): Duration { return this._duration; }

  get trackId(): string { return this._trackId; }
  set trackId(value: string) { this._trackId = value; }

  get color(): string { return this._color; }
  set color(value: string) { this._color = value; }

  get materialId(): string | undefined { return this._materialId; }
  get url(): string | undefined { return this._url; }
  get serverUrl(): string | undefined { return this._serverUrl; }
  get cacheUrl(): string | undefined { return this._cacheUrl; }
  get storageKey(): string | undefined { return this._storageKey; }
  get metadata(): TimelineItemData['metadata'] | undefined { return this._metadata; }

  get clipStart(): TimePosition | undefined { return this._clipStart; }
  get clipEnd(): TimePosition | undefined { return this._clipEnd; }
  get originalDuration(): Duration | undefined { return this._originalDuration; }

  get thumbnailUrl(): string | undefined { return this._thumbnailUrl; }
  set thumbnailUrl(value: string | undefined) { this._thumbnailUrl = value; }

  get waveformData(): number[] | undefined { return this._waveformData; }
  set waveformData(value: number[] | undefined) { this._waveformData = value; }

  get text(): string | undefined { return this._text; }
  set text(value: string | undefined) { this._text = value; }

  get subtitleStyle(): SubtitleStyle | undefined { return this._subtitleStyle; }
  set subtitleStyle(value: SubtitleStyle | undefined) { this._subtitleStyle = value; }

  get imagePosition(): ImagePosition | undefined { return this._imagePosition; }
  set imagePosition(value: ImagePosition | undefined) { this._imagePosition = value; }

  get sentenceSegments(): AudioSentenceSegment | undefined { return this._sentenceSegments; }
  set sentenceSegments(value: AudioSentenceSegment | undefined) { this._sentenceSegments = value; }

  get volume(): Volume { return this._volume; }

  get opacity(): number { return this._opacity; }
  set opacity(value: number) { this._opacity = Math.min(1, Math.max(0, value)); }

  get originalMaterialType(): MaterialType | undefined { return this._originalMaterialType; }

  get audioDetached(): boolean | undefined { return this._audioDetached; }
  set audioDetached(value: boolean | undefined) { this._audioDetached = value; }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a new TimelineItem with auto-generated ID (unless provided).
   */
  static create(props: CreateItemProps): TimelineItem {
    return new TimelineItem({
      id: props.id ?? generateItemId(),
      name: props.name,
      type: props.type,
      startTime: TimePosition.create(props.startTime ?? 0),
      duration: props.duration != null && props.duration > 0
        ? Duration.create(props.duration)
        : Duration.default(),
      trackId: props.trackId,
      color: props.color ?? getDefaultColor(props.type),
      materialId: props.materialId,
      url: props.url,
      serverUrl: props.serverUrl,
      cacheUrl: props.cacheUrl,
      storageKey: props.storageKey,
      metadata: props.metadata,
      clipStart: props.clipStart != null ? TimePosition.create(props.clipStart) : undefined,
      clipEnd: props.clipEnd != null ? TimePosition.create(props.clipEnd) : undefined,
      originalDuration: props.originalDuration != null && props.originalDuration > 0
        ? Duration.create(props.originalDuration)
        : undefined,
      thumbnailUrl: props.thumbnailUrl,
      waveformData: props.waveformData,
      text: props.text,
      subtitleStyle: props.subtitleStyle,
      imagePosition: props.imagePosition,
      sentenceSegments: props.sentenceSegments,
      volume: props.volume != null ? Volume.create(props.volume) : Volume.default(),
      opacity: props.opacity ?? 1.0,
      originalMaterialType: props.originalMaterialType,
      audioDetached: props.audioDetached,
    });
  }

  /**
   * Reconstruct a TimelineItem from a plain data object (e.g. from JSON).
   * Accepts the same shape as the existing `TimelineItem` interface in
   * src/types/index.ts.
   */
  static fromPlainObject(data: TimelineItemData): TimelineItem {
    return new TimelineItem({
      id: data.id,
      name: data.name,
      type: data.type,
      startTime: TimePosition.create(data.startTime),
      duration: data.duration > 0 ? Duration.create(data.duration) : Duration.default(),
      trackId: data.trackId,
      color: data.color,
      materialId: data.materialId,
      url: data.url,
      serverUrl: data.serverUrl,
      cacheUrl: data.cacheUrl,
      storageKey: data.storageKey,
      metadata: data.metadata,
      clipStart: data.clipStart != null ? TimePosition.create(data.clipStart) : undefined,
      clipEnd: data.clipEnd != null ? TimePosition.create(data.clipEnd) : undefined,
      originalDuration: data.originalDuration != null && data.originalDuration > 0
        ? Duration.create(data.originalDuration)
        : undefined,
      thumbnailUrl: data.thumbnailUrl,
      waveformData: data.waveformData,
      text: data.text,
      subtitleStyle: data.subtitleStyle,
      imagePosition: data.imagePosition,
      sentenceSegments: data.sentenceSegments,
      volume: data.volume != null ? Volume.create(data.volume) : Volume.default(),
      opacity: data.opacity ?? 1.0,
      originalMaterialType: data.originalMaterialType,
      audioDetached: data.audioDetached,
    });
  }

  // ------------------------------------------------------------------
  // Instance methods
  // ------------------------------------------------------------------

  /**
   * Compute the end time of this item (startTime + duration).
   */
  endTime(): TimePosition {
    return this._startTime.add(this._duration);
  }

  /**
   * Move this item to a new start position.
   * @param position Must be >= 0 (enforced by TimePosition).
   */
  moveTo(position: TimePosition): void {
    this._startTime = position;
  }

  /**
   * Resize this item by moving one of its edges. A resize is a TRIM of the
   * underlying source interval, not a stretch — so the clip interval and the
   * track duration are kept in exact lock-step (INV-3: duration ===
   * clipEnd - clipStart). The opposite source edge stays pinned; only the
   * dragged edge's source offset moves by the same delta as the track edge.
   *
   * - 'start' edge: shifts startTime + clipStart by the same delta, pinning
   *   clipEnd. New duration = clipEnd - newClipStart.
   * - 'end'   edge: shifts duration + clipEnd by the same delta, pinning
   *   clipStart. New duration = newClipEnd - clipStart.
   *
   * The dragged source edge is clamped into [0, originalDuration] (when known)
   * so the trim never reads past the media; the track duration is recomputed
   * from the clamped clip interval to preserve INV-3.
   *
   * @throws if the resize would produce a non-positive duration.
   */
  resize(edge: 'start' | 'end', newPosition: TimePosition): void {
    if (edge === 'start') {
      const currentEnd = this.endTime();
      if (newPosition.value >= currentEnd.value) {
        throw new Error(
          `TimelineItem.resize: new start (${newPosition.value}) must be before current end (${currentEnd.value})`
        );
      }
      this.resizeStartEdge(newPosition, currentEnd);
    } else {
      if (newPosition.value <= this._startTime.value) {
        throw new Error(
          `TimelineItem.resize: new end (${newPosition.value}) must be after start (${this._startTime.value})`
        );
      }
      this.resizeEndEdge(newPosition);
    }
  }

  /**
   * Trim the start (in-point) edge. Keeps clipEnd pinned and slides clipStart
   * by the same delta as startTime, then derives duration from the clip
   * interval so INV-3 holds exactly.
   */
  private resizeStartEdge(newPosition: TimePosition, currentEnd: TimePosition): void {
    const timeDelta = newPosition.value - this._startTime.value;

    if (this._clipStart != null) {
      const upperBound = this._clipEnd?.value ?? Number.POSITIVE_INFINITY;
      const newClipStart = Math.min(
        Math.max(0, this._clipStart.value + timeDelta),
        upperBound,
      );
      this._clipStart = TimePosition.create(newClipStart);
      const clipEndValue = this._clipEnd?.value ?? newClipStart + (currentEnd.value - newPosition.value);
      this._startTime = newPosition;
      this._duration = Duration.create(clipEndValue - newClipStart);
      return;
    }

    // No clip info: duration follows the track edges directly.
    this._startTime = newPosition;
    this._duration = Duration.fromRange(newPosition, currentEnd);
  }

  /**
   * Trim the end (out-point) edge. Keeps clipStart pinned and slides clipEnd
   * by the same delta as the track end, then derives duration from the clip
   * interval so INV-3 holds exactly.
   */
  private resizeEndEdge(newPosition: TimePosition): void {
    const timeDelta = newPosition.value - this.endTime().value;

    if (this._clipEnd != null) {
      const clipStartValue = this._clipStart?.value ?? 0;
      const upperBound = this._originalDuration?.value ?? Number.POSITIVE_INFINITY;
      const newClipEnd = Math.min(
        Math.max(clipStartValue, this._clipEnd.value + timeDelta),
        upperBound,
      );
      this._clipEnd = TimePosition.create(newClipEnd);
      this._duration = Duration.create(newClipEnd - clipStartValue);
      return;
    }

    // No clip info: duration follows the track edges directly.
    this._duration = Duration.fromRange(this._startTime, newPosition);
  }

  /**
   * Update the item-level volume.
   */
  updateVolume(volume: Volume): void {
    this._volume = volume;
  }

  /**
   * Check whether this item's time range overlaps with another item.
   * Two items overlap if their intervals (startTime, endTime) share any
   * non-zero-length overlap.
   */
  overlaps(other: TimelineItem): boolean {
    const thisEnd = this.endTime().value;
    const otherEnd = other.endTime().value;
    return this._startTime.value < otherEnd && other._startTime.value < thisEnd;
  }

  /**
   * Check whether a given time position falls within this item's range
   * [startTime, endTime).
   */
  contains(position: TimePosition): boolean {
    return position.value >= this._startTime.value && position.value < this.endTime().value;
  }

  /**
   * Create a deep clone of this item with the same ID.
   */
  clone(): TimelineItem {
    return TimelineItem.fromPlainObject(this.toPlainObject());
  }

  /**
   * Serialize to a plain object compatible with the existing
   * `TimelineItem` interface in src/types/index.ts.
   */
  toPlainObject(): TimelineItemData {
    const data: TimelineItemData = {
      id: this.id,
      name: this._name,
      type: this._type,
      startTime: this._startTime.value,
      duration: this._duration.value,
      trackId: this._trackId,
      color: this._color,
    };

    // Optional fields — only include when present
    if (this._materialId != null) data.materialId = this._materialId;
    if (this._url != null) data.url = this._url;
    if (this._serverUrl != null) data.serverUrl = this._serverUrl;
    if (this._cacheUrl != null) data.cacheUrl = this._cacheUrl;
    if (this._storageKey != null) data.storageKey = this._storageKey;
    if (this._metadata != null) data.metadata = this._metadata;
    if (this._clipStart != null) data.clipStart = this._clipStart.value;
    if (this._clipEnd != null) data.clipEnd = this._clipEnd.value;
    if (this._originalDuration != null) data.originalDuration = this._originalDuration.value;
    if (this._thumbnailUrl != null) data.thumbnailUrl = this._thumbnailUrl;
    if (this._waveformData != null) data.waveformData = this._waveformData;
    if (this._text != null) data.text = this._text;
    if (this._subtitleStyle != null) data.subtitleStyle = this._subtitleStyle;
    if (this._imagePosition != null) data.imagePosition = this._imagePosition;
    if (this._sentenceSegments != null) data.sentenceSegments = this._sentenceSegments;
    if (this._volume.value !== 1.0) data.volume = this._volume.value;
    if (this._opacity !== 1.0) data.opacity = this._opacity;
    if (this._originalMaterialType != null) data.originalMaterialType = this._originalMaterialType;
    if (this._audioDetached != null) data.audioDetached = this._audioDetached;

    return data;
  }

  /** String representation for debugging. */
  toString(): string {
    return `TimelineItem(${this.id}, ${this._type}, ${this._startTime.value}-${this.endTime().value}s)`;
  }
}
