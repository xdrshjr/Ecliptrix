/**
 * @deprecated This service has been fully superseded by VideoCacheAdapter in
 * src/components/video/timeline/infrastructure/VideoCacheAdapter.ts
 * as part of the DDD refactor. No active importers remain — this file can be
 * safely deleted after verifying the build passes. Do NOT add new functionality here.
 *
 * VideoCache 服务
 * 管理视频预加载和缓存，实现无缝播放切换
 */

export interface VideoCacheItem {
  materialId: string;
  videoElement: HTMLVideoElement;
  url: string;
  loadPromise: Promise<void>;
  loadState: 'loading' | 'loaded' | 'error';
  lastAccessed: number;
  preloadStartTime: number;
  preloadEndTime?: number;
}

export interface VideoCacheStats {
  totalCached: number;
  totalLoading: number;
  totalErrors: number;
  cacheHitRate: number;
  averageLoadTime: number;
  memoryUsage: number;
}

export interface VideoCacheConfig {
  maxCacheSize: number;
  preloadTimeout: number;
  enableLRU: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

class VideoCache {
  private cache: Map<string, VideoCacheItem> = new Map();
  private config: VideoCacheConfig;
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    totalLoadTime: 0,
    loadCount: 0
  };

  constructor(config: Partial<VideoCacheConfig> = {}) {
    this.config = {
      maxCacheSize: 5,
      preloadTimeout: 30000, // 30秒超时
      enableLRU: true,
      logLevel: 'info',
      ...config
    };

    this.log('info', 'VideoCache 初始化', {
      maxCacheSize: this.config.maxCacheSize,
      preloadTimeout: this.config.preloadTimeout,
      enableLRU: this.config.enableLRU
    });
  }

  /**
   * 预加载视频
   */
  async preloadVideo(url: string, materialId: string): Promise<void> {
    // 检查是否已经在缓存中
    if (this.cache.has(materialId)) {
      const item = this.cache.get(materialId)!;
      item.lastAccessed = Date.now();
      this.log('debug', '视频已在缓存中', { materialId, url, loadState: item.loadState });
      return item.loadPromise;
    }

    // 检查缓存大小，必要时清理
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictLRU();
    }

    const startTime = Date.now();
    this.log('info', '开始预加载视频', {
      materialId,
      url,
      currentCacheSize: this.cache.size,
      maxCacheSize: this.config.maxCacheSize,
      timestamp: new Date().toISOString()
    });

    // 创建视频元素
    const videoElement = document.createElement('video');
    videoElement.preload = 'auto';
    videoElement.muted = true; // 预加载时静音
    videoElement.style.display = 'none';
    
    // 添加到DOM以确保加载
    document.body.appendChild(videoElement);

    // 创建加载Promise
    const loadPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.log('warn', '视频预加载超时', { materialId, url, timeout: this.config.preloadTimeout });
        reject(new Error(`视频预加载超时: ${url}`));
      }, this.config.preloadTimeout);

      const onCanPlayThrough = () => {
        clearTimeout(timeout);
        const endTime = Date.now();
        const loadTime = endTime - startTime;
        
        const item = this.cache.get(materialId);
        if (item) {
          item.loadState = 'loaded';
          item.preloadEndTime = endTime;
        }

        this.stats.totalLoadTime += loadTime;
        this.stats.loadCount++;

        this.log('info', '视频预加载完成', {
          materialId,
          url,
          loadTime: `${loadTime}ms`,
          videoWidth: videoElement.videoWidth,
          videoHeight: videoElement.videoHeight,
          duration: videoElement.duration?.toFixed(2) + 's',
          timestamp: new Date().toISOString()
        });

        videoElement.removeEventListener('canplaythrough', onCanPlayThrough);
        videoElement.removeEventListener('error', onError);
        resolve();
      };

      const onError = (error: Event) => {
        clearTimeout(timeout);
        const errorMsg = `视频预加载失败: ${url}`;
        
        const item = this.cache.get(materialId);
        if (item) {
          item.loadState = 'error';
        }

        this.log('error', errorMsg, { materialId, url, error: (error as ErrorEvent).message || 'Unknown error' });
        
        videoElement.removeEventListener('canplaythrough', onCanPlayThrough);
        videoElement.removeEventListener('error', onError);
        
        // 清理失败的video元素
        if (videoElement.parentNode) {
          videoElement.parentNode.removeChild(videoElement);
        }
        
        reject(new Error(errorMsg));
      };

      videoElement.addEventListener('canplaythrough', onCanPlayThrough, { once: true });
      videoElement.addEventListener('error', onError, { once: true });
    });

    // 创建缓存项
    const cacheItem: VideoCacheItem = {
      materialId,
      videoElement,
      url,
      loadPromise,
      loadState: 'loading',
      lastAccessed: Date.now(),
      preloadStartTime: startTime
    };

    this.cache.set(materialId, cacheItem);

    // 开始加载
    try {
      videoElement.src = url;
      videoElement.load();
    } catch (error) {
      this.log('error', '设置视频源失败', { materialId, url, error: (error as Error).message || 'Unknown error' });
      this.cache.delete(materialId);
      throw error;
    }

    return loadPromise;
  }

  /**
   * 获取缓存的视频元素
   */
  getVideo(materialId: string): HTMLVideoElement | null {
    this.stats.totalRequests++;
    
    const item = this.cache.get(materialId);
    if (!item) {
      this.log('debug', '缓存未命中', { materialId, totalRequests: this.stats.totalRequests });
      return null;
    }

    // 更新访问时间
    item.lastAccessed = Date.now();
    this.stats.cacheHits++;

    this.log('info', '缓存命中', {
      materialId,
      loadState: item.loadState,
      cacheHitRate: `${((this.stats.cacheHits / this.stats.totalRequests) * 100).toFixed(1)}%`,
      lastAccessed: new Date(item.lastAccessed).toISOString()
    });

    return item.loadState === 'loaded' ? item.videoElement : null;
  }

  /**
   * 获取缓存项状态
   */
  getCacheItemState(materialId: string): 'loading' | 'loaded' | 'error' | 'not-found' {
    const item = this.cache.get(materialId);
    return item ? item.loadState : 'not-found';
  }

  /**
   * 移除特定视频的缓存
   */
  removeVideo(materialId: string): void {
    const item = this.cache.get(materialId);
    if (item) {
      this.log('info', '移除视频缓存', { materialId, url: item.url });
      
      // 清理DOM元素
      if (item.videoElement.parentNode) {
        item.videoElement.parentNode.removeChild(item.videoElement);
      }
      
      this.cache.delete(materialId);
    }
  }

  /**
   * 清空所有缓存
   */
  clearCache(): void {
    this.log('info', '清空视频缓存', { totalItems: this.cache.size });
    
    this.cache.forEach((item) => {
      if (item.videoElement.parentNode) {
        item.videoElement.parentNode.removeChild(item.videoElement);
      }
    });
    
    this.cache.clear();
    this.resetStats();
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): VideoCacheStats {
    const totalCached = Array.from(this.cache.values()).filter(item => item.loadState === 'loaded').length;
    const totalLoading = Array.from(this.cache.values()).filter(item => item.loadState === 'loading').length;
    const totalErrors = Array.from(this.cache.values()).filter(item => item.loadState === 'error').length;
    const cacheHitRate = this.stats.totalRequests > 0 ? (this.stats.cacheHits / this.stats.totalRequests) * 100 : 0;
    const averageLoadTime = this.stats.loadCount > 0 ? this.stats.totalLoadTime / this.stats.loadCount : 0;

    return {
      totalCached,
      totalLoading,
      totalErrors,
      cacheHitRate: Math.round(cacheHitRate * 10) / 10,
      averageLoadTime: Math.round(averageLoadTime),
      memoryUsage: this.cache.size
    };
  }

  /**
   * LRU缓存清理
   */
  private evictLRU(): void {
    if (!this.config.enableLRU || this.cache.size === 0) return;

    // 找到最久未访问的项目
    let oldestMaterialId: string | null = null;
    let oldestAccessTime: number = Date.now();
    
    this.cache.forEach((item, materialId) => {
      if (item.lastAccessed < oldestAccessTime) {
        oldestMaterialId = materialId;
        oldestAccessTime = item.lastAccessed;
      }
    });

    if (oldestMaterialId) {
      this.log('info', 'LRU缓存清理', {
        removedMaterialId: oldestMaterialId,
        lastAccessed: new Date(oldestAccessTime).toISOString(),
        cacheSize: this.cache.size
      });
      
      this.removeVideo(oldestMaterialId);
    }
  }

  /**
   * 重置统计信息
   */
  private resetStats(): void {
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      totalLoadTime: 0,
      loadCount: 0
    };
  }

  /**
   * 日志记录
   */
  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: any): void {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    const configLevel = levels[this.config.logLevel];
    const currentLevel = levels[level];

    if (currentLevel >= configLevel) {
      const logData = {
        component: 'VideoCache',
        message,
        ...data,
        timestamp: new Date().toISOString()
      };

      switch (level) {
        case 'debug':
          console.debug(`[VideoCache] ${message}`, logData);
          break;
        case 'info':
          console.log(`[VideoCache] ${message}`, logData);
          break;
        case 'warn':
          console.warn(`[VideoCache] ${message}`, logData);
          break;
        case 'error':
          console.error(`[VideoCache] ${message}`, logData);
          break;
      }
    }
  }
}

// 创建全局单例
export const videoCache = new VideoCache({
  maxCacheSize: 10,
  preloadTimeout: 30000,
  enableLRU: true,
  logLevel: 'info'
});

export default VideoCache; 