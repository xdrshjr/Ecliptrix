'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useVideoEditingStore } from '@/stores/videoEditingStore';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import { addItemAction } from '../timeline/store/actions/addItem';
import type { AsyncTask } from '@/stores/slices/asyncTaskSlice';
import type { MaterialItem } from '@/types';
import { http } from '@/lib/api/http-client';
import { arkVideoPollDelay, arkVideoMaterialId, getArkVideoStatus, isArkVideoReady, type ArkVideoStatusResult } from '@/lib/api/arkVideo';

interface BatchScene extends Omit<ArkVideoStatusResult, 'status'> {
  frame_index: number;
  repeat_index?: number;
  status: 'queued' | 'generating' | 'success' | 'failed' | 'timeout';
}

function currentTask(task: AsyncTask): AsyncTask | undefined {
  const current = useVideoEditingStore.getState().getTask(task.taskId);
  return current?.createdAt === task.createdAt && ['pending', 'processing'].includes(current.status) ? current : undefined;
}

function videoMaterial(status: ArkVideoStatusResult, nativeId: string, name: string): MaterialItem {
  return {
    id: arkVideoMaterialId(status, nativeId), name, type: 'video', format: 'mp4', size: 0,
    url: status.video_url!, serverUrl: status.video_url, cacheUrl: status.video_url,
    thumbnailUrl: status.thumbnail_url, duration: status.duration, width: status.width,
    height: status.height, createdAt: new Date(), tags: ['ai-generated', 'ark-video'],
    metadata: { model: status.model, arkTaskId: status.ark_task_id ?? nativeId },
  };
}

function consumeTimeline(task: AsyncTask): void {
  const result = task.result as { materialId?: string; timelineConsumed?: boolean } | null;
  if (task.status !== 'completed' || !task.metadata.autoAddToTimeline || !result?.materialId || result.timelineConsumed) return;
  const store = useVideoEditingStore.getState();
  const material = store.materials.find(item => item.id === result.materialId);
  if (!material) return;
  const item = addItemAction(useTimelineStore.getState, '', material);
  if (item) store.updateTask(task.taskId, { result: { ...result, timelineConsumed: true } });
}

async function pollVideo(task: AsyncTask, signal: AbortSignal): Promise<void> {
  const nativeId = String(task.metadata.arkTaskId ?? '');
  if (!nativeId) throw new Error('video_task_not_found');
  const status = await getArkVideoStatus(nativeId, { signal });
  if (signal.aborted || !currentTask(task)) return;
  const store = useVideoEditingStore.getState();
  if (isArkVideoReady(status)) {
    const material = videoMaterial(status, nativeId, String(task.metadata.prompt || 'AI Video').slice(0, 40));
    if (!store.claimTaskCompletion(task.taskId, task.createdAt, { ...status, materialId: material.id, timelineConsumed: false })) return;
    store.addMaterial(material);
    consumeTimeline(store.getTask(task.taskId)!);
  } else if (status.status === 'failed' || status.status === 'timeout') {
    store.updateTask(task.taskId, { status: 'failed', error: status.error_code || status.error || 'video_generation_failed', result: status });
  } else {
    store.updateTask(task.taskId, { status: 'processing', progress: status.phase === 'downloading' || status.phase === 'validating' ? 95 : Math.min(90, (Date.now() - task.createdAt) / 2000) });
  }
}

async function pollStoryboard(task: AsyncTask, signal: AbortSignal): Promise<void> {
  const packId = String(task.metadata.packId ?? '');
  if (!packId) throw new Error('storyboard_job_not_found');
  const data = await http.get<{ success: boolean; statuses: BatchScene[] }>(
    `/api/storyboard/batch-video/status/${encodeURIComponent(packId)}`, { retries: 0, timeoutMs: 25000, signal },
  );
  if (signal.aborted || !currentTask(task)) return;
  if (!data.success || !Array.isArray(data.statuses)) throw new Error('invalid_provider_response');
  const store = useVideoEditingStore.getState();
  const scenes = data.statuses;
  const ready = scenes.filter(scene => scene.status === 'success' && scene.phase === 'ready' && scene.video_url?.startsWith('/api/storage/files/') && scene.ark_task_id);
  const failed = scenes.filter(scene => scene.status === 'failed' || scene.status === 'timeout');
  const previous = (task.result as { consumed?: string[] } | null)?.consumed ?? [];
  const consumed = new Set(previous);
  for (const scene of ready) {
    const material = videoMaterial({ ...scene, status: 'succeeded' }, scene.ark_task_id!, `Storyboard ${scene.frame_index + 1}`);
    if (consumed.has(material.id)) continue;
    store.addMaterial(material);
    consumed.add(material.id);
    store.updateStoryboard(`${packId}-frame-${scene.frame_index}`, {
      videoUrl: scene.video_url, metadata: { packId, frameIndex: scene.frame_index, videoMaterialId: material.id },
    });
  }
  const finished = scenes.length > 0 && ready.length + failed.length === scenes.length;
  store.updateTask(task.taskId, {
    status: finished ? (ready.length ? 'completed' : 'failed') : 'processing',
    progress: scenes.length ? Math.floor(100 * (ready.length + failed.length) / scenes.length) : 0,
    error: finished && !ready.length ? 'video_generation_failed' : null,
    result: { statuses: scenes, consumed: Array.from(consumed) },
  });
}

/** 每个任务只允许一个请求；跨挂载的完成判重由 store 终态负责。 */
export function AsyncTaskPoller() {
  const { t } = useLocale();
  const labels = t.integrations.videoGeneration;
  const tasks = useVideoEditingStore(state => state.tasks);
  const recoveryRequests = useRef(new Map<string, AbortController>());
  const [recovering, setRecovering] = useState<string[]>([]);
  const failedVideos = Object.values(tasks).filter(task => task.type === 'ai_video' && task.status === 'failed').slice(-3);
  const recover = async (task: AsyncTask) => {
    if (recoveryRequests.current.has(task.taskId)) return;
    const controller = new AbortController();
    recoveryRequests.current.set(task.taskId, controller);
    setRecovering(ids => [...ids, task.taskId]);
    try {
      const status = await getArkVideoStatus(String(task.metadata.arkTaskId), { retryArtifact: true, signal: controller.signal });
      const latest = useVideoEditingStore.getState().getTask(task.taskId);
      if (controller.signal.aborted || latest?.createdAt !== task.createdAt || latest.status !== 'failed') return;
      if (status.status === 'failed' || status.status === 'timeout') {
        useVideoEditingStore.getState().updateTask(task.taskId, { error: status.error_code || status.error || 'video_generation_failed' });
      } else {
        useVideoEditingStore.getState().updateTask(task.taskId, { status: 'pending', error: null, createdAt: Date.now(),
          metadata: { ...task.metadata, managedBy: undefined } });
      }
    } catch (error) {
      const latest = useVideoEditingStore.getState().getTask(task.taskId);
      if (!controller.signal.aborted && latest?.createdAt === task.createdAt) {
        useVideoEditingStore.getState().updateTask(task.taskId, { result: { recoveryError: error instanceof Error ? error.message : labels.retryFailed } });
      }
    } finally {
      recoveryRequests.current.delete(task.taskId);
      if (!controller.signal.aborted) setRecovering(ids => ids.filter(id => id !== task.taskId));
    }
  };
  useEffect(() => {
    const requests = recoveryRequests.current;
    return () => { requests.forEach(controller => controller.abort()); requests.clear(); };
  }, []);
  useEffect(() => {
    const active = new Map<string, AbortController>();
    const nextAt = new Map<string, number>();
    const failures = new Map<string, number>();
    let disposed = false;
    const poll = async (task: AsyncTask) => {
      if (disposed) return;
      const store = useVideoEditingStore.getState();
      if (Date.now() - task.createdAt >= 600000) {
        active.get(task.taskId)?.abort();
        store.updateTask(task.taskId, { status: 'failed', error: 'video_wait_timeout' });
        return;
      }
      if (active.has(task.taskId) || Date.now() < (nextAt.get(task.taskId) ?? 0)) return;
      const controller = new AbortController();
      active.set(task.taskId, controller);
      try {
        await (task.type === 'ai_video' ? pollVideo(task, controller.signal) : pollStoryboard(task, controller.signal));
        failures.delete(task.taskId);
        nextAt.set(task.taskId, Date.now() + 5000);
      } catch (error) {
        if (disposed || controller.signal.aborted || !currentTask(task)) return;
        const count = (failures.get(task.taskId) ?? 0) + 1;
        failures.set(task.taskId, count);
        const delay = arkVideoPollDelay(error, count);
        if (delay === null || Date.now() + delay - task.createdAt >= 600000) {
          store.updateTask(task.taskId, { status: 'failed', error: error instanceof Error ? error.message : 'video_status_unavailable' });
        } else nextAt.set(task.taskId, Date.now() + delay);
      } finally {
        active.delete(task.taskId);
      }
    };
    const tick = () => {
      const tasks = useVideoEditingStore.getState().tasks;
      for (const [id, controller] of Array.from(active.entries())) if (!tasks[id] || !['pending', 'processing'].includes(tasks[id].status)) controller.abort();
      for (const task of Object.values(tasks)) {
        if (task.status === 'completed') consumeTimeline(task);
        if (['pending', 'processing'].includes(task.status) && ['ai_video', 'storyboard_video'].includes(task.type) && task.metadata.managedBy !== 'material-generation') void poll(task);
      }
      for (const id of Array.from(nextAt.keys())) if (!tasks[id] || ['failed', 'completed'].includes(tasks[id].status)) {
        nextAt.delete(id); failures.delete(id);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    const cleanup = setInterval(() => useVideoEditingStore.getState().cleanupExpiredTasks(), 300000);
    return () => {
      disposed = true;
      clearInterval(timer); clearInterval(cleanup);
      for (const controller of Array.from(active.values())) controller.abort();
    };
  }, []);
  const messages: Record<string, string> = {
    video_download_failed: labels.downloadFailed,
    invalid_video_artifact: labels.invalidArtifact,
    video_cache_failed: labels.cacheFailed,
    generation_submission_unknown: labels.submissionUnknown,
    video_wait_timeout: labels.waitTimeout,
    video_configuration_changed: labels.configurationChanged,
    provider_authentication: labels.authenticationFailed,
  };
  if (!failedVideos.length) return null;
  return <aside className="fixed bottom-4 right-4 z-[10000] flex max-w-sm flex-col gap-2" aria-label={labels.statusLabel}>
    {failedVideos.map(task => <div key={task.taskId} role="alert" className="rounded-lg border border-border bg-background p-3 text-sm text-foreground shadow-lg">
      <p>{messages[task.error ?? ''] ?? task.error ?? labels.generationFailed}</p>
      {task.metadata.arkTaskId ? <p className="mt-1 break-all text-xs text-muted-foreground">{labels.taskLabel}：{String(task.metadata.arkTaskId)}</p> : null}
      {(task.result as { recoveryError?: string } | null)?.recoveryError && <p className="mt-1 text-red-400">{String((task.result as { recoveryError: string }).recoveryError)}</p>}
      <div className="mt-2 flex gap-3">
        {task.metadata.arkTaskId && ['video_download_failed', 'invalid_video_artifact', 'video_cache_failed', 'video_wait_timeout'].includes(task.error ?? '') ?
          <button type="button" disabled={recovering.includes(task.taskId)} onClick={() => void recover(task)} className="text-primary disabled:opacity-50">{labels.artifactRetry}</button> : null}
        <button type="button" onClick={() => useVideoEditingStore.getState().removeTask(task.taskId)} className="text-muted-foreground">{labels.dismiss}</button>
      </div>
    </div>)}
  </aside>;
}

export default AsyncTaskPoller;
