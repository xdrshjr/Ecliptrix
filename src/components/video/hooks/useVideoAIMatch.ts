/**
 * useVideoAIMatch Hook
 * 管理视频AI匹配功能
 */

import { useState, useCallback, useMemo } from 'react';
import { createVideoAIMatchService, VideoAIMatchResponse, VideoMatchResult } from '../services/videoAIMatchService';
import { VideoEditingLogger } from '../utils/logger';
import { MaterialItem } from '@/types';
import { VideoAnalysisResponse } from '../services/videoAnalysisService';

interface VideoAIMatchState {
  isMatching: boolean;
  lastMatchResult: VideoAIMatchResponse | null;
  error: string | null;
}

export interface UseVideoAIMatchReturn {
  // 状态
  matchState: VideoAIMatchState;
  
  // 方法
  matchVideos: (
    scriptText: string, 
    materials: MaterialItem[], 
    getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null,
    segmentDuration?: number
  ) => Promise<VideoMatchResult[]>;
  
  convertMatchesToMaterials: (matches: VideoMatchResult[], materials: MaterialItem[]) => MaterialItem[];
  
  clearMatchState: () => void;
  
  // 辅助方法
  hasAnalyzedVideos: (materials: MaterialItem[], getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null) => boolean;
  getAnalyzedVideoCount: (materials: MaterialItem[], getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null) => number;
}

/**
 * useVideoAIMatch Hook
 * 管理视频AI匹配操作
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns 视频AI匹配相关的状态和方法
 */
export const useVideoAIMatch = (taskId: string): UseVideoAIMatchReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoAIMatch'
  }), [taskId]);

  // 初始化服务
  const videoAIMatchService = useMemo(() => createVideoAIMatchService(taskId), [taskId]);

  // 状态管理
  const [matchState, setMatchState] = useState<VideoAIMatchState>({
    isMatching: false,
    lastMatchResult: null,
    error: null
  });

  // 匹配视频
  const matchVideos = useCallback(async (
    scriptText: string,
    materials: MaterialItem[],
    getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null,
    segmentDuration?: number
  ): Promise<VideoMatchResult[]> => {
    logger.userAction('开始视频AI匹配', 'matchVideos', {
      scriptTextLength: scriptText.length,
      scriptPreview: scriptText.substring(0, 100),
      materialCount: materials.length,
      videoMaterialCount: materials.filter(m => m.type === 'video').length,
      segmentDuration: segmentDuration
    });

    // 更新状态为匹配中
    setMatchState(prev => ({
      ...prev,
      isMatching: true,
      error: null
    }));

    try {
      const result = await videoAIMatchService.matchVideos({
        scriptText,
        materials,
        getVideoAnalysisResult,
        taskId,
        segmentDuration
      });

      logger.info('视频AI匹配完成', {
        success: result.success,
        matchCount: result.matches.length,
        totalAnalyzed: result.totalAnalyzed,
        processingTime: result.processingTime,
        matches: result.matches.map(match => ({
          materialId: match.materialId,
          videoName: match.videoName,
          matchScore: match.matchScore
        }))
      });

      // 更新状态为完成
      setMatchState(prev => ({
        ...prev,
        isMatching: false,
        lastMatchResult: result,
        error: result.success ? null : result.message
      }));

      return result.matches;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '视频AI匹配失败';
      
      logger.error('视频AI匹配失败', error as Error, {
        scriptTextLength: scriptText.length,
        materialCount: materials.length,
        segmentDuration: segmentDuration
      });

      // 更新状态为错误
      setMatchState(prev => ({
        ...prev,
        isMatching: false,
        error: errorMessage
      }));

      throw error;
    }
  }, [videoAIMatchService, logger, taskId]);

  // 将匹配结果转换为素材项
  const convertMatchesToMaterials = useCallback((matches: VideoMatchResult[], materials: MaterialItem[]): MaterialItem[] => {
    logger.info('转换匹配结果为素材项', {
      matchCount: matches.length,
      materialCount: materials.length
    });

    return videoAIMatchService.convertMatchesToMaterials(matches, materials);
  }, [videoAIMatchService, logger]);

  // 清除匹配状态
  const clearMatchState = useCallback(() => {
    logger.userAction('清除匹配状态', 'clearMatchState');
    
    setMatchState({
      isMatching: false,
      lastMatchResult: null,
      error: null
    });
  }, [logger]);

  // 检查是否有已分析的视频
  const hasAnalyzedVideos = useCallback((
    materials: MaterialItem[], 
    getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null
  ): boolean => {
    const analyzedCount = materials
      .filter(material => material.type === 'video' && material.url)
      .filter(material => {
        const analysisResult = getVideoAnalysisResult(material.url!);
        return analysisResult && 
               analysisResult.success && 
               analysisResult.frame_analyses && 
               analysisResult.frame_analyses.length > 0;
      }).length;

    return analyzedCount > 0;
  }, [logger]);

  // 获取已分析视频数量
  const getAnalyzedVideoCount = useCallback((
    materials: MaterialItem[], 
    getVideoAnalysisResult: (videoUrl: string) => VideoAnalysisResponse | null
  ): number => {
    const analyzedVideos = materials
      .filter(material => material.type === 'video' && material.url)
      .filter(material => {
        const analysisResult = getVideoAnalysisResult(material.url!);
        return analysisResult && 
               analysisResult.success && 
               analysisResult.frame_analyses && 
               analysisResult.frame_analyses.length > 0;
      });

    logger.debug('统计已分析视频数量', {
      totalMaterials: materials.length,
      videoMaterials: materials.filter(m => m.type === 'video').length,
      analyzedCount: analyzedVideos.length,
      analyzedVideos: analyzedVideos.map(m => ({
        id: m.id,
        name: m.name,
        url: m.url
      }))
    });

    return analyzedVideos.length;
  }, [logger]);

  return {
    matchState,
    matchVideos,
    convertMatchesToMaterials,
    clearMatchState,
    hasAnalyzedVideos,
    getAnalyzedVideoCount
  };
}; 