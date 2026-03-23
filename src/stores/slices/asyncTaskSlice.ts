/**
 * asyncTaskSlice — Tracks long-running async tasks (AI video generation,
 * TTS, image generation, etc.) so the UI can show progress and the Agent
 * system can reference pending work without blocking the conversation.
 *
 * Uses a Map<string, AsyncTask> for O(1) lookup by taskId.
 * Includes automatic cleanup of expired tasks (completed/failed > 30 min).
 */

import type { StateCreator } from 'zustand';
import type { VideoEditingStore } from '../videoEditingStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AsyncTaskType =
  | 'ai_video'
  | 'ai_image'
  | 'image_to_video'
  | 'tts'
  | 'batch_tts'
  | 'storyboard_video';

export type AsyncTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AsyncTask {
  taskId: string;
  type: AsyncTaskType;
  status: AsyncTaskStatus;
  progress: number; // 0-100
  result: unknown | null;
  error: string | null;
  createdAt: number; // Date.now()
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Tasks that have been completed or failed for longer than this are pruned. */
const TASK_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Slice state + actions
// ---------------------------------------------------------------------------

export interface AsyncTaskSlice {
  // State — stored as a plain object keyed by taskId for JSON-serialisability,
  // but provides O(1) lookup semantics just like a Map.
  tasks: Record<string, AsyncTask>;

  // Actions
  addTask: (task: AsyncTask) => void;
  updateTask: (taskId: string, patch: Partial<AsyncTask>) => void;
  removeTask: (taskId: string) => void;

  // Derived helpers (computed from state, but exposed as actions for
  // convenient use from non-React code via getState())
  getActiveTasks: () => AsyncTask[];
  getTasksByType: (type: AsyncTaskType) => AsyncTask[];
  getTask: (taskId: string) => AsyncTask | undefined;

  // Maintenance
  cleanupExpiredTasks: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withExpiredRemoved(
  tasks: Record<string, AsyncTask>,
): Record<string, AsyncTask> {
  const now = Date.now();
  const result: Record<string, AsyncTask> = {};
  for (const [id, task] of Object.entries(tasks)) {
    const isTerminal = task.status === 'completed' || task.status === 'failed';
    const isExpired = isTerminal && now - task.createdAt > TASK_EXPIRY_MS;
    if (!isExpired) {
      result[id] = task;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Slice creator
// ---------------------------------------------------------------------------

export const createAsyncTaskSlice: StateCreator<
  VideoEditingStore,
  [],
  [],
  AsyncTaskSlice
> = (set, get) => ({
  // Initial state
  tasks: {},

  // Actions
  addTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.taskId]: task },
    })),

  updateTask: (taskId, patch) =>
    set((state) => {
      const existing = state.tasks[taskId];
      if (!existing) return state;
      return {
        tasks: {
          ...state.tasks,
          [taskId]: { ...existing, ...patch },
        },
      };
    }),

  removeTask: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...remaining } = state.tasks;
      return { tasks: remaining };
    }),

  // Derived helpers — read from current state snapshot
  getActiveTasks: () => {
    const { tasks } = get();
    return Object.values(tasks).filter(
      (t) => t.status === 'pending' || t.status === 'processing',
    );
  },

  getTasksByType: (type) => {
    const { tasks } = get();
    return Object.values(tasks).filter((t) => t.type === type);
  },

  getTask: (taskId) => {
    const { tasks } = get();
    return tasks[taskId];
  },

  // Maintenance
  cleanupExpiredTasks: () =>
    set((state) => ({
      tasks: withExpiredRemoved(state.tasks),
    })),
});
