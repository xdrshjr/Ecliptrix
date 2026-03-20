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
  }) {
    this.id = params.id;
    this._name = params.name;
    this._type = params.type;
    this._startTime = params.startTime;
    this._duration = params.duration;
    this._trackId = params.trackId;
    this._color = params.color;
    this._materialId = params.materialId;
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
   * Resize this item by moving one of its edges.
   *
   * - 'start' edge: adjusts startTime forward/backward, shrinking/expanding
   *   the duration accordingly. Clips clipStart if present.
   * - 'end' edge: adjusts duration so the item ends at newPosition.
   *   Clips clipEnd if present.
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
      const newDuration = Duration.fromRange(newPosition, currentEnd);

      // Adjust clipStart proportionally if original clip info exists
      if (this._clipStart != null && this._originalDuration != null) {
        const timeDelta = newPosition.value - this._startTime.value;
        const newClipStartValue = this._clipStart.value + timeDelta;
        this._clipStart = TimePosition.create(Math.max(0, newClipStartValue));
      }

      this._startTime = newPosition;
      this._duration = newDuration;
    } else {
      // edge === 'end'
      if (newPosition.value <= this._startTime.value) {
        throw new Error(
          `TimelineItem.resize: new end (${newPosition.value}) must be after start (${this._startTime.value})`
        );
      }
      const newDuration = Duration.fromRange(this._startTime, newPosition);

      // Adjust clipEnd proportionally if original clip info exists
      if (this._clipEnd != null && this._originalDuration != null) {
        const timeDelta = newPosition.value - this.endTime().value;
        const newClipEndValue = this._clipEnd.value + timeDelta;
        if (this._originalDuration) {
          this._clipEnd = TimePosition.create(
            Math.min(this._originalDuration.value, Math.max(0, newClipEndValue))
          );
        }
      }

      this._duration = newDuration;
    }
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

    return data;
  }

  /** String representation for debugging. */
  toString(): string {
    return `TimelineItem(${this.id}, ${this._type}, ${this._startTime.value}-${this.endTime().value}s)`;
  }
}
