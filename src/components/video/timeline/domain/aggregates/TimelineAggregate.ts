/**
 * TimelineAggregate — Aggregate Root
 *
 * The single entry point for all state changes to the timeline.
 * All mutations go through this class, which enforces global invariants:
 *
 * 1. totalDuration always equals the maximum endTime of all items.
 * 2. Locked tracks reject mutation operations (delegated to Track entity).
 * 3. Item startTime >= 0 (enforced by TimePosition value object).
 * 4. Material type must be compatible with the target track (enforced by Track entity).
 */

import { TimelineItem } from '../entities/TimelineItem';
import { Track, TrackLockedError } from '../entities/Track';
import { TimePosition } from '../value-objects/TimePosition';
import { Duration } from '../value-objects/Duration';
import { Volume } from '../value-objects/Volume';
import { ZoomLevel } from '../value-objects/ZoomLevel';
import type {
  TrackType,
  TimelineData,
  TimelineSnapshot,
  TrackData,
  CreateTrackProps,
} from '../types';

// ---------------------------------------------------------------------------
// TimelineAggregate
// ---------------------------------------------------------------------------

export class TimelineAggregate {
  // State
  private _tracks: Track[];
  private _currentTime: TimePosition;
  private _totalDuration: Duration;
  private _zoomLevel: ZoomLevel;
  private _playbackRate: number;
  private _isPlaying: boolean;
  private _snapToGrid: boolean;
  private _gridSize: number;
  private _scrollLeft: number;

  // ------------------------------------------------------------------
  // Construction (private — use factory methods)
  // ------------------------------------------------------------------

  private constructor(params: {
    tracks: Track[];
    currentTime: TimePosition;
    totalDuration: Duration;
    zoomLevel: ZoomLevel;
    playbackRate: number;
    isPlaying: boolean;
    snapToGrid: boolean;
    gridSize: number;
    scrollLeft: number;
  }) {
    this._tracks = params.tracks;
    this._currentTime = params.currentTime;
    this._totalDuration = params.totalDuration;
    this._zoomLevel = params.zoomLevel;
    this._playbackRate = params.playbackRate;
    this._isPlaying = params.isPlaying;
    this._snapToGrid = params.snapToGrid;
    this._gridSize = params.gridSize;
    this._scrollLeft = params.scrollLeft;
  }

  // ------------------------------------------------------------------
  // Property accessors (read-only from outside)
  // ------------------------------------------------------------------

  get tracks(): ReadonlyArray<Track> { return this._tracks; }
  get currentTime(): TimePosition { return this._currentTime; }
  get totalDuration(): Duration { return this._totalDuration; }
  get zoomLevel(): ZoomLevel { return this._zoomLevel; }
  get playbackRate(): number { return this._playbackRate; }
  get isPlaying(): boolean { return this._isPlaying; }
  get snapToGrid(): boolean { return this._snapToGrid; }
  get gridSize(): number { return this._gridSize; }
  get scrollLeft(): number { return this._scrollLeft; }

  // ------------------------------------------------------------------
  // Static factory methods
  // ------------------------------------------------------------------

  /**
   * Create a new TimelineAggregate with optional initial state.
   */
  static create(initialState?: Partial<TimelineData>): TimelineAggregate {
    const tracks = initialState?.tracks
      ? initialState.tracks.map(td => Track.fromPlainObject(td))
      : [];

    const aggregate = new TimelineAggregate({
      tracks,
      currentTime: TimePosition.create(initialState?.currentTime ?? 0),
      totalDuration: Duration.create(Math.max(initialState?.totalDuration ?? 1, 0.001)),
      zoomLevel: ZoomLevel.create(initialState?.zoomLevel ?? 1.0),
      playbackRate: initialState?.playbackRate ?? 1.0,
      isPlaying: initialState?.isPlaying ?? false,
      snapToGrid: initialState?.snapToGrid ?? false,
      gridSize: initialState?.gridSize ?? 1,
      scrollLeft: initialState?.scrollLeft ?? 0,
    });

    // Recalculate total duration based on actual items
    aggregate.recalculateTotalDuration();
    return aggregate;
  }

  /**
   * Reconstruct from a complete plain-object representation.
   * Accepts the same shape as the existing `TimelineState` interface.
   */
  static fromPlainObject(data: TimelineData): TimelineAggregate {
    return TimelineAggregate.create(data);
  }

  // ------------------------------------------------------------------
  // Item operations
  // ------------------------------------------------------------------

  /**
   * Add an item to a specific track.
   * @throws Error if the track is not found.
   * @throws TrackLockedError if the track is locked.
   * @throws Error if the material type is incompatible.
   */
  addItemToTrack(trackId: string, item: TimelineItem): void {
    const track = this.findTrackOrThrow(trackId);
    track.addItem(item);
    this.recalculateTotalDuration();
  }

  /**
   * Remove an item from a specific track.
   * @returns The removed item, or null if not found.
   * @throws Error if the track is not found.
   * @throws TrackLockedError if the track is locked.
   */
  removeItemFromTrack(trackId: string, itemId: string): TimelineItem | null {
    const track = this.findTrackOrThrow(trackId);
    const removed = track.removeItem(itemId);
    if (removed) {
      this.recalculateTotalDuration();
    }
    return removed;
  }

  /**
   * Move an item to a new start time, optionally transferring it to a
   * different track.
   * @throws Error if the item is not found.
   * @throws TrackLockedError if either track is locked.
   */
  moveItem(
    itemId: string,
    newStartTime: TimePosition,
    targetTrackId?: string
  ): void {
    const found = this.findItem(itemId);
    if (!found) {
      throw new Error(`TimelineAggregate.moveItem: item "${itemId}" not found.`);
    }

    const { track: sourceTrack, item } = found;

    if (targetTrackId && targetTrackId !== sourceTrack.id) {
      // Cross-track move
      const targetTrack = this.findTrackOrThrow(targetTrackId);
      // Remove from source (validates source not locked)
      sourceTrack.removeItem(itemId);
      // Move to new time
      item.moveTo(newStartTime);
      // Add to target (validates target not locked + type compatibility)
      targetTrack.addItem(item);
    } else {
      // Same-track move — just assert the track is not locked via a guard
      if (sourceTrack.isLocked) {
        throw new TrackLockedError(sourceTrack.id, 'moveItem');
      }
      item.moveTo(newStartTime);
      sourceTrack.sortItems();
    }

    this.recalculateTotalDuration();
  }

  /**
   * Resize an item by moving one of its edges.
   * @throws Error if the item is not found.
   * @throws TrackLockedError if the track is locked.
   */
  resizeItem(
    itemId: string,
    edge: 'start' | 'end',
    newPosition: TimePosition
  ): void {
    const found = this.findItem(itemId);
    if (!found) {
      throw new Error(`TimelineAggregate.resizeItem: item "${itemId}" not found.`);
    }
    const { track, item } = found;
    if (track.isLocked) {
      throw new TrackLockedError(track.id, 'resizeItem');
    }

    item.resize(edge, newPosition);
    track.sortItems();
    this.recalculateTotalDuration();
  }

  // ------------------------------------------------------------------
  // Track operations
  // ------------------------------------------------------------------

  /**
   * Add a new track to the timeline.
   */
  addTrack(track: Track): void {
    this._tracks.push(track);
    // Keep tracks sorted by order
    this._tracks.sort((a, b) => a.order - b.order);
  }

  /**
   * Create and add a track from props.
   */
  addTrackFromProps(props: CreateTrackProps): Track {
    const track = Track.create(props);
    this.addTrack(track);
    return track;
  }

  /**
   * Remove a track by ID.
   * @throws Error if the track is not found.
   */
  removeTrack(trackId: string): void {
    const index = this._tracks.findIndex(t => t.id === trackId);
    if (index === -1) {
      throw new Error(`TimelineAggregate.removeTrack: track "${trackId}" not found.`);
    }
    this._tracks.splice(index, 1);
    this.recalculateTotalDuration();
  }

  /**
   * Reorder tracks according to the given array of track IDs.
   * Tracks not in the list are appended at the end in their current order.
   */
  reorderTracks(trackIds: string[]): void {
    const orderMap = new Map<string, number>();
    trackIds.forEach((id, idx) => orderMap.set(id, idx));

    this._tracks.forEach(track => {
      const newOrder = orderMap.get(track.id);
      if (newOrder != null) {
        track.order = newOrder;
      }
    });

    this._tracks.sort((a, b) => a.order - b.order);
  }

  /**
   * Toggle a track's locked state.
   * @throws Error if the track is not found.
   */
  toggleTrackLock(trackId: string): void {
    const track = this.findTrackOrThrow(trackId);
    track.toggleLock();
  }

  /**
   * Toggle a track's muted state.
   * @throws Error if the track is not found.
   * @throws TrackLockedError if the track is locked.
   */
  toggleTrackMute(trackId: string): void {
    const track = this.findTrackOrThrow(trackId);
    if (track.isLocked) return;
    track.toggleMute();
  }

  /**
   * Toggle a track's visibility.
   * Silently no-ops for locked tracks (UI keeps the button disabled; this is
   * the aggregate-side guard for any code path that bypasses the UI).
   */
  toggleTrackVisibility(trackId: string): void {
    const track = this.findTrackOrThrow(trackId);
    if (track.isLocked) return;
    track.toggleVisibility();
  }

  /**
   * Set a track's volume.
   * Silently no-ops for locked tracks.
   */
  setTrackVolume(trackId: string, volume: Volume): void {
    const track = this.findTrackOrThrow(trackId);
    if (track.isLocked) return;
    track.setVolume(volume);
  }

  // ------------------------------------------------------------------
  // Playback control
  // ------------------------------------------------------------------

  /** Set the current playback position. */
  setCurrentTime(time: TimePosition): void {
    this._currentTime = time;
  }

  /** Set the playback rate (e.g. 1.0 = normal, 2.0 = double speed). */
  setPlaybackRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error(`TimelineAggregate.setPlaybackRate: rate must be > 0, got ${rate}`);
    }
    this._playbackRate = rate;
  }

  /** Set the playing state. */
  setPlaying(playing: boolean): void {
    this._isPlaying = playing;
  }

  // ------------------------------------------------------------------
  // Zoom / scroll / grid
  // ------------------------------------------------------------------

  /** Set the zoom level. */
  setZoomLevel(zoom: ZoomLevel): void {
    this._zoomLevel = zoom;
  }

  /** Set the horizontal scroll offset (pixels). */
  setScrollLeft(value: number): void {
    this._scrollLeft = Math.max(0, value);
  }

  /** Enable or disable snap-to-grid. */
  setSnapToGrid(enabled: boolean): void {
    this._snapToGrid = enabled;
  }

  /** Set the grid size in seconds. */
  setGridSize(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`TimelineAggregate.setGridSize: gridSize must be > 0, got ${seconds}`);
    }
    this._gridSize = seconds;
  }

  // ------------------------------------------------------------------
  // Query methods
  // ------------------------------------------------------------------

  /** Find a track by ID. Returns null if not found. */
  findTrack(trackId: string): Track | null {
    return this._tracks.find(t => t.id === trackId) ?? null;
  }

  /**
   * Find an item across all tracks by item ID.
   * Returns the containing track and the item, or null if not found.
   */
  findItem(itemId: string): { track: Track; item: TimelineItem } | null {
    for (const track of this._tracks) {
      const item = track.findItem(itemId);
      if (item) {
        return { track, item };
      }
    }
    return null;
  }

  /** Get all tracks of a specific type. */
  getTracksOfType(type: TrackType): Track[] {
    return this._tracks.filter(t => t.type === type);
  }

  /**
   * Get all tracks that can accept a material of the given type.
   */
  getCompatibleTracks(materialType: string): Track[] {
    return this._tracks.filter(t => t.canAcceptMaterial(materialType));
  }

  /**
   * Recalculate totalDuration based on the maximum endTime across all items.
   * Called internally after any mutation that could change item timing.
   */
  calculateTotalDuration(): Duration {
    let maxEnd = 0;
    for (const track of this._tracks) {
      for (const item of track.items) {
        const end = item.endTime().value;
        if (end > maxEnd) {
          maxEnd = end;
        }
      }
    }
    // Minimum duration of 0.001 to avoid zero-duration (Duration invariant > 0)
    return Duration.create(Math.max(maxEnd, 0.001));
  }

  /**
   * Get a flat array of all items across all tracks.
   */
  getAllItems(): TimelineItem[] {
    const result: TimelineItem[] = [];
    for (const track of this._tracks) {
      for (const item of track.items) {
        result.push(item);
      }
    }
    return result;
  }

  // ------------------------------------------------------------------
  // Snapshot / Restore (for undo/redo)
  // ------------------------------------------------------------------

  /**
   * Capture a full snapshot of the timeline state.
   * The snapshot is a plain object that can be stored and later restored.
   */
  snapshot(): TimelineSnapshot {
    return this.toPlainObject();
  }

  /**
   * Restore the timeline to a previously captured snapshot.
   * This replaces all state.
   */
  restore(snapshot: TimelineSnapshot): void {
    const restored = TimelineAggregate.fromPlainObject(snapshot);
    this._tracks = [...(restored._tracks as Track[])];
    this._currentTime = restored._currentTime;
    this._totalDuration = restored._totalDuration;
    this._zoomLevel = restored._zoomLevel;
    this._playbackRate = restored._playbackRate;
    this._isPlaying = restored._isPlaying;
    this._snapToGrid = restored._snapToGrid;
    this._gridSize = restored._gridSize;
    this._scrollLeft = restored._scrollLeft;
  }

  // ------------------------------------------------------------------
  // Serialization
  // ------------------------------------------------------------------

  /**
   * Serialize to a plain object compatible with the existing
   * `TimelineState` interface in src/types/index.ts
   * (minus `selectedItems` which lives in selectionSlice).
   */
  toPlainObject(): TimelineData {
    return {
      currentTime: this._currentTime.value,
      totalDuration: this._totalDuration.value,
      zoomLevel: this._zoomLevel.value,
      playbackRate: this._playbackRate,
      isPlaying: this._isPlaying,
      snapToGrid: this._snapToGrid,
      gridSize: this._gridSize,
      scrollLeft: this._scrollLeft,
      tracks: this._tracks.map(t => t.toPlainObject()),
    };
  }

  /** String representation for debugging. */
  toString(): string {
    return `TimelineAggregate(${this._tracks.length} tracks, duration=${this._totalDuration.value}s)`;
  }

  // ------------------------------------------------------------------
  // Private helpers
  // ------------------------------------------------------------------

  /**
   * Find a track by ID or throw.
   */
  private findTrackOrThrow(trackId: string): Track {
    const track = this.findTrack(trackId);
    if (!track) {
      throw new Error(`TimelineAggregate: track "${trackId}" not found.`);
    }
    return track;
  }

  /**
   * Recalculate and update the internal totalDuration.
   */
  private recalculateTotalDuration(): void {
    this._totalDuration = this.calculateTotalDuration();
  }
}
