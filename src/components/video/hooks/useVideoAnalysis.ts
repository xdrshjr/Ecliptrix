/**
 * useVideoAnalysis Hook
 * 管理视频AI解析功能
 */

import { useState, useCallback, useMemo } from 'react';
import { createVideoAnalysisService, VideoAnalysisResponse } from '../services/videoAnalysisService';
import { VideoEditingLogger } from '../utils/logger';

interface VideoAnalysisState {
  [videoUrl: string]: {
    status: 'idle' | 'analyzing' | 'completed' | 'error';
    result?: VideoAnalysisResponse;
    error?: string;
  };
}

export interface UseVideoAnalysisReturn {
  // 状态
  analysisStates: VideoAnalysisState;
  isModalOpen: boolean;
  currentAnalysisResult: VideoAnalysisResponse | null;
  currentVideoUrl: string | null;
  
  // 方法
  analyzeVideo: (videoUrl: string, frameInterval?: number, customPrompt?: string) => Promise<void>;
  getAnalysisStatus: (videoUrl: string) => 'idle' | 'analyzing' | 'completed' | 'error';
  getAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null;
  openAnalysisModal: (videoUrl: string) => void;
  closeAnalysisModal: () => void;
  clearAnalysis: (videoUrl: string) => void;
}

/**
 * useVideoAnalysis Hook
 * 管理视频AI解析操作
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns 视频解析相关的状态和方法
 */
export const useVideoAnalysis = (taskId: string): UseVideoAnalysisReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoAnalysis'
  }), [taskId]);

  // 初始化服务
  const videoAnalysisService = useMemo(() => createVideoAnalysisService(taskId), [taskId]);

  // 状态管理
  const [analysisStates, setAnalysisStates] = useState<VideoAnalysisState>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentAnalysisResult, setCurrentAnalysisResult] = useState<VideoAnalysisResponse | null>(null);
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string | null>(null);

  // 分析视频
  const analyzeVideo = useCallback(async (
    videoUrl: string, 
    frameInterval: number = 5, 
    customPrompt?: string
  ) => {
    logger.userAction('开始视频解析', 'analyzeVideo', {
      videoUrl,
      frameInterval,
      hasCustomPrompt: !!customPrompt
    });

    // 更新状态为分析中
    setAnalysisStates(prev => ({
      ...prev,
      [videoUrl]: {
        status: 'analyzing'
      }
    }));

    try {
      const result = await videoAnalysisService.analyzeVideo({
        videoUrl,
        frameInterval,
        customPrompt,
        taskId
      });

      logger.info('视频解析完成', {
        videoUrl,
        success: result.success,
        framesExtracted: result.total_frames_extracted,
        processingTime: result.processing_time
      });

      // 更新状态为完成
      setAnalysisStates(prev => ({
        ...prev,
        [videoUrl]: {
          status: result.success ? 'completed' : 'error',
          result,
          error: result.success ? undefined : result.message
        }
      }));

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '视频解析失败';
      
      logger.error('视频解析失败', error as Error, {
        videoUrl,
        frameInterval,
        hasCustomPrompt: !!customPrompt
      });

      // 更新状态为错误
      setAnalysisStates(prev => ({
        ...prev,
        [videoUrl]: {
          status: 'error',
          error: errorMessage
        }
      }));

      throw error;
    }
  }, [videoAnalysisService, logger, taskId]);

  // 获取分析状态
  const getAnalysisStatus = useCallback((videoUrl: string) => {
    return analysisStates[videoUrl]?.status || 'idle';
  }, [analysisStates]);

  // 获取分析结果
  const getAnalysisResult = useCallback((videoUrl: string) => {
    return analysisStates[videoUrl]?.result || null;
  }, [analysisStates]);

  // 打开解析结果弹窗
  const openAnalysisModal = useCallback((videoUrl: string) => {
    const analysisState = analysisStates[videoUrl];
    
    if (analysisState?.status === 'completed' && analysisState.result) {
      logger.userAction('打开视频解析结果弹窗', 'openAnalysisModal', {
        videoUrl,
        framesCount: analysisState.result.total_frames_extracted
      });

      setCurrentAnalysisResult(analysisState.result);
      setCurrentVideoUrl(videoUrl);
      setIsModalOpen(true);
    } else {
      logger.error('尝试打开未完成的视频解析结果', new Error('Analysis not completed'), {
        videoUrl,
        status: analysisState?.status || 'idle'
      });
    }
  }, [analysisStates, logger]);

  // 关闭解析结果弹窗
  const closeAnalysisModal = useCallback(() => {
    logger.userAction('关闭视频解析结果弹窗', 'closeAnalysisModal', {
      videoUrl: currentVideoUrl
    });

    setIsModalOpen(false);
    setCurrentAnalysisResult(null);
    setCurrentVideoUrl(null);
  }, [logger, currentVideoUrl]);

  // 清除分析结果
  const clearAnalysis = useCallback((videoUrl: string) => {
    logger.userAction('清除视频解析结果', 'clearAnalysis', {
      videoUrl
    });

    setAnalysisStates(prev => {
      const newState = { ...prev };
      delete newState[videoUrl];
      return newState;
    });

    // 如果当前打开的弹窗是这个视频的，关闭弹窗
    if (currentVideoUrl === videoUrl && isModalOpen) {
      closeAnalysisModal();
    }
  }, [logger, currentVideoUrl, isModalOpen, closeAnalysisModal]);

  return {
    // 状态
    analysisStates,
    isModalOpen,
    currentAnalysisResult,
    currentVideoUrl,
    
    // 方法
    analyzeVideo,
    getAnalysisStatus,
    getAnalysisResult,
    openAnalysisModal,
    closeAnalysisModal,
    clearAnalysis
  };
}; 