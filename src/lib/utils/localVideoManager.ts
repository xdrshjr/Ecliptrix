/**
 * Local Video File Manager
 * 管理本地视频文件的存储、访问和清理
 */

export interface LocalVideoFile {
  fileName: string;
  url: string;
  blob: Blob;
  createdAt: Date;
  size: number;
  thumbnailUrl?: string;
  thumbnailBlob?: Blob;
  metadata?: {
    duration?: number;
    width?: number;
    height?: number;
    format?: string;
  };
}

class LocalVideoManager {
  private videoCache: Map<string, LocalVideoFile> = new Map();
  private readonly STORAGE_KEY = 'ecliptrix_local_video_cache';
  private readonly MAX_CACHE_SIZE = 500 * 1024 * 1024; // 500MB (larger than audio)
  private readonly MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.loadCacheFromStorage();
    this.startCleanupTimer();
  }

  /**
   * 存储视频文件到本地
   */
  async storeVideoFile(
    fileName: string, 
    blob: Blob, 
    thumbnailBlob?: Blob,
    metadata?: {
      duration?: number;
      width?: number;
      height?: number;
      format?: string;
    }
  ): Promise<{ videoUrl: string; thumbnailUrl?: string }> {
    try {
      console.log('[LocalVideoManager] 存储视频文件', {
        fileName,
        fileSize: blob.size,
        hasThumbnail: !!thumbnailBlob,
        metadata,
        timestamp: new Date().toISOString()
      });

      // 清理旧文件以腾出空间
      this.cleanupOldFiles();

      // 创建视频对象URL
      const videoUrl = URL.createObjectURL(blob);
      
      // 创建缩略图对象URL（如果有）
      let thumbnailUrl: string | undefined;
      if (thumbnailBlob) {
        thumbnailUrl = URL.createObjectURL(thumbnailBlob);
      }

      // 存储到缓存
      const videoFile: LocalVideoFile = {
        fileName,
        url: videoUrl,
        blob,
        createdAt: new Date(),
        size: blob.size,
        thumbnailUrl,
        thumbnailBlob,
        metadata
      };

      this.videoCache.set(fileName, videoFile);

      // 保存到localStorage（仅保存元数据）
      this.saveCacheToStorage();

      console.log('[LocalVideoManager] 视频文件存储成功', {
        fileName,
        videoUrl,
        thumbnailUrl,
        cacheSize: this.videoCache.size,
        totalSize: this.getTotalCacheSize(),
        metadata
      });

      return { videoUrl, thumbnailUrl };
    } catch (error) {
      console.error('[LocalVideoManager] 视频文件存储失败', {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 获取本地视频文件URL
   */
  getVideoFileUrl(fileName: string): { videoUrl: string | null; thumbnailUrl?: string } {
    const videoFile = this.videoCache.get(fileName);
    
    if (!videoFile) {
      console.log('[LocalVideoManager] 本地视频文件不存在', {
        fileName,
        cacheSize: this.videoCache.size
      });
      return { videoUrl: null };
    }

    // 检查文件是否过期
    const now = new Date();
    const age = now.getTime() - videoFile.createdAt.getTime();
    
    if (age > this.MAX_CACHE_AGE) {
      console.log('[LocalVideoManager] 本地视频文件已过期，清理中', {
        fileName,
        age: Math.round(age / 1000 / 60) + ' minutes'
      });
      this.removeVideoFile(fileName);
      return { videoUrl: null };
    }

    console.log('[LocalVideoManager] 获取本地视频文件URL', {
      fileName,
      videoUrl: videoFile.url,
      thumbnailUrl: videoFile.thumbnailUrl,
      age: Math.round(age / 1000) + ' seconds'
    });

    return { 
      videoUrl: videoFile.url, 
      thumbnailUrl: videoFile.thumbnailUrl 
    };
  }

  /**
   * 检查本地是否存在视频文件
   */
  hasVideoFile(fileName: string): boolean {
    const exists = this.videoCache.has(fileName);
    console.log('[LocalVideoManager] 检查本地视频文件存在性', {
      fileName,
      exists
    });
    return exists;
  }

  /**
   * 移除视频文件
   */
  removeVideoFile(fileName: string): void {
    const videoFile = this.videoCache.get(fileName);
    
    if (videoFile) {
      // 释放对象URL
      URL.revokeObjectURL(videoFile.url);
      if (videoFile.thumbnailUrl) {
        URL.revokeObjectURL(videoFile.thumbnailUrl);
      }
      
      // 从缓存中移除
      this.videoCache.delete(fileName);
      
      // 更新存储
      this.saveCacheToStorage();

      console.log('[LocalVideoManager] 视频文件已移除', {
        fileName,
        remainingCacheSize: this.videoCache.size
      });
    }
  }

  /**
   * 清理所有视频文件
   */
  clearAllVideoFiles(): void {
    console.log('[LocalVideoManager] 清理所有视频文件', {
      currentCacheSize: this.videoCache.size
    });

    // 释放所有对象URL
    this.videoCache.forEach((videoFile) => {
      URL.revokeObjectURL(videoFile.url);
      if (videoFile.thumbnailUrl) {
        URL.revokeObjectURL(videoFile.thumbnailUrl);
      }
    });

    // 清空缓存
    this.videoCache.clear();

    // 清空存储
    this.saveCacheToStorage();

    console.log('[LocalVideoManager] 所有视频文件已清理');
  }

  /**
   * 生成视频缩略图（客户端生成）
   */
  async generateThumbnail(videoBlob: Blob, timeSeconds: number = 1): Promise<Blob> {
    return new Promise((resolve, reject) => {
      try {
        const video = document.createElement('video');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          reject(new Error('无法获取Canvas上下文'));
          return;
        }

        video.onloadedmetadata = () => {
          // 设置画布尺寸
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          
          // 跳转到指定时间
          video.currentTime = Math.min(timeSeconds, video.duration);
        };

        video.onseeked = () => {
          try {
            // 绘制当前帧到画布
            ctx.drawImage(video, 0, 0);
            
            // 转换为Blob
            canvas.toBlob((blob) => {
              if (blob) {
                resolve(blob);
              } else {
                reject(new Error('无法生成缩略图Blob'));
              }
            }, 'image/jpeg', 0.8);
            
            // 清理
            URL.revokeObjectURL(video.src);
          } catch (error) {
            reject(error);
          }
        };

        video.onerror = () => {
          reject(new Error('视频加载失败'));
        };

        // 设置视频源
        video.src = URL.createObjectURL(videoBlob);
        video.load();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    fileCount: number;
    totalSize: number;
    oldestFile: Date | null;
    newestFile: Date | null;
    videosWithThumbnails: number;
  } {
    const files = Array.from(this.videoCache.values());
    
    return {
      fileCount: files.length,
      totalSize: this.getTotalCacheSize(),
      oldestFile: files.length > 0 
        ? new Date(Math.min(...files.map(f => f.createdAt.getTime())))
        : null,
      newestFile: files.length > 0 
        ? new Date(Math.max(...files.map(f => f.createdAt.getTime())))
        : null,
      videosWithThumbnails: files.filter(f => f.thumbnailUrl).length
    };
  }

  /**
   * 从localStorage加载缓存元数据
   */
  private loadCacheFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const metadata = JSON.parse(stored);
        console.log('[LocalVideoManager] 从存储加载缓存元数据', {
          fileCount: Object.keys(metadata).length
        });
      }
    } catch (error) {
      console.error('[LocalVideoManager] 加载缓存元数据失败', error);
    }
  }

  /**
   * 保存缓存元数据到localStorage
   */
  private saveCacheToStorage(): void {
    try {
      const metadata: Record<string, { 
        fileName: string; 
        createdAt: string; 
        size: number;
        hasThumbnail: boolean;
        metadata?: any;
      }> = {};
      
      this.videoCache.forEach((videoFile, fileName) => {
        metadata[fileName] = {
          fileName: videoFile.fileName,
          createdAt: videoFile.createdAt.toISOString(),
          size: videoFile.size,
          hasThumbnail: !!videoFile.thumbnailUrl,
          metadata: videoFile.metadata
        };
      });

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(metadata));
    } catch (error) {
      console.error('[LocalVideoManager] 保存缓存元数据失败', error);
    }
  }

  /**
   * 获取总缓存大小
   */
  private getTotalCacheSize(): number {
    return Array.from(this.videoCache.values())
      .reduce((total, videoFile) => {
        let size = videoFile.size;
        if (videoFile.thumbnailBlob) {
          size += videoFile.thumbnailBlob.size;
        }
        return total + size;
      }, 0);
  }

  /**
   * 清理旧文件
   */
  private cleanupOldFiles(): void {
    const now = new Date();
    const filesToRemove: string[] = [];

    // 找出过期文件
    this.videoCache.forEach((videoFile, fileName) => {
      const age = now.getTime() - videoFile.createdAt.getTime();
      if (age > this.MAX_CACHE_AGE) {
        filesToRemove.push(fileName);
      }
    });

    // 移除过期文件
    filesToRemove.forEach(fileName => {
      this.removeVideoFile(fileName);
    });

    // 如果缓存仍然太大，移除最旧的文件
    while (this.getTotalCacheSize() > this.MAX_CACHE_SIZE && this.videoCache.size > 0) {
      const oldestFile = this.findOldestFile();
      if (oldestFile) {
        console.log('[LocalVideoManager] 缓存空间不足，移除最旧文件', {
          fileName: oldestFile,
          totalSize: this.getTotalCacheSize()
        });
        this.removeVideoFile(oldestFile);
      } else {
        break;
      }
    }
  }

  /**
   * 找出最旧的文件
   */
  private findOldestFile(): string | null {
    let oldestFile: string | null = null;
    let oldestTime = Infinity;

    this.videoCache.forEach((videoFile, fileName) => {
      if (videoFile.createdAt.getTime() < oldestTime) {
        oldestTime = videoFile.createdAt.getTime();
        oldestFile = fileName;
      }
    });

    return oldestFile;
  }

  /**
   * 启动定期清理定时器
   */
  private startCleanupTimer(): void {
    // 每小时清理一次
    setInterval(() => {
      console.log('[LocalVideoManager] 执行定期清理');
      this.cleanupOldFiles();
    }, 60 * 60 * 1000);
  }
}

// 创建单例实例
export const localVideoManager = new LocalVideoManager();

// 导出类型和实例
export { LocalVideoManager };
export default localVideoManager; 