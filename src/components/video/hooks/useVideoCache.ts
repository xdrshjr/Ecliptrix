import { useState, useCallback, useEffect, useMemo } from 'react';
import { videoCache, VideoCacheStats } from '../services/VideoCache';
import { VideoEditingLogger } from '../utils';

export type VideoCacheState = 'loading' | 'loaded' | 'error' | 'not-found';

export interface UseVideoCacheReturn {
  // 预加载方法
  preloadVideo: (url: string, materialId: string) => Promise<void>;
  
  // 获取缓存的视频元素
  getCachedVideo: (materialId: string) => HTMLVideoElement | null;
  
  // 获取缓存状态
  getCacheState: (materialId: string) => VideoCacheState;
  
  // 移除缓存
  removeFromCache: (materialId: string) => void;
  
  // 清空缓存
  clearCache: () => void;
  
  // 缓存统计信息
  cacheStats: VideoCacheStats;
  
  // 刷新统计信息
  refreshStats: () => void;
  
  // 批量预加载
  batchPreload: (items: Array<{ url: string; materialId: string }>) => Promise<void>;
}

/**
 * useVideoCache Hook
 * 管理视频缓存和预加载，提供 React 友好的 API
 * 
 * @param taskId - 任务ID，用于日志记录
 * @returns 视频缓存相关的方法和状态
 */
export const useVideoCache = (taskId: string): UseVideoCacheReturn => {
  // 初始化日志器
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoCache'
  }), [taskId]);

  // 缓存统计状态
  const [cacheStats, setCacheStats] = useState<VideoCacheStats>(() => videoCache.getStats());

  // 刷新统计信息
  const refreshStats = useCallback(() => {
    const stats = videoCache.getStats();
    setCacheStats(stats);
    
    logger.info('缓存统计信息更新', {
      totalCached: stats.totalCached,
      totalLoading: stats.totalLoading,
      totalErrors: stats.totalErrors,
      cacheHitRate: `${stats.cacheHitRate}%`,
      averageLoadTime: `${stats.averageLoadTime}ms`,
      memoryUsage: stats.memoryUsage
    });
  }, [logger]);

  // 预加载视频
  const preloadVideo = useCallback(async (url: string, materialId: string): Promise<void> => {
    logger.info('Hook: 开始预加载视频', {
      materialId,
      url,
      timestamp: new Date().toISOString()
    });

    try {
      await videoCache.preloadVideo(url, materialId);
      refreshStats();
      
      logger.info('Hook: 视频预加载成功', {
        materialId,
        url
      });
    } catch (error) {
      refreshStats();
      
      logger.error('Hook: 视频预加载失败', error as Error, {
        materialId,
        url
      });
      
      throw error;
    }
  }, [logger, refreshStats]);

  // 获取缓存的视频元素
  const getCachedVideo = useCallback((materialId: string): HTMLVideoElement | null => {
    const video = videoCache.getVideo(materialId);
    refreshStats();
    
    if (video) {
      logger.info('Hook: 成功获取缓存视频', {
        materialId,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        duration: video.duration?.toFixed(2) + 's'
      });
    } else {
      logger.debug('Hook: 缓存视频未找到', { materialId });
    }
    
    return video;
  }, [logger, refreshStats]);

  // 获取缓存状态
  const getCacheState = useCallback((materialId: string): VideoCacheState => {
    return videoCache.getCacheItemState(materialId);
  }, []);

  // 移除缓存
  const removeFromCache = useCallback((materialId: string): void => {
    logger.info('Hook: 移除视频缓存', { materialId });
    
    videoCache.removeVideo(materialId);
    refreshStats();
  }, [logger, refreshStats]);

  // 清空缓存
  const clearCache = useCallback((): void => {
    logger.info('Hook: 清空所有视频缓存', {
      currentCacheSize: cacheStats.memoryUsage
    });
    
    videoCache.clearCache();
    refreshStats();
  }, [logger, refreshStats, cacheStats.memoryUsage]);

  // 批量预加载
  const batchPreload = useCallback(async (
    items: Array<{ url: string; materialId: string }>
  ): Promise<void> => {
    logger.info('Hook: 开始批量预加载', {
      totalItems: items.length,
      items: items.map(item => ({
        materialId: item.materialId,
        url: item.url
      }))
    });

    const startTime = Date.now();
    const results = await Promise.allSettled(
      items.map(item => preloadVideo(item.url, item.materialId))
    );

    const successful = results.filter(result => result.status === 'fulfilled').length;
    const failed = results.filter(result => result.status === 'rejected').length;
    const totalTime = Date.now() - startTime;

    logger.info('Hook: 批量预加载完成', {
      totalItems: items.length,
      successful,
      failed,
      successRate: `${((successful / items.length) * 100).toFixed(1)}%`,
      totalTime: `${totalTime}ms`,
      averageTimePerItem: `${Math.round(totalTime / items.length)}ms`
    });

    // 记录失败的项目
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        logger.error('Hook: 批量预加载项目失败', result.reason, {
          materialId: items[index].materialId,
          url: items[index].url,
          index
        });
      }
    });

    refreshStats();
  }, [preloadVideo, logger, refreshStats]);

  // 定期刷新统计信息
  useEffect(() => {
    const interval = setInterval(refreshStats, 5000); // 每5秒刷新一次
    return () => clearInterval(interval);
  }, [refreshStats]);

  // 组件卸载时的清理
  useEffect(() => {
    return () => {
      logger.info('Hook: useVideoCache 卸载', {
        finalStats: videoCache.getStats()
      });
    };
  }, [logger]);

  return {
    preloadVideo,
    getCachedVideo,
    getCacheState,
    removeFromCache,
    clearCache,
    cacheStats,
    refreshStats,
    batchPreload
  };
}; 