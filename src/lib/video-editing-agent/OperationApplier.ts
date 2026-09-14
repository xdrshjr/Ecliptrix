/**
 * OperationApplier — Applies Agent timeline operations to the React
 * timeline state and records per-track patches for granular undo.
 *
 * Supports:
 *   - apply()             — apply a single operation and record the tracks it changed
 *   - undoOperation()     — revert one operation (or a whole batch) by toolCallId
 *   - hasUndoableRecord() — whether a toolCallId has a timeline change to undo
 *   - getOperationHistory — read-only access for UI (undo buttons)
 *
 * Design notes:
 *   - The applier receives a `getTimelineState` / `setTimelineState` pair so
 *     it can read and write the React state without owning it.
 *   - Each record keeps before/after copies of only the tracks the operation
 *     changed (see `trackPatch.ts`). Undo restores those tracks and refuses
 *     when any of them changed since, instead of restoring an old snapshot
 *     that would wipe out later edits.
 *
 * @module OperationApplier
 */

import type {
  TimelineState,
  AgentTimelineOperation,
  AgentTrackPatch,
  MaterialItem,
  MaterialType,
  TimelineItem,
  Track,
} from '@/types';
import type { AgentOperation, MaterialOperation, ScriptOperation, StoryboardOperation, AsyncTaskOperation } from './types';
import type { StoryboardItem } from '@/stores/slices/storyboardSlice';
import { useVideoEditingStore } from '@/stores';
import { reconcileOverlapsAfterAgentOp } from './reconcile';
import { diffTimelineTracks, revertTrackPatches } from './trackPatch';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OperationRecord {
  /** The toolCallId that produced this operation. */
  toolCallId: string;
  /** The operation that was applied. */
  operation: AgentTimelineOperation;
  /**
   * Tracks this operation changed (before/after, inline thumbnails dropped).
   * Never empty: operations without a timeline effect are not recorded.
   */
  patches: AgentTrackPatch[];
}

/** Outcome of undoing one agent operation. */
export type AgentUndoResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'conflict' };

/**
 * Undo record for non-timeline operations (material, script, storyboard).
 * Async task operations are NOT undoable.
 */
export interface NonTimelineUndoRecord {
  toolCallId: string;
  operation: AgentOperation;
  undoable: boolean;
  /** Data needed to reverse the operation. */
  undoData: unknown;
}

export interface OperationApplierConfig {
  /** Read current timeline state. */
  getTimelineState: () => TimelineState | null;
  /** Write updated timeline state (triggers React re-render). */
  setTimelineState: (state: TimelineState) => void;
  /** Called after an operation or an undo changed the timeline. */
  onTimelineUpdate?: () => void;
  /**
   * Optional animation trigger: called with the operation after it is
   * applied (or before, for delete_clip) so the UI layer can add CSS
   * classes for visual feedback.
   */
  onTriggerAnimation?: (operation: AgentTimelineOperation) => void;
}

type AddClipOperation = Extract<AgentTimelineOperation, { type: 'add_clip' }>;
type MoveClipOperation = Extract<AgentTimelineOperation, { type: 'move_clip' }>;

/** Lets the delete animation class land before the clip is removed. */
const DELETE_ANIMATION_DELAY_MS = 50;

const CLIP_COLORS: Record<string, string> = {
  video: '#3b82f6',
  audio: '#10b981',
  image: '#8b5cf6',
};

// ---------------------------------------------------------------------------
// OperationApplier
// ---------------------------------------------------------------------------

export class OperationApplier {
  private readonly config: OperationApplierConfig;
  private operations: OperationRecord[] = [];
  private nonTimelineRecords: NonTimelineUndoRecord[] = [];

  constructor(config: OperationApplierConfig) {
    this.config = config;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Apply a timeline operation and record the tracks it changed.
   *
   * For delete_clip operations the animation is triggered BEFORE the
   * state mutation so the clip element still exists in the DOM for the
   * CSS animation. For all other operations the animation fires AFTER.
   */
  async apply(
    operation: AgentTimelineOperation,
    toolCallId: string,
  ): Promise<void> {
    const current = this.ensureTimelineState();
    const lockedTrackId = findLockedTrackId(current, operation);
    if (lockedTrackId !== null) {
      // The tools already refuse locked tracks; this also covers batched
      // operations, so a layout the user locked is never touched.
      console.warn('[OperationApplier] skipped operation on locked track', {
        type: operation.type,
        trackId: lockedTrackId,
      });
      return;
    }

    if (operation.type === 'delete_clip') {
      this.config.onTriggerAnimation?.(operation);
      // A plain timeout, not requestAnimationFrame: rAF is paused while the
      // window is minimised, which would stall the serialised event chain.
      await new Promise<void>(resolve =>
        setTimeout(resolve, DELETE_ANIMATION_DELAY_MS),
      );
    }

    const before = deepClone(this.config.getTimelineState() ?? current);
    this.applyToTimeline(operation);

    if (operation.type !== 'delete_clip') {
      this.config.onTriggerAnimation?.(operation);
    }

    const after = this.config.getTimelineState();
    const patches = after ? diffTimelineTracks(before, after) : [];
    if (patches.length === 0) {
      // No timeline effect (e.g. the clip was already gone): nothing to undo.
      return;
    }
    this.operations.push({ toolCallId, operation, patches });
    this.config.onTimelineUpdate?.();
  }

  /**
   * Undo the operation identified by toolCallId. A batch tool (e.g.
   * compose_storyboard) is recorded as `${toolCallId}-batch-${i}`; passing
   * the parent id undoes every record of the batch.
   *
   * Records are reverted newest first. When any affected track changed after
   * the operation, nothing is written and `conflict` is returned.
   */
  undoOperation(toolCallId: string): AgentUndoResult {
    const records = this.recordsFor(toolCallId);
    const current = this.config.getTimelineState();
    if (records.length === 0 || !current) {
      console.warn('[OperationApplier] undoOperation: nothing to undo', {
        toolCallId,
      });
      return { ok: false, reason: 'not-found' };
    }

    let working = current;
    for (const record of [...records].reverse()) {
      const result = revertTrackPatches(working, record.patches);
      if (!result.ok) {
        console.warn('[OperationApplier] undoOperation refused: tracks changed', {
          toolCallId,
          conflictTrackIds: result.conflictTrackIds,
        });
        return { ok: false, reason: 'conflict' };
      }
      working = result.state;
    }

    this.config.setTimelineState(working);
    this.operations = this.operations.filter(r => !records.includes(r));
    this.config.onTimelineUpdate?.();
    return { ok: true };
  }

  /** Ids of the tracks toolCallId (or its batch) changed. */
  affectedTrackIds(toolCallId: string): string[] {
    const trackIds: string[] = [];
    for (const record of this.recordsFor(toolCallId)) {
      for (const patch of record.patches) {
        if (!trackIds.includes(patch.trackId)) trackIds.push(patch.trackId);
      }
    }
    return trackIds;
  }

  /** Whether toolCallId (or its batch) has a recorded timeline change. */
  hasUndoableRecord(toolCallId: string): boolean {
    return this.recordsFor(toolCallId).length > 0;
  }

  /**
   * Get a read-only view of all recorded operations.
   * Used by the UI to render undo buttons per tool call.
   */
  getOperationHistory(): ReadonlyArray<OperationRecord> {
    return this.operations;
  }

  // -----------------------------------------------------------------------
  // Non-timeline operation undo support
  // -----------------------------------------------------------------------

  /**
   * Record a non-timeline operation for undo support. Call this BEFORE the
   * operation is applied to the store so we can capture pre-state.
   */
  recordNonTimelineOperation(
    operation: AgentOperation,
    toolCallId: string,
  ): void {
    const store = useVideoEditingStore.getState();

    switch (operation.type) {
      case 'add_material': {
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: { materialId: (operation as MaterialOperation & { type: 'add_material' }).material.id },
        });
        break;
      }
      case 'add_materials': {
        const op = operation as MaterialOperation & { type: 'add_materials' };
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: { materialIds: op.materials.map(m => m.id) },
        });
        break;
      }
      case 'remove_material': {
        const op = operation as MaterialOperation & { type: 'remove_material' };
        const existing = store.materials.find(m => m.id === op.materialId);
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: { material: existing ? deepClone(existing) : null },
        });
        break;
      }
      case 'set_script': {
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: {
            previousContent: store.scriptContent,
            previousType: store.scriptType,
          },
        });
        break;
      }
      case 'set_script_with_narration': {
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: {
            previousScriptSegmentsData: store.scriptSegmentsData
              ? deepClone(store.scriptSegmentsData)
              : null,
            previousType: store.scriptType,
          },
        });
        break;
      }
      case 'append_script': {
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: { previousContent: store.scriptContent },
        });
        break;
      }
      case 'set_storyboards': {
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: { previousStoryboards: deepClone(store.storyboards) },
        });
        break;
      }
      case 'update_storyboard': {
        const op = operation as StoryboardOperation & { type: 'update_storyboard' };
        const existingBoard = store.storyboards.find(s => s.id === op.storyboardId);
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: true,
          undoData: { previousStoryboard: existingBoard ? deepClone(existingBoard) : null },
        });
        break;
      }
      case 'start_async_task': {
        // Async tasks are NOT undoable — the task has already been submitted
        this.nonTimelineRecords.push({
          toolCallId,
          operation,
          undoable: false,
          undoData: null,
        });
        break;
      }
      default:
        // Timeline operations are handled by the existing apply() path
        break;
    }
  }

  /**
   * Undo a non-timeline operation by toolCallId.
   * Returns `true` if found and undone, `false` if not found or not undoable.
   */
  undoNonTimelineOperation(toolCallId: string): boolean {
    const idx = this.nonTimelineRecords.findIndex(r => r.toolCallId === toolCallId);
    if (idx === -1) return false;

    const record = this.nonTimelineRecords[idx];
    if (!record.undoable) {
      console.warn(
        `[OperationApplier] Operation ${record.operation.type} is not undoable (toolCallId: ${toolCallId})`,
      );
      return false;
    }

    const store = useVideoEditingStore.getState();
    const data = record.undoData as Record<string, unknown>;

    switch (record.operation.type) {
      case 'add_material':
        store.removeMaterial(data.materialId as string);
        break;
      case 'add_materials': {
        const ids = data.materialIds as string[];
        for (const id of ids) {
          store.removeMaterial(id);
        }
        break;
      }
      case 'remove_material': {
        const mat = data.material as MaterialItem | null;
        if (mat) store.addMaterial(mat);
        break;
      }
      case 'set_script':
        store.setScriptContent(data.previousContent as string);
        store.setScriptType(data.previousType as 'video' | 'understanding' | 'ai_generated');
        break;
      case 'set_script_with_narration':
        store.setScriptSegmentsData(data.previousScriptSegmentsData as import('@/stores/slices/scriptSlice').ScriptSegmentData[] | null);
        store.setScriptType(data.previousType as 'video' | 'understanding' | 'ai_generated');
        break;
      case 'append_script':
        store.setScriptContent(data.previousContent as string);
        break;
      case 'set_storyboards':
        store.setStoryboards(data.previousStoryboards as StoryboardItem[]);
        break;
      case 'update_storyboard': {
        const prev = data.previousStoryboard as StoryboardItem | null;
        if (prev) {
          store.updateStoryboard(prev.id, prev);
        }
        break;
      }
    }

    this.nonTimelineRecords.splice(idx, 1);
    return true;
  }

  /**
   * Get a read-only view of non-timeline undo records.
   */
  getNonTimelineHistory(): ReadonlyArray<NonTimelineUndoRecord> {
    return this.nonTimelineRecords;
  }

  /** Clear operation history (e.g., when execution is cancelled). */
  clear(): void {
    this.operations = [];
    this.nonTimelineRecords = [];
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Records of toolCallId itself and of its batch children. */
  private recordsFor(toolCallId: string): OperationRecord[] {
    const batchPrefix = `${toolCallId}-batch-`;
    return this.operations.filter(
      r => r.toolCallId === toolCallId || r.toolCallId.startsWith(batchPrefix),
    );
  }

  private ensureTimelineState(): TimelineState {
    const current = this.config.getTimelineState();
    if (current) return current;
    console.warn('[OperationApplier] No timeline state — initializing default');
    const initial = createDefaultTimelineState();
    this.config.setTimelineState(initial);
    return initial;
  }

  /**
   * Apply a single operation to the timeline state. This mirrors the
   * inline logic that was previously in VideoEditingInterface's
   * `applyAgentOperationToTimeline` callback.
   */
  private applyToTimeline(operation: AgentTimelineOperation): void {
    const current = this.config.getTimelineState();
    if (!current) return;

    // Deep-clone to avoid mutation of the current React state object
    const state = deepClone(current);
    applyOperationToState(state, operation);

    // Reconcile overlaps that this Agent operation may have produced.
    // Runs in the SAME setTimelineState pass so the recorded patch does
    // not see a transient overlapping state (R11). Operates only on the
    // tracks the operation touched — historical layouts (R13) are left
    // alone, and subtitle / locked tracks are skipped inside reconcile.
    reconcileOverlapsAfterAgentOp(state, operation);

    state.totalDuration = Math.max(computeTimelineEnd(state), state.totalDuration);
    this.config.setTimelineState(state);
  }
}

// ---------------------------------------------------------------------------
// Operation mutations (on a private deep clone)
// ---------------------------------------------------------------------------

function applyOperationToState(
  state: TimelineState,
  operation: AgentTimelineOperation,
): void {
  switch (operation.type) {
    case 'add_clip':
      addClipToState(state, operation);
      break;
    case 'trim_clip': {
      const clip = findClipInState(state, operation.clipId);
      if (clip) {
        clip.clipStart = operation.clipStart;
        clip.clipEnd = operation.clipEnd;
        clip.duration = operation.duration;
      }
      break;
    }
    case 'delete_clip': {
      const track = state.tracks.find(t => t.id === operation.trackId);
      if (track) {
        track.items = track.items.filter(i => i.id !== operation.clipId);
      }
      break;
    }
    case 'move_clip':
      moveClipInState(state, operation);
      break;
    case 'resize_clip': {
      const clip = findClipInState(state, operation.clipId);
      if (clip) {
        clip.duration = operation.newDuration;
        // Keeps duration === clipEnd - clipStart; images carry no clipEnd.
        if (operation.clipEnd !== undefined) clip.clipEnd = operation.clipEnd;
      }
      break;
    }
  }
}

function addClipToState(state: TimelineState, operation: AddClipOperation): void {
  const { clip, material } = operation;
  const track =
    state.tracks.find(t => t.id === clip.trackId) ??
    createTrackForMaterial(state, clip.trackId, material.type);
  const matType = material.type || track.type;
  track.items.push({
    id: clip.id,
    name: material.name || '',
    type: track.type,
    startTime: clip.startTime || 0,
    duration: clip.duration || 0,
    trackId: clip.trackId,
    color: CLIP_COLORS[matType] || '#6b7280',
    materialId: clip.materialId || '',
    clipStart: clip.clipStart || 0,
    clipEnd: clip.clipEnd || 0,
    originalDuration: clip.originalDuration || 0,
    volume: isNaN(clip.volume) ? 1.0 : clip.volume,
    opacity: 1,
    thumbnailUrl: material.thumbnailUrl || '',
    // The canvas preview tells images from videos on a video track by this
    // field; without it agent-added images were never drawn.
    originalMaterialType: (material.type as MaterialType) || undefined,
  });
}

/** Auto-create a track to match the server-side addToTrack auto-creation. */
function createTrackForMaterial(
  state: TimelineState,
  trackId: string,
  materialType: string,
): Track {
  const matType = materialType || 'video';
  const trackType = (matType === 'image' ? 'video' : matType) as Track['type'];
  const track: Track = {
    id: trackId,
    name: `${trackType.charAt(0).toUpperCase() + trackType.slice(1)} Track`,
    type: trackType,
    height: trackType === 'audio' ? 60 : 80,
    isLocked: false,
    isMuted: false,
    isVisible: true,
    // 100 % is unity gain; the former 200 doubled every agent audio track.
    volume: 100,
    order: state.tracks.length,
    items: [],
  };
  state.tracks.push(track);
  return track;
}

function moveClipInState(state: TimelineState, operation: MoveClipOperation): void {
  const fromTrack = state.tracks.find(t => t.id === operation.fromTrackId);
  const idx = fromTrack
    ? fromTrack.items.findIndex(i => i.id === operation.clipId)
    : -1;
  if (!fromTrack || idx === -1) return;

  const [clip] = fromTrack.items.splice(idx, 1);
  clip.startTime = operation.newStartTime;
  clip.trackId = operation.toTrackId;
  state.tracks.find(t => t.id === operation.toTrackId)?.items.push(clip);
}

function findClipInState(
  state: TimelineState,
  clipId: string,
): TimelineItem | undefined {
  for (const track of state.tracks) {
    const clip = track.items.find(i => i.id === clipId);
    if (clip) return clip;
  }
  return undefined;
}

/** First locked track the operation would change, or null. */
function findLockedTrackId(
  state: TimelineState,
  operation: AgentTimelineOperation,
): string | null {
  const lockedIds = new Set(state.tracks.filter(t => t.isLocked).map(t => t.id));
  return touchedTrackIds(state, operation).find(id => lockedIds.has(id)) ?? null;
}

function touchedTrackIds(
  state: TimelineState,
  operation: AgentTimelineOperation,
): string[] {
  switch (operation.type) {
    case 'add_clip':
      return [operation.clip.trackId];
    case 'delete_clip':
      return [operation.trackId];
    case 'move_clip':
      return [operation.fromTrackId, operation.toTrackId];
    case 'trim_clip':
    case 'resize_clip': {
      const track = state.tracks.find(t =>
        t.items.some(i => i.id === operation.clipId),
      );
      return track ? [track.id] : [];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function createDefaultTimelineState(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [
      { id: 'video-track-1', name: 'Video Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [] },
      { id: 'image-track-1', name: 'Image Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [] },
      { id: 'audio-track-1', name: 'Audio Track 1', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 2, items: [] },
      { id: 'audio-track-2', name: 'Audio Track 2', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 3, items: [] },
      { id: 'subtitle-track-1', name: 'Subtitle Track', type: 'subtitle' as const, height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 4, items: [] },
    ],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: true,
    gridSize: 0.5,
    scrollLeft: 0,
  };
}

function computeTimelineEnd(state: TimelineState): number {
  let maxEnd = 0;
  for (const track of state.tracks) {
    for (const item of track.items) {
      maxEnd = Math.max(maxEnd, item.startTime + item.duration);
    }
  }
  return maxEnd;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
