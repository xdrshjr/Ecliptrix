/**
 * Track Entity
 *
 * Represents a single track (video, audio, or subtitle) on the timeline.
 * Identified by a unique id. Contains an ordered collection of TimelineItems.
 *
 * Invariants:
 * - When isLocked is true, all mutation methods throw an error.
 * - Items are kept sorted by startTime.
 * - addItem validates material-type compatibility (including image-track rule).
 */

import { TimelineItem } from './TimelineItem';
import { TimePosition } from '../value-objects/TimePosition';
import { Volume } from '../value-objects/Volume';
import { TrackTypeUtils } from '../value-objects/TrackType';
import type { TrackType, TrackData, CreateTrackProps } from '../types';

// ---------------------------------------------------------------------------
// Error class for locked-track violations
// ---------------------------------------------------------------------------

export class TrackLockedError extends Error {
  constructor(trackId: string, operation: string) {
    super(`Track "${trackId}" is locked — cannot perform "${operation}".`);
    this.name = 'TrackLockedError';
  }
}

// ---------------------------------------------------------------------------
// Track Entity
// ---------------------------------------------------------------------------

export class Track {
  // Identity
  readonly id: string;

  // Properties
  private _name: string;
  private _type: TrackType;
  private _height: number;
  private _isLocked: boolean;
  private _isMuted: boolean;
  private _isVisible: boolean;
  private _volume: Volume;
  private _items: TimelineItem[];
  private _order: number;

  // ------------------------------------------------------------------
  // Construction (private — use factory methods)
  // ------------------------------------------------------------------

  private constructor(params: {
    id: string;
    name: string;
    type: TrackType;
    height: number;
    isLocked: boolean;
    isMuted: boolean;
    isVisible: boolean;
    volume: Volume;
    items: TimelineItem[];
    order: number;
  }) {
    this.id = params.id;
    this._name = params.name;
    this._type = params.type;
    this._height = params.height;
    this._isLocked = params.isLocked;
    this._isMuted = params.isMuted;
    this._isVisible = params.isVisible;
    this._volume = params.volume;
    this._items = params.items;
    this._order = params.order;
    // Ensure items are sorted on construction
    this.sortItems();
  }

  // ------------------------------------------------------------------
  // Property accessors
  // ------------------------------------------------------------------

  get name(): string { return this._name; }
  set name(value: string) {
    this.assertNotLocked('set name');
    this._name = value;
  }

  get type(): TrackType { return this._type; }

  get height(): number { return this._height; }
  set height(value: number) {
    this.assertNotLocked('set height');
    this._height = Math.max(32, Math.min(80, value));
  }

  get isLocked(): boolean { return this._isLocked; }
  get isMuted(): boolean { return this._isMuted; }
  get isVisible(): boolean { return this._isVisible; }

  get volume(): Volume { return this._volume; }

  /** Read-only snapshot of the items array. Consumers must not mutate. */
  get items(): ReadonlyArray<TimelineItem> { return this._items; }

  get order(): number { return this._order; }
  set order(value: number) { this._order = value; }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a new Track.
   */
  static create(props: CreateTrackProps): Track {
    const type = props.type;
    const defaultHeight = TrackTypeUtils.getDefaultHeight(type);

    return new Track({
      id: props.id ?? `${type}-track-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name: props.name,
      type,
      height: props.height ?? defaultHeight,
      isLocked: props.isLocked ?? false,
      isMuted: props.isMuted ?? false,
      isVisible: props.isVisible ?? true,
      volume: props.volume != null ? Volume.fromPercentage(props.volume) : Volume.default(),
      items: props.items ? props.items.map(d => TimelineItem.fromPlainObject(d)) : [],
      order: props.order ?? 0,
    });
  }

  /**
   * Reconstruct a Track from a plain data object.
   * Accepts the same shape as the existing `Track` interface in
   * src/types/index.ts.
   */
  static fromPlainObject(data: TrackData): Track {
    // Back-compat: JSON exported with the "image" alias maps back to
    // internal type 'video' (image-tracks are video-tracks distinguished
    // by the 'image-track' id prefix).
    const internalType: TrackType =
      (data.type as string) === 'image' ? 'video' : data.type;
    return new Track({
      id: data.id,
      name: data.name,
      type: internalType,
      height: data.height ?? TrackTypeUtils.getDefaultHeight(internalType),
      isLocked: data.isLocked ?? false,
      isMuted: data.isMuted ?? false,
      isVisible: data.isVisible ?? true,
      // Existing Track interface stores volume as 0-200 (percentage)
      volume: Volume.fromPercentage(data.volume ?? 100),
      items: data.items.map(d => TimelineItem.fromPlainObject(d)),
      order: data.order ?? 0,
    });
  }

  // ------------------------------------------------------------------
  // Mutation methods
  // ------------------------------------------------------------------

  /**
   * Add an item to this track.
   * Validates type compatibility (including image-track special rule).
   * @throws TrackLockedError if the track is locked.
   * @throws Error if the item's type is not compatible with this track.
   */
  addItem(item: TimelineItem): void {
    this.assertNotLocked('addItem');

    // Determine the material type for compatibility checking.
    // If the item has an originalMaterialType (e.g. 'image'), use that.
    // Otherwise fall back to the item's type.
    const materialType = item.originalMaterialType ?? item.type;
    if (!this.canAcceptMaterial(materialType)) {
      throw new Error(
        `Track "${this.id}" (type=${this._type}) cannot accept material of type "${materialType}".`
      );
    }

    // Update the item's trackId to this track
    item.trackId = this.id;

    this._items.push(item);
    this.sortItems();
  }

  /**
   * Remove an item by ID. Returns the removed item, or null if not found.
   * @throws TrackLockedError if the track is locked.
   */
  removeItem(itemId: string): TimelineItem | null {
    this.assertNotLocked('removeItem');
    const index = this._items.findIndex(i => i.id === itemId);
    if (index === -1) return null;
    const [removed] = this._items.splice(index, 1);
    return removed;
  }

  /**
   * Find an item by ID. Returns null if not found.
   */
  findItem(itemId: string): TimelineItem | null {
    return this._items.find(i => i.id === itemId) ?? null;
  }

  /**
   * Find the item at a given time position (the first item whose range
   * contains the position). Returns null if no item occupies that time.
   */
  getItemAt(position: TimePosition): TimelineItem | null {
    return this._items.find(i => i.contains(position)) ?? null;
  }

  /**
   * Get the last item on the track (by start time), or null if empty.
   */
  getLastItem(): TimelineItem | null {
    if (this._items.length === 0) return null;
    return this._items[this._items.length - 1];
  }

  /**
   * Get the next available start position (i.e. the end time of the last item,
   * or time 0 if the track is empty).
   */
  getNextAvailablePosition(): TimePosition {
    const last = this.getLastItem();
    if (!last) return TimePosition.zero();
    return last.endTime();
  }

  /**
   * Check whether this track can accept a material of the given type.
   * Uses TrackTypeUtils.canAcceptMaterial which implements the image-track rule.
   */
  canAcceptMaterial(materialType: string): boolean {
    return TrackTypeUtils.canAcceptMaterial(this._type, materialType, this.id);
  }

  /**
   * Toggle the locked state.
   * Note: this is the one mutation allowed even when locked (to unlock).
   */
  toggleLock(): void {
    this._isLocked = !this._isLocked;
  }

  /**
   * Toggle the muted state.
   * @throws TrackLockedError if the track is locked.
   */
  toggleMute(): void {
    this.assertNotLocked('toggleMute');
    this._isMuted = !this._isMuted;
  }

  /**
   * Toggle the visibility state.
   * @throws TrackLockedError if the track is locked.
   */
  toggleVisibility(): void {
    this.assertNotLocked('toggleVisibility');
    this._isVisible = !this._isVisible;
  }

  /**
   * Set the track-level volume.
   * @throws TrackLockedError if the track is locked.
   */
  setVolume(volume: Volume): void {
    this.assertNotLocked('setVolume');
    this._volume = volume;
  }

  /**
   * Get the end time of this track (the end time of the last item,
   * or time 0 if empty).
   */
  getEndTime(): TimePosition {
    return this.getNextAvailablePosition();
  }

  /**
   * Sort items by startTime (ascending). Called internally after mutations.
   */
  sortItems(): void {
    this._items.sort((a, b) => a.startTime.value - b.startTime.value);
  }

  /**
   * Create a deep clone of this track (all items are cloned).
   */
  clone(): Track {
    return Track.fromPlainObject(this.toPlainObject());
  }

  /**
   * Serialize to a plain object compatible with the existing `Track`
   * interface in src/types/index.ts.
   */
  toPlainObject(): TrackData {
    return {
      id: this.id,
      name: this._name,
      type: this._type,
      height: this._height,
      isLocked: this._isLocked,
      isMuted: this._isMuted,
      isVisible: this._isVisible,
      // Convert Volume value-object back to 0-200 percentage
      volume: this._volume.toPercentage(),
      items: this._items.map(item => item.toPlainObject()),
      order: this._order,
    };
  }

  /** String representation for debugging. */
  toString(): string {
    return `Track(${this.id}, ${this._type}, ${this._items.length} items)`;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Guard: throws TrackLockedError if the track is locked.
   */
  private assertNotLocked(operation: string): void {
    if (this._isLocked) {
      throw new TrackLockedError(this.id, operation);
    }
  }
}
