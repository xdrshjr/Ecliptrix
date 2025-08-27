import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { MaterialItem } from '@/types';
import { UseAIImageGenerationReturn, AIImageGenerationRequest, ImageInfo } from '../types';
import { VideoEditingLogger } from '../utils';
import { createAIImageGenerationService, AIImageGenerationService } from '../services/aiImageGenerationService';

export const useAIImageGeneration = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseAIImageGenerationReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useAIImageGeneration'
  }), [taskId]);

  const aiImageService = useMemo(() => createAIImageGenerationService(taskId), [taskId]);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // 弹窗状态
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationStatus, setGenerationStatus] = useState<'idle' | 'pending' | 'running' | 'completed' | 'failed'>('idle');
  const [currentPromptId, setCurrentPromptId] = useState<string | null>(null);

  // 生图参数
  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('low quality, blurry, distorted');
  const [width, setWidth] = useState(1024);
  const [height, setHeight] = useState(1024);
  const [steps, setSteps] = useState(20);
  const [seed, setSeed] = useState<number | null>(null);
  const [cfg, setCfg] = useState(1.0);
  const [guidance, setGuidance] = useState(3.5);
  const [checkpoint, setCheckpoint] = useState('flux1-dev-fp8.safetensors');

  // 清理轮询
  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // 状态轮询
  const startPolling = useCallback((promptId: string) => {
    clearPolling();
    
    const poll = async () => {
      try {
        const status = await aiImageService.getGenerationStatus(promptId);
        
        setGenerationStatus(status.status);
        setGenerationProgress(status.progress || 0);
        
        if (status.status === 'completed') {
          clearPolling();
          setIsGenerating(false);
          
          if (status.images && status.images.length > 0) {
            // 使用prompt_id下载图片（ComfyUI API服务按prompt_id提供下载）
            try {
              const url = await aiImageService.downloadImageByPromptId(promptId);
              // 修复：将新图片添加到最前面，而不是替换整个数组
              setGeneratedImages(prev => [url, ...prev]);
              
              logger.info('AI图片下载完成', {
                promptId,
                imagesCount: 1,
                totalGenerated: status.images.length
              });
            } catch (error) {
              logger.error('下载生成图片失败', error as Error, { promptId });
            }
          }
        } else if (status.status === 'failed') {
          clearPolling();
          setIsGenerating(false);
          setGenerationError(status.error_message || 'AI图片生成失败');
          
          logger.error('AI图片生成失败', new Error(status.error_message || 'Unknown error'), {
            promptId
          });
        }
      } catch (error) {
        logger.error('轮询生成状态异常', error as Error, { promptId });
        // 继续轮询，除非是网络错误
      }
    };

    // 立即执行一次
    poll();
    
    // 每3秒轮询一次
    pollIntervalRef.current = setInterval(poll, 3000);
  }, [aiImageService, logger, clearPolling]);

  // 打开弹窗
  const openModal = useCallback(() => {
    logger.userAction('打开AI生图弹窗', 'openModal');
    setIsModalOpen(true);
  }, [logger]);

  // 关闭弹窗
  const closeModal = useCallback(() => {
    logger.userAction('关闭AI生图弹窗', 'closeModal', {
      wasGenerating: isGenerating,
      generatedImagesCount: generatedImages.length
    });
    
    setIsModalOpen(false);
    clearPolling();
    
    // 重置状态
    setIsGenerating(false);
    setGenerationProgress(0);
    setGeneratedImages([]);
    setGenerationError(null);
    setGenerationStatus('idle');
    setCurrentPromptId(null);
    
    // 清空参数
    setPositivePrompt('');
    setNegativePrompt('low quality, blurry, distorted');
    setWidth(1024);
    setHeight(1024);
    setSteps(20);
    setSeed(null);
    setCfg(1.0);
    setGuidance(3.5);
    setCheckpoint('flux1-dev-fp8.safetensors');
  }, [logger, isGenerating, generatedImages.length, clearPolling]);

  // 开始生成
  const handleGenerate = useCallback(async () => {
    if (!positivePrompt.trim()) {
      setGenerationError('请输入正向提示词');
      return;
    }

    if (isGenerating) {
      logger.warn('生成进行中，忽略重复请求');
      return;
    }

    logger.userAction('开始AI图片生成', 'generate', {
      positivePrompt: positivePrompt.substring(0, 100),
      negativePrompt: negativePrompt.substring(0, 50),
      dimensions: `${width}x${height}`,
      steps,
      cfg,
      guidance,
      checkpoint
    });

    setIsGenerating(true);
    setGenerationProgress(0);
    // 修复：不再清空已生成的图片
    setGenerationError(null);
    setGenerationStatus('pending');

    try {
      const request: AIImageGenerationRequest = {
        positive_prompt: positivePrompt.trim(),
        negative_prompt: negativePrompt.trim() || undefined,
        width,
        height,
        steps,
        seed: seed || undefined,
        cfg,
        guidance,
        checkpoint
      };

      const response = await aiImageService.generateImage(request);
      setCurrentPromptId(response.prompt_id);
      
      // 开始轮询状态
      startPolling(response.prompt_id);
      
    } catch (error) {
      setIsGenerating(false);
      setGenerationStatus('failed');
      const errorMessage = error instanceof Error ? error.message : '生成图片失败';
      setGenerationError(errorMessage);
      
      logger.error('AI图片生成失败', error as Error);
    }
  }, [
    positivePrompt, negativePrompt, width, height, steps, seed, cfg, guidance, checkpoint,
    isGenerating, aiImageService, startPolling, logger
  ]);

  // 添加到素材库（批量）
  const handleAddToMaterials = useCallback(async (imageUrls: string[]) => {
    if (imageUrls.length === 0) {
      logger.warn('没有图片可添加到素材库');
      return;
    }

    logger.userAction('添加AI生成图片到素材库', 'addToMaterials', {
      imagesCount: imageUrls.length
    });

    try {
      const materials: MaterialItem[] = [];
      
      for (let i = 0; i < imageUrls.length; i++) {
        const imageUrl = imageUrls[i];
        const material: MaterialItem = {
          id: `ai-image-${Date.now()}-${i}`,
          name: `AI生成图片_${new Date().toISOString().split('T')[0]}_${i + 1}`,
          type: 'image',
          format: 'png', // AI生成的图片通常是PNG格式
          url: imageUrl,
          size: 0, // 不知道确切大小
          duration: 0,
          width,
          height,
          thumbnailUrl: imageUrl,
          createdAt: new Date(),
          metadata: {
            source: 'ai-generated',
            generatedAt: new Date().toISOString(),
            prompt: positivePrompt.substring(0, 200),
            parameters: {
              width,
              height,
              steps,
              cfg,
              guidance,
              checkpoint
            }
          }
        };
        materials.push(material);
      }

      const success = onAddMaterials(materials);
      
      if (success) {
        logger.info('AI生成图片成功添加到素材库', {
          addedCount: materials.length,
          totalImages: imageUrls.length
        });
      } else {
        logger.error('添加AI生成图片到素材库失败', new Error('onAddMaterials returned false'));
        setGenerationError('添加图片到素材库失败');
      }
    } catch (error) {
      logger.error('添加AI生成图片异常', error as Error);
      setGenerationError('添加图片到素材库时发生错误');
    }
  }, [onAddMaterials, positivePrompt, width, height, steps, cfg, guidance, checkpoint, logger]);

  // 添加单张图片到素材库
  const handleAddSingleToMaterials = useCallback(async (imageUrl: string) => {
    logger.userAction('添加单张AI生成图片到素材库', 'addSingleToMaterials', {
      imageUrl: imageUrl.substring(0, 100)
    });

    try {
      const material: MaterialItem = {
        id: `ai-image-${Date.now()}`,
        name: `AI生成图片_${new Date().toISOString().split('T')[0]}`,
        type: 'image',
        format: 'png',
        url: imageUrl,
        size: 0,
        duration: 0,
        width,
        height,
        thumbnailUrl: imageUrl,
        createdAt: new Date(),
        metadata: {
          source: 'ai-generated',
          generatedAt: new Date().toISOString(),
          prompt: positivePrompt.substring(0, 200),
          parameters: {
            width,
            height,
            steps,
            cfg,
            guidance,
            checkpoint
          }
        }
      };

      const success = onAddMaterials([material]);
      
      if (success) {
        logger.info('单张AI生成图片成功添加到素材库', {
          imageUrl: imageUrl.substring(0, 100)
        });
        return true;
      } else {
        logger.error('添加单张AI生成图片到素材库失败', new Error('onAddMaterials returned false'));
        return false;
      }
    } catch (error) {
      logger.error('添加单张AI生成图片异常', error as Error);
      return false;
    }
  }, [onAddMaterials, positivePrompt, width, height, steps, cfg, guidance, checkpoint, logger]);

  // 清除错误
  const clearError = useCallback(() => {
    setGenerationError(null);
  }, []);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

  return {
    isModalOpen,
    isGenerating,
    generationProgress,
    generatedImages,
    generationError,
    generationStatus,
    
    // 参数
    positivePrompt,
    negativePrompt,
    width,
    height,
    steps,
    seed,
    cfg,
    guidance,
    checkpoint,
    
    // 方法
    openModal,
    closeModal,
    handleGenerate,
    handleAddToMaterials,
    handleAddSingleToMaterials,
    setPositivePrompt,
    setNegativePrompt,
    setWidth,
    setHeight,
    setSteps,
    setSeed,
    setCfg,
    setGuidance,
    setCheckpoint,
    clearError,
    
    taskId
  };
}; 