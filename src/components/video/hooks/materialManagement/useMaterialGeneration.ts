import { Dispatch, MutableRefObject, SetStateAction, useCallback, useEffect, useRef } from 'react';
import { MaterialItem, StoryboardGenerateParams, StoryboardPack } from '@/types';
import { VideoEditingLogger } from '../../utils';
import { extractVideoThumbnail } from '../../utils/extractVideoThumbnail';
import { createArkVideoTask, getArkVideoStatus, ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import { generateArkImagesWithPack, ArkImageGenerateParams, ArkImagePack } from '@/lib/api/arkImage';
import { generateStoryboard } from '@/lib/api/storyboard';
import { generateUUID } from './materialDeleteHelpers';

interface UseMaterialGenerationParams {
  logger: VideoEditingLogger;
  isMountedRef: MutableRefObject<boolean>;
  setMaterials: Dispatch<SetStateAction<MaterialItem[]>>;
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
 * sinks so the material list stays single-source. Lifted verbatim from
 * useMaterialManagement; behaviour is unchanged.
 */
export function useMaterialGeneration(params: UseMaterialGenerationParams): UseMaterialGenerationReturn {
  const { logger, isMountedRef, setMaterials, addOrReplaceMaterial } = params;

  // AI视频生成轮询任务 ref: tempId -> current setTimeout handle
  const pendingAiTasks = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Clear all polling timers on unmount to prevent state updates on dead components
  useEffect(() => {
    const tasks = pendingAiTasks.current;
    return () => {
      tasks.forEach(id => clearTimeout(id));
      tasks.clear();
    };
  }, []);

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
      metadata: { ...baseMetadata },
    };
    setMaterials(prev => [placeholder, ...prev]);

    let arkTaskId: string;
    try {
      const result = await createArkVideoTask(params);
      arkTaskId = result.ark_task_id;
    } catch (error) {
      logger.error('创建Ark视频任务失败', error as Error);
      setMaterials(prev => prev.filter(m => m.id !== tempId));
      notifyFailed((error as Error)?.message || 'createArkVideoTask failed');
      return;
    }

    // Polling with simulated progress crawl and error retry cap
    let estimatedProgress = 0;
    let errorRetries = 0;
    const MAX_ERROR_RETRIES = 10;
    // After video generation succeeds, keep polling for OSS URL + thumbnail (max ~60s)
    let ossWaitRetries = 0;
    const MAX_OSS_WAIT_RETRIES = 20;

    const poll = async () => {
      // Slow progress crawl up to 90%
      estimatedProgress = Math.min(estimatedProgress + Math.random() * 3 + 1, 90);
      setMaterials(prev => prev.map(m =>
        m.id === tempId ? { ...m, downloadProgress: estimatedProgress } : m
      ));

      try {
        const status = await getArkVideoStatus(arkTaskId);
        errorRetries = 0; // reset on success

        if (status.status === 'succeeded' && status.video_url) {
          // OSS upload complete: backend returns thumbnail_url once video+thumbnail are on OSS
          if (status.thumbnail_url) {
            const finalMaterial: MaterialItem = {
              id: tempId,
              name: materialName,
              type: 'video',
              format: 'mp4',
              size: 0,
              url: status.video_url,
              serverUrl: status.video_url,
              thumbnailUrl: status.thumbnail_url,
              duration: status.duration,
              width: status.width,
              height: status.height,
              createdAt,
              downloadStatus: undefined,
              downloadProgress: undefined,
              metadata: { ...baseMetadata },
            };
            addOrReplaceMaterial(finalMaterial);
            pendingAiTasks.current.delete(tempId);
            notifySucceeded(finalMaterial);
            return;
          }

          // OSS upload still in progress: set CDN URL for instant playback, keep polling
          ossWaitRetries++;
          const cdnMaterial: MaterialItem = {
            id: tempId,
            name: materialName,
            type: 'video',
            format: 'mp4',
            size: 0,
            url: status.video_url,
            serverUrl: status.video_url,
            thumbnailUrl: undefined,
            duration: status.duration,
            width: status.width,
            height: status.height,
            createdAt,
            downloadStatus: 'generating',
            downloadProgress: 95,
            metadata: { ...baseMetadata },
          };
          addOrReplaceMaterial(cdnMaterial);

          if (ossWaitRetries >= MAX_OSS_WAIT_RETRIES) {
            // OSS upload timed out — finalise with CDN URL, extract thumbnail client-side
            logger.warn(`Ark视频OSS上传等待超时，使用CDN URL`, { arkTaskId, ossWaitRetries });
            const finalisedCdn: MaterialItem = { ...cdnMaterial, downloadStatus: undefined, downloadProgress: undefined };
            addOrReplaceMaterial(finalisedCdn);
            pendingAiTasks.current.delete(tempId);
            notifySucceeded(finalisedCdn);
            extractVideoThumbnail(status.video_url).then(dataUrl => {
              if (dataUrl && isMountedRef.current) {
                setMaterials(prev => prev.map(m =>
                  m.id === tempId ? { ...m, thumbnailUrl: dataUrl } : m
                ));
              }
            });
            return;
          }

          // Continue polling every 3s while waiting for OSS
          const timeoutId = setTimeout(poll, 3000);
          pendingAiTasks.current.set(tempId, timeoutId);
          return;
        }

        if (status.status === 'failed') {
          setMaterials(prev => prev.filter(m => m.id !== tempId));
          pendingAiTasks.current.delete(tempId);
          notifyFailed('ARK task status=failed');
          return;
        }

        // Still running — schedule next poll
        const timeoutId = setTimeout(poll, 5000);
        pendingAiTasks.current.set(tempId, timeoutId);
      } catch (error) {
        errorRetries++;
        logger.error(`轮询Ark视频状态失败 (retry ${errorRetries}/${MAX_ERROR_RETRIES})`, error as Error);

        if (errorRetries >= MAX_ERROR_RETRIES) {
          logger.error(`Ark视频轮询达到最大重试次数，放弃任务`, { arkTaskId, retries: errorRetries });
          setMaterials(prev => prev.filter(m => m.id !== tempId));
          pendingAiTasks.current.delete(tempId);
          notifyFailed(`polling exceeded max retries (${MAX_ERROR_RETRIES})`);
          return;
        }

        const timeoutId = setTimeout(poll, 5000);
        pendingAiTasks.current.set(tempId, timeoutId);
      }
    };

    const initialTimeout = setTimeout(poll, 5000);
    pendingAiTasks.current.set(tempId, initialTimeout);
  }, [logger, isMountedRef, setMaterials, addOrReplaceMaterial]);

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

    const pack = await generateStoryboard(params);

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
