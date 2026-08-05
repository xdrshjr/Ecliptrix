/**
 * timelineSlice — Core timeline state management.
 *
 * Wraps the TimelineAggregate and exposes derived plain-object state
 * for React consumption. The aggregate is the single source of truth;
 * every mutation goes through it, and _syncDerivedState() projects
 * its internal state to flat Zustand fields.
 */

import type { StateCreator } from 'zustand';
import {
  TimelineAggregate,
  TimePosition,
  Volume,
  ZoomLevel,
  TimelineItem,
  ItemPlacementService,
  TrackSelectionService,
  TrackLockedError,
} from '../../domain';
import type {
  TrackData,
  TimelineData,
  TimelineSnapshot,
  MaterialData,
  TimelineItemData,
  ImagePosition,
  CameraMotionData,
} from '../../domain';
import type { TimelineStore } from '../useTimelineStore';

// ---------------------------------------------------------------------------
// Slice state + actions interface
// ---------------------------------------------------------------------------

export interface TimelineSlice {
  // Internal aggregate (not exposed to UI directly)
  _aggregate: TimelineAggregate;

  // Derived plain-object state (projected from aggregate)
  tracks: TrackData[];
  currentTime: number;
  totalDuration: number;
  zoomLevel: number;
  playbackRate: number;
  isPlaying: boolean;
  snapToGrid: boolean;
  gridSize: number;
  scrollLeft: number;

  // Initialization
  initTimeline: (data?: Partial<TimelineData>) => void;

  // Item operations
  addItemToTrack: (trackId: string, material: MaterialData) => TimelineItemData | null;
  removeItem: (itemId: string) => void;
  moveItem: (itemId: string, newStartTime: number, isPreview?: boolean, targetTrackId?: string) => void;
  resizeItem: (itemId: string, edge: 'start' | 'end', newPosition: number) => void;
  updateItemVolume: (itemId: string, volume: number) => void;
  updateItemSubtitle: (itemId: string, text: string) => void;
  /** Persist an image overlay's position/scale into the authoritative store. */
  updateItemImagePosition: (itemId: string, position: ImagePosition) => void;
  /**
   * Attach (or clear with `null`) a 2D/3D 运镜 on a video item. Raw setter — use
   * `setCameraMotionAction` for the undoable, guarded entry point.
   */
  setItemCameraMotion: (itemId: string, motion: CameraMotionData | null) => void;
  /** Shift subsequent items on the same track to close gaps after a given item. */
  consolidateTrackAfterItem: (itemId: string) => void;
  /**
   * Auto-organize: sort all video/audio track items by startTime and pack
   * them flush from 0. Subtitle and locked tracks are skipped. Called as
   * a post-mutation side effect from orchestrated actions; does NOT itself
   * write to history (the parent action's before/after snapshots bracket it).
   */
  autoOrganize: () => void;
  /** Swap the startTimes of two items on the same non-subtitle track. */
  swapItems: (aId: string, bId: string) => void;
  /**
   * Split an item into two halves at the given track-timeline cut time.
   * Returns the left/right ids, or null on a boundary/out-of-range no-op.
   */
  splitItemAtTime: (itemId: string, tCut: number) => { leftId: string; rightId: string } | null;
  /**
   * Detach a video item's embedded audio into an independent audio-track item.
   * Returns the new audio item id + track, or null on a no-op. The caller is
   * responsible for confirming the source material has an audio stream.
   */
  detachAudio: (itemId: string) => { audioItemId: string; targetTrackId: string } | null;

  // Track operations
  toggleTrackLock: (trackId: string) => void;
  toggleTrackMute: (trackId: string) => void;
  toggleTrackVisibility: (trackId: string) => void;
  setTrackVolume: (trackId: string, volume: number) => void;
  removeTrack: (trackId: string) => void;

  // Playback control
  setCurrentTime: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
  setPlaying: (playing: boolean) => void;

  // Zoom / scroll
  setZoomLevel: (zoom: number) => void;
  setScrollLeft: (value: number) => void;
  setSnapToGrid: (enabled: boolean) => void;

  // Snapshot / restore (for undo/redo)
  getSnapshot: () => TimelineSnapshot;
  restoreFromSnapshot: (snapshot: TimelineSnapshot) => void;

  // Serialization
  exportToData: () => TimelineData;
  importFromData: (data: TimelineData) => void;

  // Internal
  _syncDerivedState: () => void;
}

// ---------------------------------------------------------------------------
// Default initial data
// ---------------------------------------------------------------------------

const DEFAULT_INITIAL_DATA: Partial<TimelineData> = {
  currentTime: 0,
  totalDuration: 0,
  zoomLevel: 1.0,
  playbackRate: 1.0,
  isPlaying: false,
  snapToGrid: true,
  gridSize: 0.5,
  scrollLeft: 0,
  tracks: [],
};

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createTimelineSlice: StateCreator<
  TimelineStore,
  [],
  [],
  TimelineSlice
> = (set, get) => {
  const initialAggregate = TimelineAggregate.create(DEFAULT_INITIAL_DATA);
  const initialData = initialAggregate.toPlainObject();

  return {
    // Internal
    _aggregate: initialAggregate,

    // Derived state
    tracks: initialData.tracks,
    currentTime: initialData.currentTime,
    totalDuration: initialData.totalDuration,
    zoomLevel: initialData.zoomLevel,
    playbackRate: initialData.playbackRate,
    isPlaying: initialData.isPlaying,
    snapToGrid: initialData.snapToGrid,
    gridSize: initialData.gridSize,
    scrollLeft: initialData.scrollLeft,

    // ------------------------------------------------------------------
    // Initialization
    // ------------------------------------------------------------------

    initTimeline: (data?: Partial<TimelineData>) => {
      const merged = { ...DEFAULT_INITIAL_DATA, ...data };
      const aggregate = TimelineAggregate.create(merged);
      set({ _aggregate: aggregate });
      get()._syncDerivedState();
    },

    // ------------------------------------------------------------------
    // Item operations
    // ------------------------------------------------------------------

    addItemToTrack: (trackId: string, material: MaterialData): TimelineItemData | null => {
      const state = get();
      const aggregate = state._aggregate;

      // 1. Select the target track
      const track = TrackSelectionService.selectTrackForMaterial(
        aggregate.tracks,
        material.type,
        trackId,
      );

      if (!track) {
        console.warn(
          `[timelineSlice] addItemToTrack: no compatible track found for material type "${material.type}"`,
        );
        return null;
      }

      // 2. Create item data from material
      const itemData = ItemPlacementService.createItemFromMaterial(material, track);

      // 3. Create the entity and add to aggregate
      const item = TimelineItem.fromPlainObject(itemData);
      try {
        aggregate.addItemToTrack(track.id, item);
      } catch (err) {
        console.error('[timelineSlice] addItemToTrack failed:', err);
        return null;
      }

      // 4. Sync derived state
      state._syncDerivedState();

      return itemData;
    },

    removeItem: (itemId: string) => {
      const state = get();
      const aggregate = state._aggregate;
      const found = aggregate.findItem(itemId);
      if (!found) {
        console.warn(`[timelineSlice] removeItem: item "${itemId}" not found.`);
        return;
      }

      try {
        aggregate.removeItemFromTrack(found.track.id, itemId);
      } catch (err) {
        console.error('[timelineSlice] removeItem failed:', err);
        return;
      }

      state._syncDerivedState();
    },

    // NOTE: `isPreview` is part of the public shape the drag layer and action
    // orchestrator rely on (they pass `true` during a drag preview and `false`
    // on commit). History recording is the concern of the orchestrated action
    // layer, not this slice. `targetTrackId` (commit only) enables cross-track
    // moves; preview frames never transfer tracks (analysis constraint #2), so
    // it is ignored while `isPreview` is true.
    moveItem: (itemId: string, newStartTime: number, isPreview?: boolean, targetTrackId?: string) => {
      const state = get();
      const aggregate = state._aggregate;

      // Resolve whether this is a genuine, safe cross-track transfer. Guard
      // BEFORE mutating: aggregate.moveItem removes from the source track then
      // adds to the target, and a rejected add (locked / incompatible) would
      // drop the clip (analysis §8.3). If the target can't accept the item we
      // fall back to a same-track move (time only) so nothing is ever lost.
      let effectiveTargetId: string | undefined;
      if (targetTrackId && !isPreview) {
        const found = aggregate.findItem(itemId);
        if (found && found.track.id !== targetTrackId && !found.track.isLocked) {
          const targetTrack = aggregate.findTrack(targetTrackId);
          const materialType = found.item.originalMaterialType ?? found.item.type;
          if (targetTrack && !targetTrack.isLocked && targetTrack.canAcceptMaterial(materialType)) {
            effectiveTargetId = targetTrackId;
          }
        }
      }

      try {
        aggregate.moveItem(itemId, TimePosition.create(newStartTime), effectiveTargetId);
      } catch (err) {
        console.error('[timelineSlice] moveItem failed:', err);
        return;
      }

      state._syncDerivedState();
    },

    resizeItem: (itemId: string, edge: 'start' | 'end', newPosition: number) => {
      const state = get();
      const aggregate = state._aggregate;

      try {
        aggregate.resizeItem(itemId, edge, TimePosition.create(newPosition));
      } catch (err) {
        console.error('[timelineSlice] resizeItem failed:', err);
        return;
      }

      state._syncDerivedState();
    },

    consolidateTrackAfterItem: (itemId: string) => {
      const state = get();
      const aggregate = state._aggregate;
      const found = aggregate.findItem(itemId);
      if (!found) return;

      const { track, item: anchorItem } = found;
      // Get all items sorted by startTime
      const sortedItems = [...track.items].sort(
        (a, b) => a.startTime.value - b.startTime.value,
      );
      const anchorIdx = sortedItems.findIndex(i => i.id === itemId);
      if (anchorIdx < 0) return;

      // Chain subsequent items end-to-end starting from the anchor's end
      let nextStart = anchorItem.endTime().value;
      for (let i = anchorIdx + 1; i < sortedItems.length; i++) {
        if (sortedItems[i].startTime.value !== nextStart) {
          sortedItems[i].moveTo(TimePosition.create(nextStart));
        }
        nextStart = sortedItems[i].endTime().value;
      }

      track.sortItems();
      state._syncDerivedState();
    },

    autoOrganize: () => {
      const state = get();
      state._aggregate.organizeVideoAudioTracks();
      state._syncDerivedState();
    },

    swapItems: (aId: string, bId: string) => {
      const state = get();
      try {
        state._aggregate.swapItems(aId, bId);
      } catch (err) {
        console.error('[timelineSlice] swapItems failed:', err);
        return;
      }
      state._syncDerivedState();
    },

    splitItemAtTime: (itemId: string, tCut: number) => {
      const state = get();
      let result: { leftId: string; rightId: string } | null = null;
      try {
        result = state._aggregate.splitItemAtTime(itemId, tCut);
      } catch (err) {
        console.error('[timelineSlice] splitItemAtTime failed:', err);
        return null;
      }
      if (result) {
        state._syncDerivedState();
      }
      return result;
    },

    detachAudio: (itemId: string) => {
      const state = get();
      let result: { audioItemId: string; targetTrackId: string } | null = null;
      try {
        result = state._aggregate.detachAudio(itemId);
      } catch (err) {
        console.error('[timelineSlice] detachAudio failed:', err);
        return null;
      }
      if (result) {
        state._syncDerivedState();
      }
      return result;
    },

    updateItemVolume: (itemId: string, volume: number) => {
      const state = get();
      const aggregate = state._aggregate;
      const found = aggregate.findItem(itemId);
      if (!found) {
        console.warn(`[timelineSlice] updateItemVolume: item "${itemId}" not found.`);
        return;
      }

      try {
        found.item.updateVolume(Volume.create(volume));
      } catch (err) {
        console.error('[timelineSlice] updateItemVolume failed:', err);
        return;
      }

      state._syncDerivedState();
    },

    updateItemSubtitle: (itemId: string, text: string) => {
      const state = get();
      const aggregate = state._aggregate;
      const found = aggregate.findItem(itemId);
      if (!found) {
        console.warn(`[timelineSlice] updateItemSubtitle: item "${itemId}" not found.`);
        return;
      }

      found.item.text = text;
      state._syncDerivedState();
    },

    updateItemImagePosition: (itemId: string, position: ImagePosition) => {
      const state = get();
      const aggregate = state._aggregate;
      const found = aggregate.findItem(itemId);
      if (!found) {
        console.warn(`[timelineSlice] updateItemImagePosition: item "${itemId}" not found.`);
        return;
      }

      found.item.imagePosition = position;
      state._syncDerivedState();
    },

    setItemCameraMotion: (itemId: string, motion: CameraMotionData | null) => {
      const state = get();
      const found = state._aggregate.findItem(itemId);
      if (!found) {
        console.warn(`[timelineSlice] setItemCameraMotion: item "${itemId}" not found.`);
        return;
      }

      found.item.cameraMotion = motion ?? undefined;
      state._syncDerivedState();
    },

    // ------------------------------------------------------------------
    // Track operations
    // ------------------------------------------------------------------

    toggleTrackLock: (trackId: string) => {
      const state = get();
      try {
        state._aggregate.toggleTrackLock(trackId);
      } catch (err) {
        console.error('[timelineSlice] toggleTrackLock failed:', err);
        return;
      }
      state._syncDerivedState();
    },

    toggleTrackMute: (trackId: string) => {
      const state = get();
      try {
        state._aggregate.toggleTrackMute(trackId);
      } catch (err) {
        console.error('[timelineSlice] toggleTrackMute failed:', err);
        return;
      }
      state._syncDerivedState();
    },

    toggleTrackVisibility: (trackId: string) => {
      const state = get();
      try {
        state._aggregate.toggleTrackVisibility(trackId);
      } catch (err) {
        console.error('[timelineSlice] toggleTrackVisibility failed:', err);
        return;
      }
      state._syncDerivedState();
    },

    setTrackVolume: (trackId: string, volume: number) => {
      const state = get();
      try {
        // TrackData uses 0-200 percentage; Volume.fromPercentage converts to 0-2.0 range.
        state._aggregate.setTrackVolume(trackId, Volume.fromPercentage(volume));
      } catch (err) {
        if (err instanceof TrackLockedError) {
          // User-caused; presentation layer should have prevented the call. Silent no-op.
          return;
        }
        console.error('[timelineSlice] setTrackVolume failed:', err);
        return;
      }
      state._syncDerivedState();
    },

    removeTrack: (trackId: string) => {
      const state = get();
      try {
        state._aggregate.removeTrack(trackId);
      } catch (err) {
        console.error('[timelineSlice] removeTrack failed:', err);
        return;
      }
      state._syncDerivedState();
    },

    // ------------------------------------------------------------------
    // Playback control
    // ------------------------------------------------------------------

    setCurrentTime: (time: number) => {
      const state = get();
      // Defensive clamp: an empty timeline reports totalDuration ≈ 0.001 (the
      // `Duration > 0` invariant floor), so a naïve setCurrentTime(50) would
      // leave currentTime far past the end. Clamp to [0, totalDuration].
      const max = Math.max(0, state.totalDuration);
      const clamped = Math.min(Math.max(0, time), max);
      state._aggregate.setCurrentTime(TimePosition.create(clamped));
      // Directly set for performance (avoid full sync for high-frequency updates)
      set({ currentTime: clamped });
    },

    setPlaybackRate: (rate: number) => {
      const state = get();
      try {
        state._aggregate.setPlaybackRate(rate);
      } catch (err) {
        console.error('[timelineSlice] setPlaybackRate failed:', err);
        return;
      }
      set({ playbackRate: rate });
    },

    setPlaying: (playing: boolean) => {
      const state = get();
      state._aggregate.setPlaying(playing);
      set({ isPlaying: playing });
    },

    // ------------------------------------------------------------------
    // Zoom / scroll
    // ------------------------------------------------------------------

    setZoomLevel: (zoom: number) => {
      const state = get();
      try {
        state._aggregate.setZoomLevel(ZoomLevel.create(zoom));
      } catch (err) {
        console.error('[timelineSlice] setZoomLevel failed:', err);
        return;
      }
      set({ zoomLevel: zoom });
    },

    setScrollLeft: (value: number) => {
      const state = get();
      state._aggregate.setScrollLeft(value);
      set({ scrollLeft: Math.max(0, value) });
    },

    setSnapToGrid: (enabled: boolean) => {
      const state = get();
      state._aggregate.setSnapToGrid(enabled);
      set({ snapToGrid: enabled });
    },

    // ------------------------------------------------------------------
    // Snapshot / restore
    // ------------------------------------------------------------------

    getSnapshot: (): TimelineSnapshot => {
      const state = get();
      return JSON.parse(JSON.stringify(state._aggregate.snapshot()));
    },

    restoreFromSnapshot: (snapshot: TimelineSnapshot) => {
      const state = get();
      state._aggregate.restore(snapshot);
      state._syncDerivedState();
    },

    // ------------------------------------------------------------------
    // Serialization
    // ------------------------------------------------------------------

    exportToData: (): TimelineData => {
      return get()._aggregate.toPlainObject();
    },

    importFromData: (data: TimelineData) => {
      const aggregate = TimelineAggregate.fromPlainObject(data);
      set({ _aggregate: aggregate });
      get()._syncDerivedState();
    },

    // ------------------------------------------------------------------
    // Internal: sync aggregate state to flat Zustand fields
    // ------------------------------------------------------------------

    _syncDerivedState: () => {
      const aggregate = get()._aggregate;
      const plain = aggregate.toPlainObject();
      set({
        tracks: plain.tracks,
        currentTime: plain.currentTime,
        totalDuration: plain.totalDuration,
        zoomLevel: plain.zoomLevel,
        playbackRate: plain.playbackRate,
        isPlaying: plain.isPlaying,
        snapToGrid: plain.snapToGrid,
        gridSize: plain.gridSize,
        scrollLeft: plain.scrollLeft,
      });
    },
  };
};
