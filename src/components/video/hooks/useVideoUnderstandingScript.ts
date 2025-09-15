import { useState, useCallback } from 'react';
import { MaterialItem, ScriptSegment } from '@/types';
import { VideoEditingLogger } from '../utils/logger';
import { useNotification } from '@/contexts/NotificationContext';
import { VideoAnalysisResponse } from '../services/videoAnalysisService';

interface ScriptGenerationParameters {
  language: 'chinese' | 'english' | 'mixed';
  segmentCount: number;
  analysisDepth: 'basic' | 'detailed' | 'comprehensive';
  includeVisualElements: boolean;
  includeAudioAnalysis: boolean;
}

export interface UseVideoUnderstandingScriptReturn {
  isModalOpen: boolean;
  isGenerating: boolean;
  generationError: string | null;
  openModal: () => void;
  closeModal: () => void;
  generateScript: (
    selectedVideos: MaterialItem[], 
    referenceText: string, 
    parameters: ScriptGenerationParameters
  ) => Promise<void>;
}

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

  const openModal = useCallback(() => {
    logger.userAction('打开视频理解生成脚本弹窗', 'openModal');
    setIsModalOpen(true);
    setGenerationError(null);
  }, [logger]);

  const closeModal = useCallback(() => {
    if (!isGenerating) {
      logger.userAction('关闭视频理解生成脚本弹窗', 'closeModal');
      setIsModalOpen(false);
      setGenerationError(null);
    }
  }, [isGenerating, logger]);

  const generateScript = useCallback(async (
    selectedVideos: MaterialItem[],
    referenceText: string,
    parameters: ScriptGenerationParameters
  ) => {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      logger.info('开始视频理解生成脚本', {
        videoCount: selectedVideos.length,
        videoIds: selectedVideos.map(v => v.id),
        referenceTextLength: referenceText.length,
        parameters
      });

      // 收集视频分析结果
      const videosWithAnalysis = selectedVideos.map(video => {
        let analysisData = null;
        
        if (getVideoAnalysisResult && video.url) {
          const analysisResult = getVideoAnalysisResult(video.url);
          if (analysisResult && analysisResult.success) {
            analysisData = {
              success: analysisResult.success,
              video_url: analysisResult.video_url,
              total_frames_extracted: analysisResult.total_frames_extracted,
              video_duration: analysisResult.video_duration,
              frame_analyses: analysisResult.frame_analyses,
              processing_time: analysisResult.processing_time,
              timestamp: analysisResult.timestamp,
              message: analysisResult.message
            };
            
            logger.info(`找到视频分析结果: ${video.id}`, {
              videoId: video.id,
              videoName: video.name,
              totalFrames: analysisResult.total_frames_extracted,
              videoDuration: analysisResult.video_duration
            });
          } else {
            logger.info(`未找到视频分析结果: ${video.id}`, {
              videoId: video.id,
              videoName: video.name,
              hasGetVideoAnalysisResult: !!getVideoAnalysisResult,
              hasVideoUrl: !!video.url
            });
          }
        }
        
        return {
          ...video,
          analysisData
        };
      });

      // 调用真实API
      const response = await fetch('/api/video-understanding-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selectedVideos: videosWithAnalysis,
          referenceText,
          parameters,
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

      logger.info('视频理解生成脚本成功', {
        generatedSegmentCount: result.segments.length,
        totalDuration: result.segments.reduce((acc: number, seg: ScriptSegment) => acc + (seg.duration || 0), 0),
        metadata: result.metadata
      });

      showSuccess('脚本生成成功！');
      
      // Call the callback with generated segments
      onScriptGenerated?.(result.segments);
      
      // Close modal
      setIsModalOpen(false);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      
      logger.error('视频理解生成脚本失败', {
        error: errorMessage,
        videoCount: selectedVideos.length,
        parameters
      });

      setGenerationError(errorMessage);
      showError(`脚本生成失败: ${errorMessage}`);
    } finally {
      setIsGenerating(false);
    }
  }, [logger, showSuccess, showError, onScriptGenerated]);

  return {
    isModalOpen,
    isGenerating,
    generationError,
    openModal,
    closeModal,
    generateScript
  };
}; 