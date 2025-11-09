/**
 * useVideoAnalysis Hook
 * 管理视频AI解析功能
 */

import { useState, useCallback, useMemo } from 'react';
import { createVideoAnalysisService, VideoAnalysisResponse } from '../services/videoAnalysisService';
import { VideoEditingLogger } from '../utils/logger';

interface VideoAnalysisState {
  [videoUrl: string]: {
    status: 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error';
    result?: VideoAnalysisResponse;
    error?: string;
    queuePosition?: number; // 队列中的位置（仅当status为waiting时）
  };
}

export interface UseVideoAnalysisReturn {
  // 状态
  analysisStates: VideoAnalysisState;
  isModalOpen: boolean;
  currentAnalysisResult: VideoAnalysisResponse | null;
  currentVideoUrl: string | null;
  
  // 方法
  analyzeVideo: (videoUrl: string, frameInterval?: number, customPrompt?: string, thumbnailUrl?: string, useThumbnail?: boolean) => Promise<void>;
  analyzeVideoWithQueue: (videoUrl: string, frameInterval?: number, customPrompt?: string, thumbnailUrl?: string, useThumbnail?: boolean) => Promise<void>;
  getAnalysisStatus: (videoUrl: string) => 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error';
  getAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null;
  openAnalysisModal: (videoUrl: string) => void;
  closeAnalysisModal: () => void;
  clearAnalysis: (videoUrl: string) => void;
  
  // 批量状态管理方法
  setAnalysisStatus: (videoUrl: string, status: 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error', result?: VideoAnalysisResponse, error?: string, queuePosition?: number) => void;
  setBatchAnalysisStatus: (updates: Array<{ videoUrl: string; status: 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error'; result?: VideoAnalysisResponse; error?: string; queuePosition?: number }>) => void;
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
    customPrompt?: string,
    thumbnailUrl?: string,
    useThumbnail: boolean = false
  ) => {
    logger.userAction('开始视频解析', 'analyzeVideo', {
      videoUrl,
      frameInterval,
      hasCustomPrompt: !!customPrompt,
      thumbnailUrl,
      useThumbnail
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
        taskId,
        thumbnailUrl,
        useThumbnail
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

  // 带队列管理的视频解析
  const analyzeVideoWithQueue = useCallback(async (
    videoUrl: string,
    frameInterval: number = 5,
    customPrompt?: string,
    thumbnailUrl?: string,
    useThumbnail: boolean = false
  ) => {
    logger.userAction('开始视频解析（队列管理）', 'analyzeVideoWithQueue', {
      videoUrl,
      frameInterval,
      hasCustomPrompt: !!customPrompt,
      thumbnailUrl,
      useThumbnail
    });

    // 先设置为等待状态
    setAnalysisStates(prev => ({
      ...prev,
      [videoUrl]: {
        status: 'waiting'
      }
    }));

    const MAX_POLL_TIME = 300000; // 5分钟最大等待时间
    const POLL_INTERVAL = 3000; // 3秒轮询间隔
    const startTime = Date.now();

    // 轮询队列状态
    const pollQueue = async (): Promise<boolean> => {
      try {
        // 检查是否超时
        if (Date.now() - startTime > MAX_POLL_TIME) {
          logger.error('队列等待超时', new Error('Queue wait timeout'), {
            videoUrl,
            waitTime: Date.now() - startTime
          });
          
          setAnalysisStates(prev => ({
            ...prev,
            [videoUrl]: {
              status: 'error',
              error: '等待超时，请稍后重试'
            }
          }));
          
          return false;
        }

        // 查询队列状态
        const queueStatus = await videoAnalysisService.getQueueStatus();
        
        logger.info('队列状态查询结果', {
          videoUrl,
          currentProcessing: queueStatus.queue_info.current_processing,
          maxConcurrent: queueStatus.queue_info.max_concurrent,
          queuedCount: queueStatus.queue_info.queued_count
        });

        // 检查是否有空闲位置
        const hasAvailableSlot = queueStatus.queue_info.current_processing < queueStatus.queue_info.max_concurrent;

        if (hasAvailableSlot) {
          // 队列有空闲，可以开始解析
          logger.info('队列有空闲位置，开始解析', {
            videoUrl,
            currentProcessing: queueStatus.queue_info.current_processing,
            maxConcurrent: queueStatus.queue_info.max_concurrent
          });
          
          return true;
        } else {
          // 继续等待
          logger.info('队列已满，继续等待', {
            videoUrl,
            currentProcessing: queueStatus.queue_info.current_processing,
            maxConcurrent: queueStatus.queue_info.max_concurrent,
            queuedCount: queueStatus.queue_info.queued_count
          });
          
          // 保持等待状态
          setAnalysisStates(prev => ({
            ...prev,
            [videoUrl]: {
              status: 'waiting'
            }
          }));
          
          return false;
        }
      } catch (error) {
        logger.error('查询队列状态失败', error as Error, { videoUrl });
        
        // 查询失败，仍然继续等待并重试
        return false;
      }
    };

    // 开始轮询
    try {
      let canProceed = await pollQueue();
      
      while (!canProceed) {
        // 等待3秒后再次轮询
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
        canProceed = await pollQueue();
      }

      // 队列有空闲，开始解析
      logger.info('队列检查完成，开始视频解析', { 
        videoUrl, 
        useThumbnail,
        thumbnailUrl 
      });
      
      // 调用实际的解析方法
      await analyzeVideo(videoUrl, frameInterval, customPrompt, thumbnailUrl, useThumbnail);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '视频解析失败';
      
      logger.error('视频解析（队列管理）失败', error as Error, {
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
  }, [videoAnalysisService, logger, analyzeVideo, taskId]);

  // 获取分析状态
  const getAnalysisStatus = useCallback((videoUrl: string): 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error' => {
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

  // 设置单个视频的分析状态
  const setAnalysisStatus = useCallback((
    videoUrl: string, 
    status: 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error',
    result?: VideoAnalysisResponse,
    error?: string,
    queuePosition?: number
  ) => {
    logger.info('设置视频解析状态', {
      videoUrl,
      status,
      hasResult: !!result,
      hasError: !!error,
      queuePosition
    });

    setAnalysisStates(prev => ({
      ...prev,
      [videoUrl]: {
        status,
        result,
        error,
        queuePosition
      }
    }));
  }, [logger]);

  // 批量设置视频的分析状态
  const setBatchAnalysisStatus = useCallback((
    updates: Array<{ 
      videoUrl: string; 
      status: 'idle' | 'waiting' | 'analyzing' | 'completed' | 'error';
      result?: VideoAnalysisResponse;
      error?: string;
      queuePosition?: number;
    }>
  ) => {
    logger.info('批量设置视频解析状态', {
      updatesCount: updates.length,
      updates: updates.map(u => ({ videoUrl: u.videoUrl, status: u.status, queuePosition: u.queuePosition }))
    });

    setAnalysisStates(prev => {
      const newState = { ...prev };
      updates.forEach(update => {
        newState[update.videoUrl] = {
          status: update.status,
          result: update.result,
          error: update.error,
          queuePosition: update.queuePosition
        };
      });
      return newState;
    });
  }, [logger]);

  return {
    // 状态
    analysisStates,
    isModalOpen,
    currentAnalysisResult,
    currentVideoUrl,
    
    // 方法
    analyzeVideo,
    analyzeVideoWithQueue,
    getAnalysisStatus,
    getAnalysisResult,
    openAnalysisModal,
    closeAnalysisModal,
    clearAnalysis,
    
    // 批量状态管理方法
    setAnalysisStatus,
    setBatchAnalysisStatus
  };
}; 