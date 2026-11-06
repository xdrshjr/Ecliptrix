import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from 'react';
import { reportCredentialMissing } from '@/lib/credentialMissing';
import { MaterialItem, StoryboardGenerateParams, StoryboardPack } from '@/types';
import { VideoEditingLogger } from '../../utils';
import { useVideoEditingStore } from '@/stores/videoEditingStore';
import { createArkVideoTask, getArkVideoStatus, arkVideoPollDelay, isArkVideoReady, arkVideoMaterialId, ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import { generateArkImagesWithPack, ArkImageGenerateParams, ArkImagePack } from '@/lib/api/arkImage';
import { generateStoryboard } from '@/lib/api/storyboard';
import { generateUUID } from './materialDeleteHelpers';
import { ApiError } from '@/lib/api/http-client';

interface UseMaterialGenerationParams {
  logger: VideoEditingLogger;
  isMountedRef: MutableRefObject<boolean>;
  setMaterials: Dispatch<SetStateAction<MaterialItem[]>>;
  materialsRef: MutableRefObject<MaterialItem[]>;
  addOrReplaceMaterial: (material: MaterialItem) => boolean;
}

interface AiVideoGenerateOptions {
  metadataExtras?: Record<string, any>;
  onSucceeded?: (material: MaterialItem) => void;
  onFailed?: (reason: string) => void;
}

export interface UseMaterialGenerationReturn {
  handleAiVideoGenerate: (params: ArkVideoGenerateParams, options?: AiVideoGenerateOptions) => Promise<void>;
  handleAiImageGenerate: (params: ArkImageGenerateParams) => Promise<ArkImagePack | null>;
  handleStoryboardGenerate: (params: StoryboardGenerateParams) => Promise<StoryboardPack>;
}

/**
 * useMaterialGeneration Hook
 *
 * Owns the AI-generation flows (ARK video / ARK image / storyboard) plus the
 * polling-timer registry and its unmount cleanup. Placeholder cards and final
 * materials are pushed through the shared `setMaterials` / `addOrReplaceMaterial`
 * sinks so the material list stays single-source. Task ownership uses the
 * panel's local material snapshot; the shared store only receives Agent assets.
 */
export function useMaterialGeneration(params: UseMaterialGenerationParams): UseMaterialGenerationReturn {
  const { logger, isMountedRef, setMaterials, materialsRef, addOrReplaceMaterial } = params;

  // AI视频生成轮询任务 ref: tempId -> current setTimeout handle
  const pendingAiTasks = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pendingAiControllers = useRef(new Map<string, AbortController>());

  // Clear all polling timers on unmount to prevent state updates on dead components
  useEffect(() => {
    const tasks = pendingAiTasks.current;
    const controllers = pendingAiControllers.current;
    // A restored placeholder has no live owner in this hook instance. Its
    // remote task may still run, so remove the spinner without submitting again.
    setMaterials(previous => previous.filter(material =>
      material.downloadStatus !== 'generating' ||
      (material.metadata?.generationOwner !== 'material-generation' &&
        !['ark-ai-video', 'narration-ai-video'].includes(String(material.metadata?.source)))));
    return () => {
      tasks.forEach(id => clearTimeout(id));
      for (const [placeholderId, controller] of Array.from(controllers)) {
        controller.abort();
        const store = useVideoEditingStore.getState();
        const task = store.getTask(`manual-ai-video-${placeholderId}`);
        if (task && ['pending', 'processing'].includes(task.status)) {
          store.updateTask(task.taskId, { status: 'failed',
            error: task.metadata.arkTaskId ? 'video_wait_timeout' : 'generation_submission_unknown' });
        }
      }
      tasks.clear();
      controllers.clear();
    };
  }, [setMaterials]);

  // AI视频生成
  const handleAiVideoGenerate = useCallback(async (
    params: ArkVideoGenerateParams,
    options?: AiVideoGenerateOptions,
  ) => {
    const tempId = generateUUID();
    const createdAt = new Date();
    // Use timestamp-based name so the material has a stable, identifiable name
    const materialName = `AI视频_${createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    // Merge metadata extras (extras win for source etc., but prompt is always baseline)
    const baseMetadata: Record<string, any> = { source: 'ark-ai-video', prompt: params.prompt, ...(options?.metadataExtras ?? {}) };

    // Idempotent callback guard: ensure onSucceeded/onFailed fires at most once in total
    let notified = false;
    const notifySucceeded = (m: MaterialItem) => {
      if (notified) return;
      notified = true;
      try { options?.onSucceeded?.(m); } catch (e) { logger.error('onSucceeded callback threw', e as Error); }
    };
    const notifyFailed = (reason: string) => {
      if (notified) return;
      notified = true;
      try { options?.onFailed?.(reason); } catch (e) { logger.error('onFailed callback threw', e as Error); }
    };

    // Insert placeholder card at the front of the list
    const placeholder: MaterialItem = {
      id: tempId,
      name: materialName,
      type: 'video',
      format: 'mp4',
      size: 0,
      url: '',
      createdAt,
      downloadStatus: 'generating',
      downloadProgress: 0,
      metadata: { ...baseMetadata, generationOwner: 'material-generation' },
    };
    materialsRef.current = [placeholder, ...materialsRef.current];
    setMaterials(prev => [placeholder, ...prev]);

    const requestToken = setTimeout(() => {}, 0);
    pendingAiTasks.current.set(tempId, requestToken);
    const controller = new AbortController();
    pendingAiControllers.current.set(tempId, controller);
    const release = () => {
      clearTimeout(pendingAiTasks.current.get(tempId));
      pendingAiTasks.current.delete(tempId);
      pendingAiControllers.current.delete(tempId);
      controller.abort();
    };
    const taskId = `manual-ai-video-${tempId}`;
    const taskCreatedAt = createdAt.getTime();
    useVideoEditingStore.getState().addTask({ taskId, createdAt: taskCreatedAt, type: 'ai_video',
      status: 'pending', progress: 0, result: null, error: null,
      metadata: { managedBy: 'material-generation', placeholderId: tempId } });
    const current = () => {
      const state = useVideoEditingStore.getState();
      const task = state.getTask(taskId);
      return isMountedRef.current && pendingAiTasks.current.has(tempId) && task?.createdAt === taskCreatedAt &&
        (task.status === 'pending' || task.status === 'processing') && materialsRef.current.some(m => m.id === tempId);
    };
    const abandon = () => {
      release();
      const store = useVideoEditingStore.getState();
      const task = store.getTask(taskId);
      if (task?.createdAt === taskCreatedAt && ['pending', 'processing'].includes(task.status)) store.removeTask(taskId);
    };
    let arkTaskId: string;
    try {
      const result = await createArkVideoTask(params);
      if (!current()) { abandon(); return; }
      arkTaskId = result.ark_task_id;
    } catch (error) {
      if (!current()) { abandon(); return; }
      reportCredentialMissing(error);
      logger.error('创建Ark视频任务失败', error as Error);
      setMaterials(prev => prev.filter(m => m.id !== tempId));
      release();
      useVideoEditingStore.getState().updateTask(taskId, { status: 'failed', error: (error as Error)?.message || 'generation_submission_unknown' });
      notifyFailed((error as Error)?.message || '受理状态未知，供应商可能仍在生成');
      if (error instanceof ApiError && error.status === 409) throw error;
      return;
    }

    useVideoEditingStore.getState().updateTask(taskId, {
      metadata: { arkTaskId, managedBy: 'material-generation', placeholderId: tempId, prompt: params.prompt } });
    let errorRetries = 0;
    let inFlight = false;
    const fail = (reason: string) => {
      release();
      useVideoEditingStore.getState().updateTask(taskId, { status: 'failed', error: reason });
      setMaterials(prev => prev.filter(m => m.id !== tempId));
      notifyFailed(reason);
    };
    const schedule = (delay: number) => {
      if (current()) pendingAiTasks.current.set(tempId, setTimeout(poll, delay));
    };
    const poll = async () => {
      if (!current()) { abandon(); return; }
      if (inFlight) return;
      if (Date.now() - taskCreatedAt >= 600000) { fail('本地等待超时，供应商任务可能仍在生成'); return; }
      inFlight = true;
      try {
        const status = await getArkVideoStatus(arkTaskId, { signal: controller.signal });
        if (!current()) { abandon(); return; }
        errorRetries = 0;
        if (isArkVideoReady(status)) {
          const materialId = arkVideoMaterialId(status, arkTaskId);
          const finalMaterial: MaterialItem = {
            id: materialId, name: materialName, type: 'video', format: 'mp4', size: 0,
            url: status.video_url!, serverUrl: status.video_url, cacheUrl: status.video_url,
            thumbnailUrl: status.thumbnail_url, duration: status.duration, width: status.width,
            height: status.height, createdAt,
            metadata: { ...baseMetadata, model: status.model, arkTaskId: status.ark_task_id ?? arkTaskId },
          };
          if (!useVideoEditingStore.getState().claimTaskCompletion(taskId, taskCreatedAt, { ...status, materialId })) return;
          setMaterials(prev => {
            if (!prev.some(m => m.id === tempId)) return prev;
            return [finalMaterial, ...prev.filter(m => m.id !== tempId && m.id !== materialId)];
          });
          release();
          notifySucceeded(finalMaterial);
          return;
        }
        if (status.status === 'failed' || status.status === 'timeout') {
          fail(status.error_code || status.error || '视频生成失败'); return;
        }
        setMaterials(prev => prev.map(m => m.id === tempId ? { ...m, downloadProgress: status.phase === 'downloading' || status.phase === 'validating' ? 95 : Math.min(90, (Date.now() - taskCreatedAt) / 2000) } : m));
        schedule(5000);
      } catch (error) {
        if (!current()) { abandon(); return; }
        const delay = arkVideoPollDelay(error, ++errorRetries);
        if (delay === null || Date.now() + delay - taskCreatedAt >= 600000) fail(error instanceof Error ? error.message : '视频状态读取失败');
        else schedule(delay);
      } finally {
        inFlight = false;
      }
    };
    pendingAiTasks.current.set(tempId, setTimeout(poll, 5000));
  }, [logger, isMountedRef, setMaterials, materialsRef, addOrReplaceMaterial]);

  // AI图像生成
  const handleAiImageGenerate = useCallback(async (params: ArkImageGenerateParams) => {
    const createdAt = new Date();
    const timeStr = createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Determine name prefix based on mode
    const mode = params.mode || 'basic';
    const namePrefix = mode === 'character' ? 'AI人物建模' : mode === 'scene' ? 'AI场景建模' : 'AI图像';

    // Insert placeholder cards for each requested image
    const placeholderIds: string[] = [];
    for (let i = 0; i < params.count; i++) {
      const tempId = generateUUID();
      placeholderIds.push(tempId);
      const placeholder: MaterialItem = {
        id: tempId,
        name: `${namePrefix}_${timeStr}_${i + 1}`,
        type: 'image',
        format: 'png',
        size: 0,
        url: '',
        createdAt,
        downloadStatus: 'generating',
        downloadProgress: 0,
        metadata: { source: 'ark-ai-image', prompt: params.prompt, mode },
      };
      setMaterials(prev => [placeholder, ...prev]);
    }

    try {
      const { images, pack } = await generateArkImagesWithPack(params);

      // Grid pack mode (character/scene): single composite material + pack
      // handled by the MaterialsPanel pack list. Replace first placeholder
      // with the composite and drop any extras.
      if (pack) {
        const [first, ...rest] = placeholderIds;
        const composite = images[0];
        if (first && composite) {
          const finalMaterial: MaterialItem = {
            id: first,
            name: `${namePrefix}_${timeStr}`,
            type: 'image',
            format: 'png',
            size: 0,
            url: composite.image_url,
            serverUrl: composite.image_url,
            thumbnailUrl: composite.image_url,
            width: composite.width,
            height: composite.height,
            createdAt,
            downloadStatus: undefined,
            downloadProgress: undefined,
            metadata: {
              source: 'ark-ai-image',
              prompt: params.prompt,
              mode,
              packId: pack.pack_id,
              packType: pack.pack_type,
            },
          };
          addOrReplaceMaterial(finalMaterial);
        }
        if (rest.length) {
          setMaterials(prev => prev.filter(m => !rest.includes(m.id)));
        }
        return pack;
      }

      // Legacy / basic mode: replace placeholders with per-image results.
      for (let i = 0; i < placeholderIds.length; i++) {
        const placeholderId = placeholderIds[i];
        const image = images[i];

        if (image) {
          const finalMaterial: MaterialItem = {
            id: placeholderId,
            name: `${namePrefix}_${timeStr}_${i + 1}`,
            type: 'image',
            format: 'png',
            size: 0,
            url: image.image_url,
            serverUrl: image.image_url,
            thumbnailUrl: image.image_url,
            width: image.width,
            height: image.height,
            createdAt,
            downloadStatus: undefined,
            downloadProgress: undefined,
            metadata: { source: 'ark-ai-image', prompt: params.prompt, mode },
          };
          addOrReplaceMaterial(finalMaterial);
        } else {
          // No corresponding image returned — remove placeholder
          setMaterials(prev => prev.filter(m => m.id !== placeholderId));
        }
      }
      return null;
    } catch (error) {
      reportCredentialMissing(error);
      logger.error('AI图像生成失败', error as Error);
      // Remove all placeholders on failure
      setMaterials(prev => prev.filter(m => !placeholderIds.includes(m.id)));
      throw error;
    }
  }, [logger, setMaterials, addOrReplaceMaterial]);

  // 分镜包生成
  const handleStoryboardGenerate = useCallback(async (params: StoryboardGenerateParams): Promise<StoryboardPack> => {
    const createdAt = new Date();
    const timeStr = createdAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let pack: StoryboardPack;
    try {
      pack = await generateStoryboard(params);
    } catch (error) {
      reportCredentialMissing(error);
      throw error;
    }

    // 分镜包不再加到 materials[] — 由 MaterialsPanel 的 storyboardPacks[] 单独管理
    logger.info(`分镜包生成成功: ${pack.packId}, ${pack.frameCount} 帧`);

    return pack;
  }, [logger]);

  return {
    handleAiVideoGenerate,
    handleAiImageGenerate,
    handleStoryboardGenerate,
  };
}
