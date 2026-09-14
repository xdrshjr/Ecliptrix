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
import { SplitService, type SplitResult } from '../services/SplitService';
import { TrackSelectionService } from '../services/TrackSelectionService';
import { readViewFlags } from '../services/trackViewFlags';
import type {
  TrackType,
  TimelineData,
  TimelineSnapshot,
  CreateTrackProps,
  TimelineItemData,
} from '../types';

/** Result of a successful audio detach — see TimelineAggregate.detachAudio. */
export interface DetachAudioResult {
  /** The id of the newly created audio-track item. */
  audioItemId: string;
  /** The audio track the new item was placed on. */
  targetTrackId: string;
}

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
      // Validate the whole transfer BEFORE mutating either track, so a
      // rejected add can never leave the item removed-from-source-but-not-
      // added — which would make the clip vanish from the timeline (this op
      // is not transactional once removeItem runs). See analysis §8.3.
      if (sourceTrack.isLocked) {
        throw new TrackLockedError(sourceTrack.id, 'moveItem');
      }
      if (targetTrack.isLocked) {
        throw new TrackLockedError(targetTrack.id, 'moveItem');
      }
      const materialType = item.originalMaterialType ?? item.type;
      if (!targetTrack.canAcceptMaterial(materialType)) {
        throw new Error(
          `Track "${targetTrack.id}" (type=${targetTrack.type}) cannot accept material of type "${materialType}".`,
        );
      }
      // Validated — now perform the transfer.
      sourceTrack.removeItem(itemId);
      item.moveTo(newStartTime);
      targetTrack.addItem(item);
    } else {
      // Same-track move — just assert the track is not locked via a guard
      if (sourceTrack.isLocked) {
        throw new TrackLockedError(sourceTrack.id, 'moveItem');
      }
      item.moveTo(newStartTime);
      sourceTrack.sortItems();
    }

    // Duration only, no playhead clamp: a drag preview moves the clip through
    // here on every pointer move, and clamping there pulled the playhead back
    // for good, even for a clip released where it started. A committed move is
    // always followed by organizeVideoAudioTracks, which does clamp.
    this._totalDuration = this.calculateTotalDuration();
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

  /**
   * Re-organize all video/audio tracks by sorting items by startTime and
   * packing them flush from 0 with no gaps. Subtitle tracks are left
   * untouched (tight audio/caption alignment must be preserved). Locked
   * tracks are also skipped to respect the lock invariant.
   *
   * This is the auto-organize hook used after every structural mutation
   * ("organize track materials" applied on every edit).
   */
  organizeVideoAudioTracks(): void {
    for (const track of this._tracks) {
      if (track.isLocked) continue;
      if (track.type !== 'video' && track.type !== 'audio') continue;
      if (track.items.length === 0) continue;

      // track.items is already a ReadonlyArray; copy before sorting.
      const sorted = [...track.items].sort(
        (a, b) => a.startTime.value - b.startTime.value,
      );
      let cursor = 0;
      for (const item of sorted) {
        if (item.startTime.value !== cursor) {
          item.moveTo(TimePosition.create(cursor));
        }
        cursor += item.duration.value;
      }
      track.sortItems();
    }
    this.recalculateTotalDuration();
  }

  /**
   * Put a clip at `insertIndex` among the other clips of its magnetic lane and
   * pack the lane flush from 0, with the same cursor rule as
   * organizeVideoAudioTracks (TL3-01). The index is clamped to the lane.
   *
   * @throws Error if the item is not found or its track is not video/audio.
   * @throws TrackLockedError if the track is locked.
   */
  reorderMagneticItem(itemId: string, insertIndex: number): void {
    const found = this.findItem(itemId);
    if (!found) {
      throw new Error(`TimelineAggregate.reorderMagneticItem: item "${itemId}" not found.`);
    }
    const { track, item } = found;
    if (track.isLocked) {
      throw new TrackLockedError(track.id, 'reorderMagneticItem');
    }
    if (track.type !== 'video' && track.type !== 'audio') {
      throw new Error(
        `TimelineAggregate.reorderMagneticItem: track "${track.id}" (type=${track.type}) is not magnetic.`,
      );
    }
    const ordered = track.items
      .filter(candidate => candidate.id !== itemId)
      .sort((a, b) => a.startTime.value - b.startTime.value);
    const index = Math.min(Math.max(0, Math.trunc(insertIndex)), ordered.length);
    ordered.splice(index, 0, item);
    let cursor = 0;
    for (const candidate of ordered) {
      if (candidate.startTime.value !== cursor) {
        candidate.moveTo(TimePosition.create(cursor));
      }
      cursor += candidate.duration.value;
    }
    track.sortItems();
    this.recalculateTotalDuration();
  }

  /**
   * Swap the start times of two items that live on the SAME non-subtitle,
   * non-locked track. Durations are preserved; only startTime is exchanged.
   * After the swap the caller typically invokes organizeVideoAudioTracks()
   * to close any incidental gap.
   *
   * @throws Error if either item is not found, if they live on different
   *   tracks, if the track is locked, or if the track is a subtitle track.
   */
  swapItems(aId: string, bId: string): void {
    if (aId === bId) {
      throw new Error(`TimelineAggregate.swapItems: cannot swap an item with itself ("${aId}").`);
    }
    const foundA = this.findItem(aId);
    const foundB = this.findItem(bId);
    if (!foundA) {
      throw new Error(`TimelineAggregate.swapItems: item "${aId}" not found.`);
    }
    if (!foundB) {
      throw new Error(`TimelineAggregate.swapItems: item "${bId}" not found.`);
    }
    if (foundA.track.id !== foundB.track.id) {
      throw new Error(
        `TimelineAggregate.swapItems: cross-track swap is not supported (a="${foundA.track.id}", b="${foundB.track.id}").`
      );
    }
    const track = foundA.track;
    if (track.isLocked) {
      throw new TrackLockedError(track.id, 'swapItems');
    }
    if (track.type === 'subtitle') {
      throw new Error(
        `TimelineAggregate.swapItems: subtitle tracks are excluded from swap (track="${track.id}").`
      );
    }

    const tmp = foundA.item.startTime;
    foundA.item.moveTo(foundB.item.startTime);
    foundB.item.moveTo(tmp);
    track.sortItems();
    this.recalculateTotalDuration();
  }

  /**
   * Split the item identified by `itemId` into two halves at track-timeline
   * time `tCut` (delegates to SplitService). Both halves are exact source
   * sub-intervals (INV-1..INV-3); the left half keeps the original id.
   *
   * @returns The left/right ids, or null when the cut is at/outside the item
   *   boundary (no-op).
   * @throws Error if the item is not found.
   * @throws TrackLockedError if the owning track is locked.
   */
  splitItemAtTime(itemId: string, tCut: number): SplitResult | null {
    const found = this.findItem(itemId);
    if (!found) {
      throw new Error(`TimelineAggregate.splitItemAtTime: item "${itemId}" not found.`);
    }
    const { track } = found;
    if (track.isLocked) {
      throw new TrackLockedError(track.id, 'splitItemAtTime');
    }

    const result = SplitService.splitItemAtTime(track, itemId, tCut);
    if (result) {
      this.recalculateTotalDuration();
    }
    return result;
  }

  /**
   * Detach the embedded audio of a video item into an independent audio-track
   * item, preserving the same start/duration/clip interval and materialId.
   * The original video item is flagged `audioDetached` so composition/export
   * suppress its audio (the derived item is the sole contributor).
   *
   * Pure domain orchestration: the caller is responsible for confirming the
   * source material actually has an audio stream (see detachAudioAction).
   *
   * @returns The new audio item id + its track, or null when the item is not
   *   a video item or its audio is already detached (no-op).
   * @throws Error if the item is not found.
   * @throws TrackLockedError if the video item's track is locked.
   */
  detachAudio(itemId: string): DetachAudioResult | null {
    const found = this.findItem(itemId);
    if (!found) {
      throw new Error(`TimelineAggregate.detachAudio: item "${itemId}" not found.`);
    }
    const { track: sourceTrack, item } = found;
    if (item.type !== 'video' || item.audioDetached === true) {
      return null;
    }
    if (sourceTrack.isLocked) {
      throw new TrackLockedError(sourceTrack.id, 'detachAudio');
    }

    const targetTrack = this.resolveAudioTrack();
    const audioData = this.buildDetachedAudioData(item, targetTrack.id);
    const audioItem = TimelineItem.fromPlainObject(audioData);

    targetTrack.addItem(audioItem);
    item.audioDetached = true;
    this.recalculateTotalDuration();

    return { audioItemId: audioItem.id, targetTrackId: targetTrack.id };
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
    // Minimum duration of 0.001 to avoid zero-duration (Duration invariant > 0)
    return Duration.create(Math.max(this.maxItemEnd(), 0.001));
  }

  /** Latest item end across all tracks; 0 when the timeline is empty. */
  private maxItemEnd(): number {
    let maxEnd = 0;
    for (const track of this._tracks) {
      for (const item of track.items) {
        const end = item.endTime().value;
        if (end > maxEnd) {
          maxEnd = end;
        }
      }
    }
    return maxEnd;
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
   * Restore the timeline content to a previously captured snapshot.
   *
   * Only the tracks (and the duration derived from them) come back. Zoom,
   * scroll, playhead, playback rate and grid are view state the user set
   * after the edit: restoring them made Ctrl+Z jump the view to 100% / 0 px
   * while the DOM stayed scrolled, so ruler clicks landed on the wrong time.
   *
   * Lock, mute and visibility are view flags, not content (S12): a track that
   * still exists keeps the flags it has now, so undoing an older edit never
   * unlocks or unmutes it. A track that only the snapshot has keeps its own.
   */
  restore(snapshot: TimelineSnapshot): void {
    const restored = TimelineAggregate.fromPlainObject(snapshot);
    const liveById = new Map(this._tracks.map(track => [track.id, track] as const));
    for (const track of restored._tracks) {
      const live = liveById.get(track.id);
      if (live) track.applyViewFlags(readViewFlags(live));
    }
    this._tracks = [...(restored._tracks as Track[])];
    this.recalculateTotalDuration();
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
   * Recalculate and update the internal totalDuration, keeping the playhead
   * inside the content: after a delete shortened the timeline it stayed past
   * the end (ruler aria-valuenow > aria-valuemax, black preview).
   */
  private recalculateTotalDuration(): void {
    this._totalDuration = this.calculateTotalDuration();
    const contentEnd = this.maxItemEnd();
    if (this._currentTime.value > contentEnd) {
      this._currentTime = TimePosition.create(contentEnd);
    }
  }

  /**
   * Select an existing unlocked audio track for a detached audio item, or
   * create one when none exists. Reuses TrackSelectionService so the choice
   * matches the rest of the placement logic.
   */
  private resolveAudioTrack(): Track {
    const selected = TrackSelectionService.selectTrackForMaterial(this._tracks, 'audio');
    if (selected && !selected.isLocked) {
      return selected;
    }
    // None available (or only locked ones) — append a fresh audio track after
    // the current last order so it does not collide with existing ordering.
    const nextOrder = this._tracks.reduce((max, t) => Math.max(max, t.order), -1) + 1;
    return this.addTrackFromProps({
      type: 'audio',
      name: 'Audio',
      order: nextOrder,
    });
  }

  /**
   * Build the plain data for a detached audio item: same timing/clip interval
   * and materialId as the source video item, placed past any existing items on
   * the target track to avoid overlap (autoOrganize repacks afterwards).
   */
  private buildDetachedAudioData(video: TimelineItem, targetTrackId: string): TimelineItemData {
    const targetTrack = this.findTrackOrThrow(targetTrackId);
    const lastEnd = targetTrack.items.reduce(
      (max, it) => Math.max(max, it.endTime().value),
      0,
    );
    // Keep the source timing when the track slot is free; otherwise park after
    // the last item so addItem does not produce an overlap.
    const startTime = video.startTime.value >= lastEnd ? video.startTime.value : lastEnd;

    const data: TimelineItemData = {
      id: `item-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
      name: video.name,
      type: 'audio',
      startTime,
      duration: video.duration.value,
      trackId: targetTrackId,
      color: '#10b981',
      volume: video.volume.value,
      opacity: 1,
    };
    if (video.materialId != null) data.materialId = video.materialId;
    if (video.url != null) data.url = video.url;
    if (video.serverUrl != null) data.serverUrl = video.serverUrl;
    if (video.cacheUrl != null) data.cacheUrl = video.cacheUrl;
    if (video.storageKey != null) data.storageKey = video.storageKey;
    if (video.metadata != null) data.metadata = video.metadata;
    if (video.clipStart != null) data.clipStart = video.clipStart.value;
    if (video.clipEnd != null) data.clipEnd = video.clipEnd.value;
    if (video.originalDuration != null) data.originalDuration = video.originalDuration.value;
    return data;
  }
}
