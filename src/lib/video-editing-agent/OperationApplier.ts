/**
 * OperationApplier — Applies Agent timeline operations to the React
 * timeline state and maintains per-operation snapshots for granular undo.
 *
 * Supports:
 *   - apply()             — apply a single operation with pre-snapshot capture
 *   - undoOperation()     — undo one specific operation by toolCallId
 *   - undoAll()           — restore the full pre-execution snapshot
 *   - getOperationHistory — read-only access for UI (undo buttons)
 *
 * Design notes:
 *   - The applier receives a `getTimelineState` / `setTimelineState` pair so
 *     it can read and write the React state without owning it.
 *   - Pre-snapshots are partial: only the tracks/clips affected by the
 *     operation are captured, minimizing memory for large timelines.
 *   - For `undoAll`, a full deep-clone of the entire timeline state is
 *     captured once at construction time.
 *
 * @module OperationApplier
 */

import type { TimelineState, AgentTimelineOperation, MaterialItem } from '@/types';
import type { AgentOperation, MaterialOperation, ScriptOperation, StoryboardOperation, AsyncTaskOperation } from './types';
import type { StoryboardItem } from '@/stores/slices/storyboardSlice';
import { useVideoEditingStore } from '@/stores';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OperationRecord {
  /** The toolCallId that produced this operation. */
  toolCallId: string;
  /** The operation that was applied. */
  operation: AgentTimelineOperation;
  /** Deep-cloned snapshot of the full timeline state BEFORE this operation. */
  preSnapshot: TimelineState;
}

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
  /** Called after each operation is applied. */
  onTimelineUpdate?: () => void;
  /**
   * Optional animation trigger: called with the operation after it is
   * applied (or before, for delete_clip) so the UI layer can add CSS
   * classes for visual feedback.
   */
  onTriggerAnimation?: (operation: AgentTimelineOperation) => void;
}

// ---------------------------------------------------------------------------
// OperationApplier
// ---------------------------------------------------------------------------

export class OperationApplier {
  private readonly config: OperationApplierConfig;
  private operations: OperationRecord[] = [];
  private nonTimelineRecords: NonTimelineUndoRecord[] = [];
  /**
   * Full deep-clone of the timeline state captured at construction time.
   * Used by undoAll() to restore the original state regardless of how
   * many operations were applied.
   */
  private readonly fullSnapshot: TimelineState | null;

  constructor(config: OperationApplierConfig) {
    this.config = config;
    // Capture the full initial snapshot for undoAll()
    const current = config.getTimelineState();
    this.fullSnapshot = current ? deepClone(current) : null;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Apply a timeline operation: capture pre-snapshot, mutate state, record.
   *
   * For delete_clip operations the animation is triggered BEFORE the
   * state mutation so the clip element still exists in the DOM for the
   * CSS animation. For all other operations the animation fires AFTER.
   */
  async apply(
    operation: AgentTimelineOperation,
    toolCallId: string,
  ): Promise<void> {
    let current = this.config.getTimelineState();
    if (!current) {
      console.warn('[OperationApplier] No timeline state — initializing default');
      current = {
        currentTime: 0,
        totalDuration: 0,
        zoomLevel: 1,
        selectedItems: [],
        tracks: [
          { id: 'video-track-1', name: 'Video Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 0, items: [] },
          { id: 'image-track-1', name: 'Image Track', type: 'video' as const, height: 80, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 1, items: [] },
          { id: 'audio-track-1', name: 'Audio Track 1', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 200, order: 2, items: [] },
          { id: 'audio-track-2', name: 'Audio Track 2', type: 'audio' as const, height: 60, isLocked: false, isMuted: false, isVisible: true, volume: 10, order: 3, items: [] },
          { id: 'subtitle-track-1', name: 'Subtitle Track', type: 'subtitle' as const, height: 50, isLocked: false, isMuted: false, isVisible: true, volume: 100, order: 4, items: [] },
        ],
        playbackRate: 1,
        isPlaying: false,
        snapToGrid: true,
        gridSize: 0.5,
        scrollLeft: 0,
      };
      this.config.setTimelineState(current);
    }

    // 1. Capture pre-snapshot (full state clone for accurate undo)
    const preSnapshot = deepClone(current);

    // 2. For delete operations, trigger animation BEFORE removal
    if (operation.type === 'delete_clip') {
      this.config.onTriggerAnimation?.(operation);
      // Brief non-blocking delay to let the animation class be applied
      await new Promise<void>(resolve =>
        requestAnimationFrame(() => setTimeout(resolve, 50)),
      );
    }

    // 3. Apply the operation to the timeline state
    this.applyToTimeline(operation);

    // 4. For non-delete operations, trigger animation AFTER application
    if (operation.type !== 'delete_clip') {
      this.config.onTriggerAnimation?.(operation);
    }

    // 5. Record the operation with its pre-snapshot
    this.operations.push({ toolCallId, operation, preSnapshot });

    // 6. Notify consumers
    this.config.onTimelineUpdate?.();
  }

  /**
   * Undo a specific operation identified by toolCallId.
   * Restores the timeline to the state captured before that operation,
   * then re-applies all subsequent operations (if any).
   *
   * Returns `true` if the operation was found and undone.
   */
  undoOperation(toolCallId: string): boolean {
    const idx = this.operations.findIndex(r => r.toolCallId === toolCallId);
    if (idx === -1) {
      console.warn(
        `[OperationApplier] undoOperation: toolCallId not found: ${toolCallId}`,
      );
      return false;
    }

    // Restore the pre-snapshot of the target operation
    const record = this.operations[idx];
    this.config.setTimelineState(deepClone(record.preSnapshot));

    // Re-apply all operations that came AFTER the undone one
    const remaining = this.operations.slice(idx + 1);
    // Remove the undone operation from history
    this.operations.splice(idx, 1);

    // Re-apply remaining operations on top of the restored state,
    // re-capturing preSnapshots so they reflect the post-undo world
    for (const r of remaining) {
      r.preSnapshot = deepClone(this.config.getTimelineState()!);
      this.applyToTimeline(r.operation);
    }

    this.config.onTimelineUpdate?.();
    return true;
  }

  /**
   * Undo all operations by restoring the full pre-execution snapshot.
   * Clears the entire operation history.
   */
  undoAll(): void {
    if (!this.fullSnapshot) {
      console.warn('[OperationApplier] undoAll: no initial snapshot available');
      return;
    }

    this.config.setTimelineState(deepClone(this.fullSnapshot));
    this.operations = [];
    this.config.onTimelineUpdate?.();
  }

  /**
   * Get a read-only view of all recorded operations.
   * Used by the UI to render undo buttons per tool call.
   */
  getOperationHistory(): ReadonlyArray<OperationRecord> {
    return this.operations;
  }

  /** Get the full initial snapshot (for external undo logic if needed). */
  getFullSnapshot(): TimelineState | null {
    return this.fullSnapshot ? deepClone(this.fullSnapshot) : null;
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
  // Internal: Apply operation to timeline state via setTimelineState
  // -----------------------------------------------------------------------

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

    switch (operation.type) {
      case 'add_clip': {
        let track = state.tracks.find(t => t.id === operation.clip.trackId);
        if (!track) {
          // Auto-create track to match server-side auto-creation in addToTrack tool
          const matType = operation.material.type || 'video';
          const trackType = (matType === 'image' ? 'video' : matType) as 'video' | 'audio' | 'subtitle';
          track = {
            id: operation.clip.trackId,
            name: `${trackType.charAt(0).toUpperCase() + trackType.slice(1)} Track`,
            type: trackType,
            height: trackType === 'audio' ? 60 : 80,
            isLocked: false,
            isMuted: false,
            isVisible: true,
            volume: trackType === 'audio' ? 200 : 100,
            order: state.tracks.length,
            items: [],
          };
          state.tracks.push(track);
        }
        {
          const { clip, material } = operation;
          const matType = material.type || track.type;
          const colorMap: Record<string, string> = {
            video: '#3b82f6',
            audio: '#10b981',
            image: '#8b5cf6',
          };
          track.items.push({
            id: clip.id,
            name: material.name || '',
            type: track.type,
            startTime: clip.startTime || 0,
            duration: clip.duration || 0,
            trackId: clip.trackId,
            color: colorMap[matType] || '#6b7280',
            materialId: clip.materialId || '',
            clipStart: clip.clipStart || 0,
            clipEnd: clip.clipEnd || 0,
            originalDuration: clip.originalDuration || 0,
            volume: isNaN(clip.volume) ? 1.0 : clip.volume,
            thumbnailUrl: material.thumbnailUrl || '',
          });
        }
        break;
      }

      case 'trim_clip': {
        for (const track of state.tracks) {
          const clip = track.items.find(i => i.id === operation.clipId);
          if (clip) {
            clip.clipStart = operation.clipStart;
            clip.clipEnd = operation.clipEnd;
            clip.duration = operation.duration;
            break;
          }
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

      case 'move_clip': {
        const fromTrack = state.tracks.find(
          t => t.id === operation.fromTrackId,
        );
        if (fromTrack) {
          const idx = fromTrack.items.findIndex(
            i => i.id === operation.clipId,
          );
          if (idx !== -1) {
            const [clip] = fromTrack.items.splice(idx, 1);
            clip.startTime = operation.newStartTime;
            clip.trackId = operation.toTrackId;
            const toTrack = state.tracks.find(
              t => t.id === operation.toTrackId,
            );
            if (toTrack) {
              toTrack.items.push(clip);
            }
          }
        }
        break;
      }

      case 'resize_clip': {
        for (const track of state.tracks) {
          const clip = track.items.find(i => i.id === operation.clipId);
          if (clip) {
            clip.duration = operation.newDuration;
            break;
          }
        }
        break;
      }
    }

    // Recalculate total duration
    let maxEnd = 0;
    for (const track of state.tracks) {
      for (const item of track.items) {
        const end = item.startTime + item.duration;
        if (end > maxEnd) maxEnd = end;
      }
    }
    state.totalDuration = Math.max(maxEnd, state.totalDuration);

    this.config.setTimelineState(state);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
