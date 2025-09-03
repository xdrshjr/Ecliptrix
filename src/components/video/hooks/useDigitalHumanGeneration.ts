import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { MaterialItem, MaterialType } from '@/types';
import { UseDigitalHumanGenerationReturn, DigitalHumanGenerationRequest, VideoInfo } from '../types';
import { VideoEditingLogger } from '../utils';
import { createDigitalHumanGenerationService, DigitalHumanGenerationService } from '../services/digitalHumanGenerationService';

export const useDigitalHumanGeneration = (
  taskId: string,
  onAddMaterials: (materials: MaterialItem[]) => boolean
): UseDigitalHumanGenerationReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useDigitalHumanGeneration'
  }), [taskId]);

  const digitalHumanService = useMemo(() => createDigitalHumanGenerationService(taskId), [taskId]);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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

  // 上传状态
  const [isUploadingVideo, setIsUploadingVideo] = useState(false);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [audioUploadProgress, setAudioUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadedVideoFilename, setUploadedVideoFilename] = useState<string | null>(null);
  const [uploadedAudioFilename, setUploadedAudioFilename] = useState<string | null>(null);

  // 生成参数
  const [positivePrompt, setPositivePrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards');
  const [width, setWidth] = useState(832);
  const [height, setHeight] = useState(480);
  const [steps, setSteps] = useState(4);
  const [seed, setSeed] = useState<number | null>(null);
  const [cfg, setCfg] = useState(1.0);
  const [shift, setShift] = useState(8.0);
  const [referenceVideoFile, setReferenceVideoFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);

  // 清理轮询
  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // 开始轮询状态
  const startPolling = useCallback((promptId: string) => {
    clearPolling();
    
    logger.info('开始轮询数字人生成状态', { promptId });
    
    // 添加生成中的素材到素材库
    const generatingMaterial: MaterialItem = {
      id: `digital-human-generating-${promptId}`,
      name: '数字人视频生成中...',
      type: 'video' as MaterialType,
      format: 'mp4',
      size: 0,
      url: '', // 占位URL
      downloadStatus: 'generating' as const,
      downloadProgress: 0,
      createdAt: new Date(),
      metadata: {
        promptId,
        isDigitalHumanGeneration: true
      }
    };
    
    const addResult = onAddMaterials([generatingMaterial]);
    if (addResult) {
      logger.info('已添加生成中的数字人素材到素材库', { 
        materialId: generatingMaterial.id,
        promptId 
      });
    }
    
    const poll = async () => {
      try {
        const status = await digitalHumanService.getGenerationStatus(promptId);
        
        setGenerationStatus(status.status);
        setGenerationProgress(status.progress || 0);
        
        // 更新素材库中的进度
        const updatedMaterial: MaterialItem = {
          ...generatingMaterial,
          downloadProgress: Math.round((status.progress || 0) * 100)
        };
        onAddMaterials([updatedMaterial]);
        
        if (status.status === 'completed') {
          setGeneratedVideos(status.videos);
          setIsGenerating(false);
          clearPolling();
          
          // 更新素材库 - 移除生成中的素材，添加完成的素材
          const completedMaterials: MaterialItem[] = status.videos.map((video, index) => ({
            id: `digital-human-${promptId}-${index}`,
            name: `数字人视频_${index + 1}`,
            type: 'video' as MaterialType,
            format: 'mp4',
            size: video.size_bytes || 0,
            duration: video.duration,
            url: video.url || '',
            downloadStatus: 'completed' as const,
            createdAt: new Date(),
            metadata: {
              promptId,
              isDigitalHumanGeneration: true,
              originalFilename: video.filename
            }
          }));
          
          onAddMaterials(completedMaterials);
          
          logger.info('数字人生成完成，已更新素材库', {
            promptId,
            videosCount: status.videos.length,
            completedMaterialsCount: completedMaterials.length
          });
        } else if (status.status === 'failed') {
          setGenerationError(status.error_message || '数字人生成失败');
          setIsGenerating(false);
          clearPolling();
          
          // 更新素材库中的错误状态
          const errorMaterial: MaterialItem = {
            ...generatingMaterial,
            name: '数字人视频生成失败',
            downloadStatus: 'error' as const,
            downloadError: status.error_message || '生成失败'
          };
          onAddMaterials([errorMaterial]);
          
          logger.error('数字人生成失败', new Error(status.error_message || '未知错误'), {
            promptId
          });
        }
      } catch (error) {
        logger.error('轮询数字人状态时出错', error as Error, { promptId });
        // 继续轮询，不中断
      }
    };
    
    // 立即执行一次
    poll();
    
    // 设置定时轮询
    pollIntervalRef.current = setInterval(poll, 5000);
    
    // 设置20分钟超时
    pollTimeoutRef.current = setTimeout(() => {
      logger.warn('数字人生成超时（20分钟），停止轮询', { promptId });
      setGenerationError('生成超时，请稍后重试');
      setIsGenerating(false);
      clearPolling();
      
      // 更新素材库中的超时状态
      const timeoutMaterial: MaterialItem = {
        ...generatingMaterial,
        name: '数字人视频生成超时',
        downloadStatus: 'error' as const,
        downloadError: '生成超时（20分钟）'
      };
      onAddMaterials([timeoutMaterial]);
    }, 20 * 60 * 1000); // 20分钟 = 1200000ms
    
  }, [digitalHumanService, logger, clearPolling, onAddMaterials]);

  // 打开弹窗
  const openModal = useCallback(() => {
    setIsModalOpen(true);
    logger.userAction('打开数字人生成弹窗', 'openModal');
  }, [logger]);

  // 关闭弹窗
  const closeModal = useCallback(() => {
    if (isGenerating) {
      logger.warn('数字人生成进行中，不允许关闭弹窗', {
        generationStatus,
        currentPromptId
      });
      return;
    }

    setIsModalOpen(false);
    
    // 重置状态
    if (generatedVideos.length === 0) {
      setGenerationStatus('idle');
      setGenerationProgress(0);
      setGenerationError(null);
      setCurrentPromptId(null);
    }
    
    clearPolling();
    
    logger.info('数字人生成弹窗已关闭，状态已重置');
  }, [logger, isGenerating, generatedVideos.length, clearPolling, generationStatus, currentPromptId]);

  // 开始生成
  const handleGenerate = useCallback(async () => {
    if (!positivePrompt.trim()) {
      setGenerationError('请输入正向提示词');
      logger.warn('生成失败：正向提示词为空');
      return;
    }

    if (!uploadedVideoFilename) {
      setGenerationError('请上传参考视频');
      logger.warn('生成失败：未上传参考视频');
      return;
    }

    if (!uploadedAudioFilename) {
      setGenerationError('请上传音频文件');
      logger.warn('生成失败：未上传音频文件');
      return;
    }

    if (isGenerating) {
      logger.warn('生成进行中，忽略重复请求', {
        currentStatus: generationStatus,
        currentPromptId
      });
      return;
    }

    logger.userAction('开始数字人生成', 'generate', {
      positivePrompt: positivePrompt.substring(0, 100),
      negativePrompt: negativePrompt.substring(0, 50),
      dimensions: `${width}x${height}`,
      steps,
      cfg,
      shift,
      videoFilename: uploadedVideoFilename,
      audioFilename: uploadedAudioFilename,
      currentVideosCount: generatedVideos.length,
      downloadedPromptsCount: downloadedPromptIds.current.size
    });

    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationError(null);
    setGenerationStatus('pending');

    try {
      const request: DigitalHumanGenerationRequest = {
        positive_prompt: positivePrompt.trim(),
        negative_prompt: negativePrompt.trim() || undefined,
        width,
        height,
        steps,
        seed: seed || undefined,
        cfg,
        shift,
        reference_video_filename: uploadedVideoFilename,
        audio_filename: uploadedAudioFilename
      };

      const response = await digitalHumanService.generateVideo(request);
      setCurrentPromptId(response.prompt_id);
      
      logger.info('数字人生成请求已提交', {
        promptId: response.prompt_id,
        status: response.status,
        estimatedTime: response.estimated_time
      });
      
      // 开始轮询状态
      startPolling(response.prompt_id);
      
      // 关闭弹窗
      setIsModalOpen(false);
      logger.info('数字人生成开始，弹窗已关闭', { promptId: response.prompt_id });
      
    } catch (error) {
      setIsGenerating(false);
      setGenerationStatus('failed');
      const errorMessage = error instanceof Error ? error.message : '生成数字人视频失败';
      setGenerationError(errorMessage);
      
      logger.error('数字人生成失败', error as Error);
    }
  }, [
    positivePrompt, negativePrompt, width, height, steps, seed, cfg, shift,
    referenceVideoFile, audioFile, isGenerating, generationStatus, currentPromptId,
    generatedVideos.length, logger, digitalHumanService, startPolling
  ]);

  // 添加所有视频到素材库
  const handleAddToMaterials = useCallback(() => {
    if (generatedVideos.length === 0) {
      logger.warn('没有可添加的数字人视频');
      return false;
    }

    const materials: MaterialItem[] = generatedVideos.map((video, index) => ({
      id: `digital_human_${currentPromptId}_${index}`,
      name: `数字人视频_${index + 1}`,
      type: 'video' as const,
      url: video.url || digitalHumanService.downloadVideo(video.filename),
      duration: video.duration || 0,
      size: video.size_bytes || 0,
      format: 'mp4',
      createdAt: new Date(),
      metadata: {
        source: 'digital_human_generation',
        promptId: currentPromptId,
        filename: video.filename,
        generatedAt: new Date().toISOString()
      }
    }));

    const success = onAddMaterials(materials);
    
    if (success) {
      if (currentPromptId) {
        downloadedPromptIds.current.add(currentPromptId);
      }
      
      logger.userAction('添加数字人视频到素材库', 'addToMaterials', {
        promptId: currentPromptId,
        videosCount: materials.length,
        totalDownloadedPrompts: downloadedPromptIds.current.size
      });
    }
    
    return success;
  }, [generatedVideos, currentPromptId, onAddMaterials, logger, digitalHumanService]);

  // 添加单个视频到素材库
  const handleAddSingleToMaterials = useCallback((videoInfo: VideoInfo) => {
    const material: MaterialItem = {
      id: `digital_human_${currentPromptId}_${Date.now()}`,
      name: `数字人视频_${videoInfo.filename}`,
      type: 'video' as const,
      url: videoInfo.url || digitalHumanService.downloadVideo(videoInfo.filename),
      duration: videoInfo.duration || 0,
      size: videoInfo.size_bytes || 0,
      format: 'mp4',
      createdAt: new Date(),
      metadata: {
        source: 'digital_human_generation',
        promptId: currentPromptId,
        filename: videoInfo.filename,
        generatedAt: new Date().toISOString()
      }
    };

    const success = onAddMaterials([material]);
    
    if (success) {
      logger.userAction('添加单个数字人视频到素材库', 'addSingleToMaterials', {
        promptId: currentPromptId,
        filename: videoInfo.filename
      });
    }
    
    return success;
  }, [currentPromptId, onAddMaterials, logger, digitalHumanService]);

  // 上传视频文件
  const handleVideoFileUpload = useCallback(async (file: File) => {
    setIsUploadingVideo(true);
    setVideoUploadProgress(0);
    setUploadError(null);
    
    try {
      logger.info('开始上传视频文件', { fileName: file.name, fileSize: file.size });
      
      const filename = await digitalHumanService.uploadSingleFile(
        file, 
        'video', 
        (progress) => setVideoUploadProgress(progress)
      );
      
      setUploadedVideoFilename(filename);
      logger.info('视频文件上传完成', { filename });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '视频上传失败';
      setUploadError(errorMessage);
      logger.error('视频文件上传失败', error as Error);
    } finally {
      setIsUploadingVideo(false);
    }
  }, [digitalHumanService, logger]);

  // 上传音频文件
  const handleAudioFileUpload = useCallback(async (file: File) => {
    setIsUploadingAudio(true);
    setAudioUploadProgress(0);
    setUploadError(null);
    
    try {
      logger.info('开始上传音频文件', { fileName: file.name, fileSize: file.size });
      
      const filename = await digitalHumanService.uploadSingleFile(
        file, 
        'audio', 
        (progress) => setAudioUploadProgress(progress)
      );
      
      setUploadedAudioFilename(filename);
      logger.info('音频文件上传完成', { filename });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '音频上传失败';
      setUploadError(errorMessage);
      logger.error('音频文件上传失败', error as Error);
    } finally {
      setIsUploadingAudio(false);
    }
  }, [digitalHumanService, logger]);

  // 设置视频文件并立即上传
  const handleSetReferenceVideoFile = useCallback((file: File | null) => {
    setReferenceVideoFile(file);
    if (file) {
      // 重置之前的上传状态
      setUploadedVideoFilename(null);
      setVideoUploadProgress(0);
      // 立即开始上传
      handleVideoFileUpload(file);
    } else {
      setUploadedVideoFilename(null);
      setVideoUploadProgress(0);
    }
  }, [handleVideoFileUpload]);

  // 设置音频文件并立即上传
  const handleSetAudioFile = useCallback((file: File | null) => {
    setAudioFile(file);
    if (file) {
      // 重置之前的上传状态
      setUploadedAudioFilename(null);
      setAudioUploadProgress(0);
      // 立即开始上传
      handleAudioFileUpload(file);
    } else {
      setUploadedAudioFilename(null);
      setAudioUploadProgress(0);
    }
  }, [handleAudioFileUpload]);

  // 清除错误
  const clearError = useCallback(() => {
    setGenerationError(null);
    logger.info('已清除数字人生成错误信息');
  }, [logger]);

  // 清除上传错误
  const clearUploadError = useCallback(() => {
    setUploadError(null);
    logger.info('已清除文件上传错误信息');
  }, [logger]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      clearPolling();
    };
  }, [clearPolling]);

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
    
    // Upload state
    isUploadingVideo,
    isUploadingAudio,
    videoUploadProgress,
    audioUploadProgress,
    uploadError,
    uploadedVideoFilename,
    uploadedAudioFilename,
    
    // Generation parameters
    positivePrompt,
    negativePrompt,
    width,
    height,
    steps,
    seed,
    cfg,
    shift,
    referenceVideoFile,
    audioFile,
    
    // Actions
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
    setShift,
    setReferenceVideoFile: handleSetReferenceVideoFile,
    setAudioFile: handleSetAudioFile,
    clearError,
    clearUploadError,
    
    taskId
  };
}; 