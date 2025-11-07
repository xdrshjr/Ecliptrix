import { useState, useCallback } from 'react';
import { MaterialItem, ScriptSegment } from '@/types';
import { VideoEditingLogger } from '../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import { 
  ScriptGenerationParameters,
  VideoUnderstandingScriptProgress
} from '../types/videoEditingTypes';
import { VideoAnalysisServiceImpl } from '../services/videoAnalysisService';

export interface UseConvertToScriptReturn {
  isModalOpen: boolean;
  isGenerating: boolean;
  generationError: string | null;
  progress: VideoUnderstandingScriptProgress;
  chatContent: string;
  openModal: (content: string) => void;
  closeModal: () => void;
  generateScript: (
    chatContent: string,
    selectedVideos: MaterialItem[],
    parameters: ScriptGenerationParameters,
    enableVideoUnderstanding: boolean
  ) => void;
}

export const useConvertToScript = (
  taskId: string,
  onScriptGenerated?: (segments: ScriptSegment[]) => void
): UseConvertToScriptReturn => {
  const logger = new VideoEditingLogger({
    taskId,
    component: 'useConvertToScript'
  });
  
  const { showSuccess, showError } = useNotification();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [chatContent, setChatContent] = useState('');
  const [progress, setProgress] = useState<VideoUnderstandingScriptProgress>({
    isAnalyzing: false,
    analysisProgress: 0,
    currentStep: 'mode-selection',
    totalVideos: 0,
    analyzedVideos: 0,
    failedVideos: 0,
  });

  const openModal = useCallback((content: string) => {
    logger.userAction('打开转换视频脚本弹窗', 'openModal', {
      contentLength: content.length
    });
    setChatContent(content);
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
    logger.userAction('关闭转换视频脚本弹窗', 'closeModal', {
      wasGenerating: isGenerating
    });
    
    // 重置所有状态
    setIsModalOpen(false);
    setIsGenerating(false);
    setGenerationError(null);
    setChatContent('');
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
    selectedVideos: MaterialItem[]
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

    logger.info('开始并行视频分析（快速模式）', {
      videoCount: videoMaterials.length,
      frameInterval: 9999 // 快速模式只提取一帧
    });

    const maxConcurrentThreads = 5;
    const analysisResults: Array<{ material: MaterialItem; result?: any; error?: string }> = [];
    
    const frameInterval = 9999; // 快速模式：只提取一帧

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
      failed: failedAnalyses
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
    chatContent: string,
    selectedVideos: MaterialItem[],
    parameters: ScriptGenerationParameters,
    enableVideoUnderstanding: boolean
  ) => {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      logger.info('开始转换视频脚本', {
        chatContentLength: chatContent.length,
        videoCount: selectedVideos.length,
        enableVideoUnderstanding,
        parameters
      });

      // 关闭配置弹窗，显示进度弹窗
      setIsModalOpen(false);

      let videosWithAnalysis = selectedVideos;

      // 如果启用了视频理解，先分析视频
      if (enableVideoUnderstanding && selectedVideos.length > 0) {
        videosWithAnalysis = await analyzeVideosInParallel(selectedVideos);
      }

      // 生成脚本
      setProgress(prev => ({
        ...prev,
        currentStep: 'script-generation',
        analysisProgress: 90
      }));

      logger.info('开始脚本生成阶段', {
        videosWithAnalysisCount: videosWithAnalysis.length,
        videosWithActualAnalysis: videosWithAnalysis.filter(v => v.metadata?.video_analysis).length
      });

      // 调用API生成脚本
      const response = await fetch('/api/convert-to-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chatContent,
          selectedVideos: videosWithAnalysis,
          parameters,
          enableVideoUnderstanding,
          taskId
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || '脚本生成失败');
      }

      setProgress(prev => ({
        ...prev,
        analysisProgress: 100
      }));

      logger.info('转换视频脚本成功', {
        generatedSegmentCount: result.segments.length,
        totalDuration: result.segments.reduce((acc: number, seg: ScriptSegment) => acc + (seg.duration || 0), 0),
        metadata: result.metadata
      });

      showSuccess('脚本生成成功！');
      
      // Call the callback with generated segments
      onScriptGenerated?.(result.segments);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      logger.error('转换视频脚本失败', {
        error: errorMessage,
        chatContentLength: chatContent.length,
        videoCount: selectedVideos.length,
        enableVideoUnderstanding,
        parameters
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
    chatContent,
    openModal,
    closeModal,
    generateScript
  };
};

