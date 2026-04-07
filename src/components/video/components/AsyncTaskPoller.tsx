'use client';

/**
 * AsyncTaskPoller — Background React component that polls the status of
 * active async AI generation tasks and updates the store when they
 * complete or fail.
 *
 * Mount this once inside the VideoEditingInterface. It renders nothing
 * visible; it only drives side effects (polling + store updates).
 *
 * Supported task types:
 *   - ai_video   → polls GET /api/ark-video/status/:arkTaskId
 *   - ai_image   → handled synchronously in generateAiImage.ts (no polling needed)
 *   - image_to_video → result is typically synchronous; polling is a fallback
 */

import { useEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVideoEditingStore } from '@/stores/videoEditingStore';
import type { AsyncTask, AsyncTaskType } from '@/stores/slices/asyncTaskSlice';
import { http, ApiError } from '@/lib/api/http-client';

// ---------------------------------------------------------------------------
// Polling interval per task type (ms)
// ---------------------------------------------------------------------------

const POLL_INTERVALS: Record<AsyncTaskType, number> = {
  ai_video: 5_000,
  ai_image: 3_000,
  image_to_video: 5_000,
  tts: 3_000,
  batch_tts: 5_000,
  storyboard_video: 5_000,
};

/** Tasks older than this are automatically marked as failed (10 minutes). */
const TASK_TIMEOUT_MS = 10 * 60 * 1000;

/** Cleanup interval for expired tasks (5 minutes). */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AsyncTaskPoller() {
  const timersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Subscribe to the tasks record — we only need keys/statuses to decide
  // which polls to start/stop.
  const tasks = useVideoEditingStore(useShallow((s) => s.tasks));

  // ---------------------------------------------------------------------------
  // Poll handler for a single task
  // ---------------------------------------------------------------------------

  const pollTask = useCallback(async (task: AsyncTask) => {
    const store = useVideoEditingStore.getState();

    // Check timeout
    if (Date.now() - task.createdAt > TASK_TIMEOUT_MS) {
      store.updateTask(task.taskId, {
        status: 'failed',
        error: 'Task timed out (exceeded 10 minutes). Please try again.',
      });
      return;
    }

    try {
      switch (task.type) {
        case 'ai_video':
          await pollAiVideoTask(task);
          break;
        // ai_image tasks are handled synchronously in the tool handler
        // — no polling needed. If somehow one ends up pending, just skip.
        case 'ai_image':
          break;
        case 'image_to_video':
          await pollImageToVideoTask(task);
          break;
        case 'storyboard_video':
          await pollStoryboardVideoTask(task);
          break;
        // Other task types (tts, batch_tts) are handled
        // by their own systems. We skip them here.
        default:
          break;
      }
    } catch (error) {
      console.error(`[AsyncTaskPoller] Error polling task ${task.taskId}:`, error);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Manage polling timers based on task state changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const activeTimers = timersRef.current;

    // Determine which tasks need polling
    const taskEntries = Object.values(tasks);
    const activeTaskIds = new Set<string>();

    for (const task of taskEntries) {
      const isActive = task.status === 'pending' || task.status === 'processing';
      // Only poll types that have async status endpoints
      const needsPolling = task.type === 'ai_video' || task.type === 'image_to_video' || task.type === 'storyboard_video';

      if (isActive && needsPolling) {
        activeTaskIds.add(task.taskId);

        // Start a timer if one doesn't exist
        if (!activeTimers.has(task.taskId)) {
          const interval = POLL_INTERVALS[task.type] ?? 5_000;
          const timer = setInterval(() => {
            // Re-read the task from the store to get latest status
            const currentTask = useVideoEditingStore.getState().getTask(task.taskId);
            if (!currentTask || currentTask.status === 'completed' || currentTask.status === 'failed') {
              // Stop polling for terminal tasks
              const t = activeTimers.get(task.taskId);
              if (t) {
                clearInterval(t);
                activeTimers.delete(task.taskId);
              }
              return;
            }
            pollTask(currentTask);
          }, interval);

          activeTimers.set(task.taskId, timer);

          // Also do an immediate first poll
          pollTask(task);
        }
      }
    }

    // Stop timers for tasks that are no longer active
    for (const [taskId, timer] of Array.from(activeTimers.entries())) {
      if (!activeTaskIds.has(taskId)) {
        clearInterval(timer);
        activeTimers.delete(taskId);
      }
    }
  }, [tasks, pollTask]);

  // ---------------------------------------------------------------------------
  // Periodic cleanup of expired tasks
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const cleanup = setInterval(() => {
      useVideoEditingStore.getState().cleanupExpiredTasks();
    }, CLEANUP_INTERVAL_MS);

    return () => clearInterval(cleanup);
  }, []);

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      const activeTimers = timersRef.current;
      for (const timer of Array.from(activeTimers.values())) {
        clearInterval(timer);
      }
      activeTimers.clear();
    };
  }, []);

  // This component renders nothing
  return null;
}

// ---------------------------------------------------------------------------
// AI Video polling
// ---------------------------------------------------------------------------

async function pollAiVideoTask(task: AsyncTask): Promise<void> {
  const store = useVideoEditingStore.getState();
  const arkTaskId = task.metadata.arkTaskId as string | undefined;

  if (!arkTaskId) {
    store.updateTask(task.taskId, {
      status: 'failed',
      error: 'Missing arkTaskId in task metadata',
    });
    return;
  }

  let data: any;
  try {
    data = await http.get<any>(`/api/ark-video/status/${arkTaskId}`);
  } catch (httpError) {
    // Transient error — don't fail the task, just log and retry next interval
    if (httpError instanceof ApiError) {
      console.warn(`[AsyncTaskPoller] Status check failed for ${task.taskId}: HTTP ${httpError.status}`);
    } else {
      console.warn(`[AsyncTaskPoller] Status check failed for ${task.taskId}:`, httpError);
    }
    return;
  }

  if (data.status === 'succeeded' && data.video_url) {
    // --- Task completed successfully ---
    store.updateTask(task.taskId, {
      status: 'completed',
      progress: 100,
      result: data,
    });

    // Create a material from the generated video
    const prompt = (task.metadata.prompt as string) || 'AI Video';
    const materialId = `ai-vid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const displayName =
      prompt.length > 25
        ? `AI Video: ${prompt.slice(0, 22)}...`
        : `AI Video: ${prompt}`;

    store.addMaterial({
      id: materialId,
      name: displayName,
      type: 'video',
      format: 'mp4',
      size: 0,
      duration: data.duration || (task.metadata.duration as number) || 5,
      width: data.width,
      height: data.height,
      url: data.video_url,
      thumbnailUrl: data.thumbnail_url,
      createdAt: new Date(),
      tags: ['ai-generated', 'ark-video'],
      description: `AI generated video: "${prompt.slice(0, 100)}"`,
    });

    console.log(`[AsyncTaskPoller] AI video task ${task.taskId} completed. Material added: ${materialId}`);
  } else if (data.status === 'failed') {
    // --- Task failed ---
    store.updateTask(task.taskId, {
      status: 'failed',
      error: data.error || 'Video generation failed',
    });
    console.warn(`[AsyncTaskPoller] AI video task ${task.taskId} failed: ${data.error}`);
  } else {
    // Still running — update progress estimate
    const elapsed = Date.now() - task.createdAt;
    const estimatedProgress = Math.min(90, Math.floor((elapsed / (3 * 60 * 1000)) * 100));
    store.updateTask(task.taskId, {
      status: 'processing',
      progress: Math.max(task.progress, estimatedProgress),
    });
  }
}

// ---------------------------------------------------------------------------
// Image-to-video polling (fallback for async backends)
// ---------------------------------------------------------------------------

async function pollImageToVideoTask(task: AsyncTask): Promise<void> {
  const store = useVideoEditingStore.getState();
  const backendTaskId = task.metadata.backendTaskId as string | undefined;

  if (!backendTaskId) {
    // No backend task ID means the result should have been synchronous.
    // If we're here, something went wrong.
    store.updateTask(task.taskId, {
      status: 'failed',
      error: 'Image-to-video task has no backend task ID for polling',
    });
    return;
  }

  // Use the same image-to-video endpoint with task_id query param
  let data: any;
  try {
    data = await http.get<any>(`/api/video/image-to-video?task_id=${backendTaskId}`);
  } catch (httpError) {
    if (httpError instanceof ApiError) {
      console.warn(`[AsyncTaskPoller] Status check failed for ${task.taskId}: HTTP ${httpError.status}`);
    } else {
      console.warn(`[AsyncTaskPoller] Status check failed for ${task.taskId}:`, httpError);
    }
    return;
  }

  if (data.success && data.video_url) {
    store.updateTask(task.taskId, {
      status: 'completed',
      progress: 100,
      result: data,
    });

    const sourceName = (task.metadata.sourceMaterialName as string) || 'Image';
    const materialId = `i2v-mat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    store.addMaterial({
      id: materialId,
      name: `Video from: ${sourceName.slice(0, 30)}`,
      type: 'video',
      format: 'mp4',
      size: 0,
      duration: data.duration || (task.metadata.duration as number) || 5,
      width: data.width,
      height: data.height,
      url: data.video_url,
      thumbnailUrl: data.thumbnail_url || (task.metadata.sourceImageUrl as string),
      createdAt: new Date(),
      tags: ['image-to-video', 'generated'],
      description: `Video generated from image "${sourceName}"`,
    });

    console.log(`[AsyncTaskPoller] Image-to-video task ${task.taskId} completed. Material added: ${materialId}`);
  } else if (data.status === 'failed' || data.error) {
    store.updateTask(task.taskId, {
      status: 'failed',
      error: data.error || data.message || 'Image-to-video conversion failed',
    });
  } else {
    // Still processing
    store.updateTask(task.taskId, { status: 'processing' });
  }
}

// ---------------------------------------------------------------------------
// Storyboard video polling
// ---------------------------------------------------------------------------

async function pollStoryboardVideoTask(task: AsyncTask): Promise<void> {
  const store = useVideoEditingStore.getState();
  const packId = task.metadata.packId as string | undefined;

  if (!packId) {
    store.updateTask(task.taskId, {
      status: 'failed',
      error: 'Missing packId in task metadata',
    });
    return;
  }

  let data: any;
  try {
    data = await http.get<any>(`/api/storyboard/batch-video/status/${packId}`);
  } catch (httpError) {
    if (httpError instanceof ApiError) {
      console.warn(`[AsyncTaskPoller] Storyboard video status check failed for ${task.taskId}: HTTP ${httpError.status}`);
    } else {
      console.warn(`[AsyncTaskPoller] Storyboard video status check failed for ${task.taskId}:`, httpError);
    }
    return;
  }

  if (!data.success) {
    console.warn(`[AsyncTaskPoller] Storyboard video status error: ${data.message}`);
    return;
  }

  const statuses: Array<{
    frame_index: number;
    status: string;
    video_url?: string;
    thumbnail_url?: string;
    duration?: number;
    error?: string;
  }> = data.statuses || [];

  if (statuses.length === 0) return;

  // Count completed and failed
  const completed = statuses.filter((s) => s.status === 'succeeded');
  const failed = statuses.filter((s) => s.status === 'failed');
  const total = statuses.length;
  const allDone = completed.length + failed.length === total;

  // Update progress estimate
  const progress = Math.floor(((completed.length + failed.length) / total) * 100);

  // --- Process completed scenes: add materials and update storyboard ---
  for (const scene of completed) {
    if (!scene.video_url) continue;

    const materialId = `sb-vid-${packId}-f${scene.frame_index}-${Math.random().toString(36).slice(2, 6)}`;
    const existingMaterial = store.materials.find(
      (m) => m.url === scene.video_url && m.tags?.includes(`storyboard-${packId}`),
    );

    if (!existingMaterial) {
      store.addMaterial({
        id: materialId,
        name: `Storyboard Scene ${scene.frame_index + 1}`,
        type: 'video',
        format: 'mp4',
        size: 0,
        duration: scene.duration || 5,
        url: scene.video_url,
        thumbnailUrl: scene.thumbnail_url,
        createdAt: new Date(),
        tags: ['ai-generated', 'storyboard-video', `storyboard-${packId}`],
        description: `Storyboard scene ${scene.frame_index + 1} from pack ${packId}`,
      });

      // Update the corresponding StoryboardItem with video info
      const itemId = `${packId}-frame-${scene.frame_index}`;
      store.updateStoryboard(itemId, {
        videoUrl: scene.video_url,
        metadata: {
          packId,
          frameIndex: scene.frame_index,
          videoMaterialId: materialId,
        },
      });

      console.log(
        `[AsyncTaskPoller] Storyboard video scene ${scene.frame_index} completed. Material added: ${materialId}`,
      );
    }
  }

  if (allDone) {
    if (failed.length === total) {
      // All failed
      store.updateTask(task.taskId, {
        status: 'failed',
        progress: 100,
        error: `All ${total} scene video generations failed.`,
        result: { statuses },
      });
    } else {
      // At least some succeeded
      store.updateTask(task.taskId, {
        status: 'completed',
        progress: 100,
        result: {
          statuses,
          completedScenes: completed.length,
          failedScenes: failed.length,
          totalScenes: total,
        },
      });
    }
    console.log(
      `[AsyncTaskPoller] Storyboard video task ${task.taskId} finished: ${completed.length} succeeded, ${failed.length} failed out of ${total}.`,
    );
  } else {
    store.updateTask(task.taskId, {
      status: 'processing',
      progress: Math.max(task.progress, progress),
    });
  }
}

export default AsyncTaskPoller;
