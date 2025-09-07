import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { MaterialItem } from '@/types';
import { UseAIVideoGenerationReturn, AIVideoGenerationRequest, VideoInfo } from '../types';
import { VideoEditingLogger } from '../utils';
import { createAIVideoGenerationService, AIVideoGenerationService } from '../services/aiVideoGenerationService';
import { uploadVideoToSupabase, VideoUploadErrorResponse } from '@/lib/api/supabase';

export const useAIVideoGeneration = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseAIVideoGenerationReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useAIVideoGeneration'
  }), [taskId]);

  const aiVideoService = useMemo(() => createAIVideoGenerationService(taskId), [taskId]);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const downloadedPromptIds = useRef<Set<string>>(new Set());

  // 弹窗状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedVideos, setGeneratedVideos] = useState<VideoInfo[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'pending' | 'processing' | 'completed' | 'failed'>('idle');
  const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);

  // 生成参数
  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('低质量，模糊，静态，细节模糊不清');
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(800);
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [steps, setSteps] = useState(8);
  const [seed, setSeed] = useState<number | null>(null);
  const [enableLora, setEnableLora] = useState(true);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | null>(null);

  // 清理轮询
  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
      logger.debug('清理轮询定时器');
    }
  }, [logger]);

  // 组件卸载时清理轮询
  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

  // 自动上传到Supabase
  const handleAutoUploadToSupabase = useCallback(async (promptId: string, videos: VideoInfo[]) => {
    logger.info('开始自动上传视频到Supabase', { promptId, videosCount: videos.length });

    try {
      for (const video of videos) {
        try {
          // 下载视频文件
          logger.info('下载视频文件', { promptId, filename: video.filename });
          const videoUrl = await aiVideoService.downloadVideo(promptId);
          
          // 将blob URL转换为File对象
          const response = await fetch(videoUrl);
          const blob = await response.blob();
          const file = new File([blob], `ai_video_${promptId}.mp4`, { type: 'video/mp4' });
          
          logger.info('准备上传视频到Supabase', {
            promptId,
            filename: file.name,
            fileSize: file.size
          });

          // 上传到Supabase
          const uploadResult = await uploadVideoToSupabase({
            file,
            taskId,
            customFilename: `ai_video_${promptId}`,
            generateThumbnail: true
          });

          if (uploadResult.success) {
            logger.info('视频上传Supabase成功', {
              promptId,
              videoUrl: uploadResult.video_url,
              thumbnailUrl: uploadResult.thumbnail_url
            });

            // 创建最终的素材项，使用与"生成中"素材相同的ID来替换它
            const finalMaterialItem: MaterialItem = {
              id: `ai-video-generating-${promptId}`, // 使用相同的ID来替换生成中的素材
              name: `AI生成视频_${promptId.substring(0, 8)}`,
              type: 'video',
              format: 'mp4',
              url: uploadResult.video_url,
              thumbnailUrl: uploadResult.thumbnail_url,
              size: uploadResult.file_size,
              duration: uploadResult.duration,
              downloadStatus: 'completed' as const,
              downloadProgress: 100,
              createdAt: new Date(),
              metadata: {
                source: 'ai_video_generation',
                promptId,
                originalFilename: video.filename,
                width: uploadResult.width,
                height: uploadResult.height,
                generatedAt: new Date().toISOString(),
                prompt: positivePrompt.substring(0, 200),
                parameters: {
                  width,
                  height,
                  durationSeconds,
                  steps,
                  enableLora,
                  aspectRatio
                }
              }
            };

            const success = onAddMaterials([finalMaterialItem]);
            if (success) {
              logger.info('AI视频素材已添加到素材库', { materialId: finalMaterialItem.id });
            } else {
              logger.error('添加AI视频素材到素材库失败', new Error('onAddMaterials returned false'));
            }
          } else {
            logger.error('视频上传Supabase失败', new Error(uploadResult.message), {
              promptId,
              errorCode: (uploadResult as VideoUploadErrorResponse).error_code
            });
          }

          // 清理临时URL
          URL.revokeObjectURL(videoUrl);
          
        } catch (error) {
          logger.error('处理单个视频时发生错误', error as Error, {
            promptId,
            videoFilename: video.filename
          });
        }
      }
    } catch (error) {
      logger.error('自动上传视频到Supabase时发生错误', error as Error, { promptId });
    }
  }, [aiVideoService, taskId, onAddMaterials, logger, positivePrompt, width, height, durationSeconds, steps, enableLora, aspectRatio]);

  // 开始轮询状态
  const startPolling = useCallback((promptId: string) => {
    logger.info('开始轮询视频生成状态', { promptId });
    
    clearPolling(); // 清理之前的轮询
    
    // 添加生成中的素材到素材库
    const generatingMaterial: MaterialItem = {
      id: `ai-video-generating-${promptId}`,
      name: 'AI视频生成中...',
      type: 'video',
      format: 'mp4',
      size: 0,
      url: '', // 占位URL
      downloadStatus: 'generating' as const,
      downloadProgress: 0,
      createdAt: new Date(),
      metadata: {
        promptId,
        isAIVideoGeneration: true,
        progress: 0
      }
    };
    
    const addResult = onAddMaterials([generatingMaterial]);
    if (addResult) {
      logger.info('已添加生成中的AI视频素材到素材库', { 
        materialId: generatingMaterial.id,
        promptId 
      });
    }
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const status = await aiVideoService.getGenerationStatus(promptId);
        
        logger.debug('轮询获取状态', {
          promptId,
          status: status.status,
          progress: status.progress,
          videosCount: status.videos?.length || 0
        });

        setGenerationStatus(status.status);
        setGenerationProgress((status.progress || 0) * 100);
        
        // 更新生成中素材的进度
        const updatedGeneratingMaterial: MaterialItem = {
          id: `ai-video-generating-${promptId}`,
          name: `AI视频生成中... ${Math.round((status.progress || 0) * 100)}%`,
          type: 'video',
          format: 'mp4',
          size: 0,
          url: '', // 占位URL
          downloadStatus: 'generating' as const,
          downloadProgress: (status.progress || 0) * 100,
          createdAt: new Date(),
          metadata: {
            promptId,
            isAIVideoGeneration: true,
            progress: (status.progress || 0) * 100
          }
        };
        
        onAddMaterials([updatedGeneratingMaterial]); // 这会更新现有的素材

        if (status.status === 'completed') {
          logger.info('视频生成完成', {
            promptId,
            videosCount: status.videos?.length || 0
          });
          
          setIsGenerating(false);
          setGeneratedVideos(status.videos || []);
          clearPolling();
          
          // 自动下载并上传到Supabase
          if (status.videos && status.videos.length > 0 && !downloadedPromptIds.current.has(promptId)) {
            downloadedPromptIds.current.add(promptId);
            await handleAutoUploadToSupabase(promptId, status.videos);
          }
          
        } else if (status.status === 'failed') {
          logger.error('视频生成失败', new Error(status.error_message || 'Unknown error'), { promptId });
          
          setIsGenerating(false);
          setGenerationError(status.error_message || '视频生成失败');
          clearPolling();
        }
      } catch (error) {
        logger.error('轮询状态时发生错误', error as Error, { promptId });
        // 不中断轮询，继续尝试
      }
    }, 3000); // 3秒轮询一次
  }, [aiVideoService, logger, clearPolling, onAddMaterials, handleAutoUploadToSupabase]);

  // 打开弹窗
  const openModal = useCallback(() => {
    logger.userAction('打开AI视频生成弹窗', 'openModal');
    setIsModalOpen(true);
  }, [logger]);

  // 关闭弹窗
  const closeModal = useCallback(() => {
    logger.userAction('关闭AI视频生成弹窗', 'closeModal', {
      wasGenerating: isGenerating,
      generationStatus,
      currentPromptId
    });
    
    setIsModalOpen(false);
    // 不清理生成状态，允许后台继续生成
  }, [logger, isGenerating, generationStatus, currentPromptId]);

  // 开始生成
  const handleGenerate = useCallback(async () => {
    if (!positivePrompt.trim()) {
      const error = '正向提示词不能为空';
      logger.error('生成参数验证失败', new Error(error));
      setGenerationError(error);
      return;
    }

    if (isGenerating) {
      logger.warn('生成任务已在进行中，忽略重复请求');
      return;
    }

    logger.userAction('开始AI视频生成', 'generateVideo', {
      positivePrompt: positivePrompt.substring(0, 100),
      dimensions: `${width}x${height}`,
      duration: durationSeconds,
      steps,
      aspectRatio,
      enableLora
    });

    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationError(null);
    setGenerationStatus('pending');

    try {
      const request: AIVideoGenerationRequest = {
        positive_prompt: positivePrompt.trim(),
        negative_prompt: negativePrompt.trim() || undefined,
        width,
        height,
        duration_seconds: durationSeconds,
        steps,
        seed: seed || undefined,
        enable_lora: enableLora,
        aspect_ratio: aspectRatio || undefined
      };

      const response = await aiVideoService.generateVideo(request);
      setCurrentPromptId(response.prompt_id);
      
      logger.info('AI视频生成请求已提交', {
        promptId: response.prompt_id,
        status: response.status,
        estimatedTime: response.estimated_time
      });
      
      // 开始轮询状态
      startPolling(response.prompt_id);
      
      // 关闭弹窗
      setIsModalOpen(false);
      logger.info('AI视频生成开始，弹窗已关闭', { promptId: response.prompt_id });
      
    } catch (error) {
      setIsGenerating(false);
      setGenerationStatus('failed');
      const errorMessage = error instanceof Error ? error.message : '生成AI视频失败';
      setGenerationError(errorMessage);
      
      logger.error('AI视频生成失败', error as Error);
    }
  }, [
    positivePrompt, negativePrompt, width, height, durationSeconds, steps, seed, enableLora, aspectRatio,
    isGenerating, aiVideoService, logger, startPolling
  ]);

  // 添加所有视频到素材库
  const handleAddToMaterials = useCallback((): boolean => {
    if (generatedVideos.length === 0) {
      logger.warn('没有生成的视频可添加到素材库');
      return false;
    }

    logger.userAction('手动添加所有AI视频到素材库', 'addAllToMaterials', {
      videosCount: generatedVideos.length,
      currentPromptId
    });

    // 如果已经自动上传，则不需要再次添加
    if (currentPromptId && downloadedPromptIds.current.has(currentPromptId)) {
      logger.info('视频已自动上传并添加到素材库，跳过手动添加');
      return true;
    }

    // 手动添加的逻辑（如果自动上传失败）
    // 这里可以实现手动上传逻辑
    logger.info('视频将通过自动上传流程添加到素材库');
    return true;
  }, [generatedVideos, currentPromptId, logger]);

  // 添加单个视频到素材库
  const handleAddSingleToMaterials = useCallback((videoInfo: VideoInfo): boolean => {
    logger.userAction('手动添加单个AI视频到素材库', 'addSingleToMaterials', {
      videoFilename: videoInfo.filename,
      currentPromptId
    });

    // 如果已经自动上传，则不需要再次添加
    if (currentPromptId && downloadedPromptIds.current.has(currentPromptId)) {
      logger.info('视频已自动上传并添加到素材库，跳过手动添加');
      return true;
    }

    // 手动添加单个视频的逻辑（如果自动上传失败）
    logger.info('单个视频将通过自动上传流程添加到素材库');
    return true;
  }, [currentPromptId, logger]);

  // 清理错误
  const clearError = useCallback(() => {
    setGenerationError(null);
    logger.debug('清理生成错误状态');
  }, [logger]);

  return {
    // Modal state
    isModalOpen,
    openModal,
    closeModal,
    
    // Generation state
    isGenerating,
    generationProgress,
    generatedVideos,
    generationError,
    generationStatus,
    currentPromptId,
    
    // Generation parameters
    positivePrompt,
    negativePrompt,
    width,
    height,
    durationSeconds,
    steps,
    seed,
    enableLora,
    aspectRatio,
    
    // Actions
    handleGenerate,
    handleAddToMaterials,
    handleAddSingleToMaterials,
    setPositivePrompt,
    setNegativePrompt,
    setWidth,
    setHeight,
    setDurationSeconds,
    setSteps,
    setSeed,
    setEnableLora,
    setAspectRatio,
    clearError,
    
    taskId
  };
};