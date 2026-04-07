import { useState, useCallback } from 'react';
import { MaterialItem, ScriptSegment, ChatMessage } from '@/types';
import { VideoEditingLogger } from '../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import {
  VideoUnderstandingScriptMode,
  ScriptGenerationParameters,
  UseVideoUnderstandingScriptReturn,
  VideoUnderstandingScriptProgress
} from '../types/videoEditingTypes';
import { VideoAnalysisServiceImpl, VideoAnalysisResponse } from '../services/videoAnalysisService';

export const useVideoUnderstandingScript = (
  taskId: string,
  onScriptGenerated?: (segments: ScriptSegment[]) => void,
  getVideoAnalysisResult?: (videoUrl: string) => VideoAnalysisResponse | null
): UseVideoUnderstandingScriptReturn => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'useVideoUnderstandingScript'
  });
  
  const { showSuccess, showError } = useNotification();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [progress, setProgress] = useState<VideoUnderstandingScriptProgress>({
    isAnalyzing: false,
    analysisProgress: 0,
    currentStep: 'mode-selection',
    totalVideos: 0,
    analyzedVideos: 0,
    failedVideos: 0,
  });

  const openModal = useCallback(() => {
    logger.userAction('打开视频理解生成脚本弹窗', 'openModal');
    setIsModalOpen(true);
    setGenerationError(null);
    setProgress({
      isAnalyzing: false,
      analysisProgress: 0,
      currentStep: 'mode-selection',
      totalVideos: 0,
      analyzedVideos: 0,
      failedVideos: 0,
    });
  }, [logger]);

  const closeModal = useCallback(() => {
    logger.userAction('关闭视频理解生成脚本弹窗', 'closeModal', {
      wasGenerating: isGenerating
    });
    
    // 重置所有状态
    setIsModalOpen(false);
    setIsGenerating(false);
    setGenerationError(null);
    setProgress({
      isAnalyzing: false,
      analysisProgress: 0,
      currentStep: 'mode-selection',
      totalVideos: 0,
      analyzedVideos: 0,
      failedVideos: 0,
    });
  }, [isGenerating, logger]);

  // 并行分析视频的函数
  const analyzeVideosInParallel = useCallback(async (
    selectedVideos: MaterialItem[],
    mode: VideoUnderstandingScriptMode
  ): Promise<MaterialItem[]> => {
    const videoMaterials = selectedVideos.filter(material => material.type === 'video' && material.url);
    
    if (videoMaterials.length === 0) {
      return selectedVideos;
    }

    setProgress(prev => ({
      ...prev,
      currentStep: 'video-analysis',
      isAnalyzing: true,
      totalVideos: videoMaterials.length,
      analyzedVideos: 0,
      failedVideos: 0,
    }));

    logger.info('开始并行视频分析', {
      videoCount: videoMaterials.length,
      mode: mode.type,
      frameInterval: mode.frameInterval
    });

    const maxConcurrentThreads = 5;
    const analysisResults: Array<{ material: MaterialItem; result?: any; error?: string }> = [];
    
    // 确定帧间隔
    const frameInterval = mode.type === 'quick' ? 9999 : (mode.frameInterval || 5);

    // 创建视频分析服务实例
    const videoAnalysisService = new VideoAnalysisServiceImpl(taskId);

    // 分批处理函数
    const processBatch = async (batch: MaterialItem[]) => {
      const batchPromises = batch.map(async (material) => {
        try {
          setProgress(prev => ({
            ...prev,
            currentVideoName: material.name
          }));

          logger.info(`开始分析视频: ${material.name}`, {
            videoId: material.id,
            videoUrl: material.url,
            frameInterval
          });

          const result = await videoAnalysisService.analyzeVideo({
            videoUrl: material.url!,
            frameInterval,
            taskId
          });

          logger.info(`视频分析完成: ${material.name}`, {
            videoId: material.id,
            framesExtracted: result.total_frames_extracted,
            processingTime: result.processing_time
          });

          setProgress(prev => ({
            ...prev,
            analyzedVideos: prev.analyzedVideos + 1,
            analysisProgress: ((prev.analyzedVideos + 1) / prev.totalVideos) * 100
          }));

          return { material, result };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          logger.error(`视频分析失败: ${material.name}`, {
            videoId: material.id,
            error: errorMessage,
            frameInterval
          });

          setProgress(prev => ({
            ...prev,
            failedVideos: prev.failedVideos + 1,
            analyzedVideos: prev.analyzedVideos + 1,
            analysisProgress: ((prev.analyzedVideos + 1) / prev.totalVideos) * 100
          }));

          return { material, error: errorMessage };
        }
      });

      return Promise.all(batchPromises);
    };

    // 分批执行分析
    for (let i = 0; i < videoMaterials.length; i += maxConcurrentThreads) {
      const batch = videoMaterials.slice(i, i + maxConcurrentThreads);
      const batchResults = await processBatch(batch);
      analysisResults.push(...batchResults);
    }

    // 构建包含分析结果的视频列表
    const videosWithAnalysis = selectedVideos.map(video => {
      if (video.type !== 'video' || !video.url) {
        return video;
      }

      const analysisResult = analysisResults.find(r => r.material.id === video.id);
      if (analysisResult?.result) {
        return {
          ...video,
          metadata: {
            ...video.metadata,
            video_analysis: {
              success: analysisResult.result.success,
              video_url: analysisResult.result.video_url,
              total_frames_extracted: analysisResult.result.total_frames_extracted,
              video_duration: analysisResult.result.video_duration,
              frame_analyses: analysisResult.result.frame_analyses,
              processing_time: analysisResult.result.processing_time,
              analysis_timestamp: new Date().toISOString()
            }
          }
        };
      }

      return video;
    });

    const successfulAnalyses = analysisResults.filter(r => r.result).length;
    const failedAnalyses = analysisResults.filter(r => r.error).length;

    logger.info('视频分析阶段完成', {
      totalVideos: videoMaterials.length,
      successful: successfulAnalyses,
      failed: failedAnalyses,
      mode: mode.type
    });

    if (failedAnalyses > 0) {
      setProgress(prev => ({
        ...prev,
        errorMessage: `${failedAnalyses} 个视频分析失败，但将继续生成脚本`
      }));
    }

    return videosWithAnalysis;
  }, [taskId, logger]);

  const generateScript = useCallback(async (
    selectedVideos: MaterialItem[],
    referenceText: string,
    parameters: ScriptGenerationParameters,
    mode: VideoUnderstandingScriptMode,
    chatMessages?: ChatMessage[],
    customPrompt?: string,
  ) => {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      logger.info('开始视频理解生成脚本', {
        videoCount: selectedVideos.length,
        videoIds: selectedVideos.map(v => v.id),
        referenceTextLength: referenceText.length,
        parameters,
        mode
      });

      // 关闭原本的配置弹窗，显示进度弹窗
      setIsModalOpen(false);

      // 第一步：并行分析视频
      const videosWithAnalysis = await analyzeVideosInParallel(selectedVideos, mode);

      // 第二步：生成脚本
      setProgress(prev => ({
        ...prev,
        currentStep: 'script-generation',
        analysisProgress: 90
      }));

      logger.info('开始脚本生成阶段', {
        videosWithAnalysisCount: videosWithAnalysis.length,
        videosWithActualAnalysis: videosWithAnalysis.filter(v => v.metadata?.video_analysis).length
      });

      // 调用真实API
      // The `referenceText` enrichment (merging chat messages + custom
      // prompt) was previously done in
      // `src/app/api/video-understanding-script/route.ts`. T04 reduced that
      // route to a dumb passthrough, so the enrichment now happens here at
      // the call site — the backend's `referenceText` field receives the
      // merged content directly.
      const [{ truncateChatMessages, serializeChatMessages }, { http }] = await Promise.all([
        import('@/lib/utils/chatMessageUtils'),
        import('@/lib/api/http-client'),
      ]);

      const enrichedParts: string[] = [];
      if (referenceText && referenceText.trim()) {
        enrichedParts.push(referenceText.trim());
      }
      if (chatMessages && chatMessages.length > 0) {
        const truncated = truncateChatMessages(chatMessages);
        const serialized = serializeChatMessages(truncated);
        if (serialized) {
          enrichedParts.push(`【对话参考】\n${serialized}`);
        }
      }
      if (customPrompt && customPrompt.trim()) {
        enrichedParts.push(`【用户需求】\n${customPrompt.trim()}`);
      }
      const enrichedReferenceText = enrichedParts.join('\n\n');

      const result = await http.post<{
        success: boolean;
        error?: string;
        segments: ScriptSegment[];
        metadata?: unknown;
      }>(
        '/api/video-understanding-script',
        {
          taskId,
          selectedVideos: videosWithAnalysis,
          referenceText: enrichedReferenceText,
          parameters,
        },
        { timeoutMs: 300_000 },
      );

      if (!result.success) {
        throw new Error(result.error || '脚本生成失败');
      }

      setProgress(prev => ({
        ...prev,
        analysisProgress: 100
      }));

      logger.info('视频理解生成脚本成功', {
        generatedSegmentCount: result.segments.length,
        totalDuration: result.segments.reduce((acc: number, seg: ScriptSegment) => acc + (seg.duration || 0), 0),
        metadata: result.metadata
      });

      showSuccess('脚本生成成功！');
      
      // Call the callback with generated segments
      onScriptGenerated?.(result.segments);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      logger.error('视频理解生成脚本失败', {
        error: errorMessage,
        videoCount: selectedVideos.length,
        parameters,
        mode
      });

      setGenerationError(errorMessage);
      setProgress(prev => ({
        ...prev,
        errorMessage: errorMessage
      }));
      showError(`脚本生成失败: ${errorMessage}`);
    } finally {
      setIsGenerating(false);
      setProgress(prev => ({
        ...prev,
        isAnalyzing: false
      }));
    }
  }, [logger, showSuccess, showError, onScriptGenerated, analyzeVideosInParallel]);

  return {
    isModalOpen,
    isGenerating,
    generationError,
    progress,
    openModal,
    closeModal,
    generateScript
  };
}; 