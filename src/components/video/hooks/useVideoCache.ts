import { useState, useCallback, useEffect, useMemo } from 'react';
import { VideoCacheAdapter } from '../timeline/infrastructure';
import type { CacheState } from '../timeline/domain/ports';
import { VideoEditingLogger } from '../utils';

export type VideoCacheState = CacheState;

export interface VideoCacheStats {
  totalCached: number;
  totalLoading: number;
  totalErrors: number;
  cacheHitRate: number;
  averageLoadTime: number;
  memoryUsage: number;
}

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

// Singleton adapter instance (replaces old videoCache global).
//
// Phase-3 spec §4.1 N2: the hardcoded `maxCacheSize: 10` shadowed the new
// DEFAULT (32) and made the LRU=32 acceptance unreachable. We pass no
// override so the adapter's DEFAULT_CONFIG.maxCacheSize takes effect.
const cacheAdapter = new VideoCacheAdapter();
export const __testGetCacheAdapter = (): VideoCacheAdapter => cacheAdapter;

/**
 * Spec 06 §2.3 delete-联动: drop a deleted material's cached `<video>` element
 * from the shared adapter so it releases its decode buffers / Range sockets.
 * Module-level (not hook-bound) so the material-delete flow can call it without
 * a `useVideoCache` instance. Idempotent.
 *
 * @param materialId The material whose cached video element to drop.
 */
export function dropVideoCacheMaterial(materialId: string): void {
  cacheAdapter.drop(materialId);
}

/**
 * useVideoCache Hook
 * 管理视频缓存和预加载，提供 React 友好的 API
 *
 * Now delegates to VideoCacheAdapter from the infrastructure layer
 * instead of the deprecated VideoCache service.
 *
 * @param taskId - 任务ID，用于日志记录
 * @returns 视频缓存相关的方法和状态
 */
export const useVideoCache = (taskId: string): UseVideoCacheReturn => {
  const logger = useMemo(() => new VideoEditingLogger({
    taskId,
    component: 'useVideoCache'
  }), [taskId]);

  // Convert adapter stats to the legacy VideoCacheStats shape
  const getAdapterStats = useCallback((): VideoCacheStats => {
    const stats = cacheAdapter.getStats();
    return {
      totalCached: stats.totalCached,
      totalLoading: stats.totalLoading,
      totalErrors: stats.totalErrors,
      cacheHitRate: stats.cacheHitRate,
      averageLoadTime: 0, // Not tracked by new adapter
      memoryUsage: stats.size,
    };
  }, []);

  const [cacheStats, setCacheStats] = useState<VideoCacheStats>(() => getAdapterStats());

  const refreshStats = useCallback(() => {
    const stats = getAdapterStats();
    setCacheStats(stats);

    logger.debug('cache stats update', {
      totalCached: stats.totalCached,
      totalLoading: stats.totalLoading,
      totalErrors: stats.totalErrors,
      cacheHitRate: `${stats.cacheHitRate}%`,
      memoryUsage: stats.memoryUsage
    });
  }, [logger, getAdapterStats]);

  // 预加载视频 (note: adapter uses (materialId, url) order)
  const preloadVideo = useCallback(async (url: string, materialId: string): Promise<void> => {
    logger.info('Hook: 开始预加载视频', {
      materialId,
      url,
      timestamp: new Date().toISOString()
    });

    try {
      await cacheAdapter.preloadVideo(materialId, url);
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

  const getCachedVideo = useCallback((materialId: string): HTMLVideoElement | null => {
    const video = cacheAdapter.getVideoElement(materialId);
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

  const getCacheState = useCallback((materialId: string): VideoCacheState => {
    return cacheAdapter.getCacheState(materialId);
  }, []);

  const removeFromCache = useCallback((materialId: string): void => {
    logger.info('Hook: 移除视频缓存', { materialId });
    cacheAdapter.evict(materialId);
    refreshStats();
  }, [logger, refreshStats]);

  const clearCache = useCallback((): void => {
    logger.info('Hook: 清空所有视频缓存', {
      currentCacheSize: cacheStats.memoryUsage
    });
    cacheAdapter.clearAll();
    refreshStats();
  }, [logger, refreshStats, cacheStats.memoryUsage]);

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
    const interval = setInterval(refreshStats, 5000);
    return () => clearInterval(interval);
  }, [refreshStats]);

  // 组件卸载时的清理
  useEffect(() => {
    return () => {
      logger.info('Hook: useVideoCache 卸载', {
        finalStats: getAdapterStats()
      });
    };
  }, [logger, getAdapterStats]);

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
