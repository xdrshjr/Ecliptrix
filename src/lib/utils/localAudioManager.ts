/**
 * Local Audio File Manager
 * 管理本地音频文件的存储、访问和清理
 */

export interface LocalAudioFile {
  fileName: string;
  url: string;
  blob: Blob;
  createdAt: Date;
  size: number;
}

class LocalAudioManager {
  private audioCache: Map<string, LocalAudioFile> = new Map();
  private readonly STORAGE_KEY = 'ecliptrix_local_audio_cache';
  private readonly MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
  private readonly MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.loadCacheFromStorage();
    this.startCleanupTimer();
  }

  /**
   * 存储音频文件到本地
   */
  async storeAudioFile(fileName: string, blob: Blob): Promise<string> {
    try {
      console.log('[LocalAudioManager] 存储音频文件', {
        fileName,
        fileSize: blob.size,
        timestamp: new Date().toISOString()
      });

      // 清理旧文件以腾出空间
      this.cleanupOldFiles();

      // 创建对象URL
      const url = URL.createObjectURL(blob);

      // 存储到缓存
      const audioFile: LocalAudioFile = {
        fileName,
        url,
        blob,
        createdAt: new Date(),
        size: blob.size
      };

      this.audioCache.set(fileName, audioFile);

      // 保存到localStorage（仅保存元数据）
      this.saveCacheToStorage();

      console.log('[LocalAudioManager] 音频文件存储成功', {
        fileName,
        url,
        cacheSize: this.audioCache.size,
        totalSize: this.getTotalCacheSize()
      });

      return url;
    } catch (error) {
      console.error('[LocalAudioManager] 音频文件存储失败', {
        fileName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * 获取本地音频文件URL
   */
  getAudioFileUrl(fileName: string): string | null {
    const audioFile = this.audioCache.get(fileName);
    
    if (!audioFile) {
      console.log('[LocalAudioManager] 本地音频文件不存在', {
        fileName,
        cacheSize: this.audioCache.size
      });
      return null;
    }

    // 检查文件是否过期
    const now = new Date();
    const age = now.getTime() - audioFile.createdAt.getTime();
    
    if (age > this.MAX_CACHE_AGE) {
      console.log('[LocalAudioManager] 本地音频文件已过期，清理中', {
        fileName,
        age: Math.round(age / 1000 / 60) + ' minutes'
      });
      this.removeAudioFile(fileName);
      return null;
    }

    console.log('[LocalAudioManager] 获取本地音频文件URL', {
      fileName,
      url: audioFile.url,
      age: Math.round(age / 1000) + ' seconds'
    });

    return audioFile.url;
  }

  /**
   * 检查本地是否存在音频文件
   */
  hasAudioFile(fileName: string): boolean {
    const exists = this.audioCache.has(fileName);
    console.log('[LocalAudioManager] 检查本地音频文件存在性', {
      fileName,
      exists
    });
    return exists;
  }

  /**
   * 移除音频文件
   */
  removeAudioFile(fileName: string): void {
    const audioFile = this.audioCache.get(fileName);
    
    if (audioFile) {
      // 释放对象URL
      URL.revokeObjectURL(audioFile.url);
      
      // 从缓存中移除
      this.audioCache.delete(fileName);
      
      // 更新存储
      this.saveCacheToStorage();

      console.log('[LocalAudioManager] 音频文件已移除', {
        fileName,
        remainingCacheSize: this.audioCache.size
      });
    }
  }

  /**
   * 清理所有音频文件
   */
  clearAllAudioFiles(): void {
    console.log('[LocalAudioManager] 清理所有音频文件', {
      currentCacheSize: this.audioCache.size
    });

    // 释放所有对象URL
    this.audioCache.forEach((audioFile) => {
      URL.revokeObjectURL(audioFile.url);
    });

    // 清空缓存
    this.audioCache.clear();

    // 清空存储
    this.saveCacheToStorage();

    console.log('[LocalAudioManager] 所有音频文件已清理');
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    fileCount: number;
    totalSize: number;
    oldestFile: Date | null;
    newestFile: Date | null;
  } {
    const files = Array.from(this.audioCache.values());
    
    return {
      fileCount: files.length,
      totalSize: this.getTotalCacheSize(),
      oldestFile: files.length > 0 
        ? new Date(Math.min(...files.map(f => f.createdAt.getTime())))
        : null,
      newestFile: files.length > 0 
        ? new Date(Math.max(...files.map(f => f.createdAt.getTime())))
        : null
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
        console.log('[LocalAudioManager] 从存储加载缓存元数据', {
          fileCount: Object.keys(metadata).length
        });
      }
    } catch (error) {
      console.error('[LocalAudioManager] 加载缓存元数据失败', error);
    }
  }

  /**
   * 保存缓存元数据到localStorage
   */
  private saveCacheToStorage(): void {
    try {
      const metadata: Record<string, { fileName: string; createdAt: string; size: number }> = {};
      
      this.audioCache.forEach((audioFile, fileName) => {
        metadata[fileName] = {
          fileName: audioFile.fileName,
          createdAt: audioFile.createdAt.toISOString(),
          size: audioFile.size
        };
      });

      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(metadata));
    } catch (error) {
      console.error('[LocalAudioManager] 保存缓存元数据失败', error);
    }
  }

  /**
   * 获取总缓存大小
   */
  private getTotalCacheSize(): number {
    return Array.from(this.audioCache.values())
      .reduce((total, audioFile) => total + audioFile.size, 0);
  }

  /**
   * 清理旧文件
   */
  private cleanupOldFiles(): void {
    const now = new Date();
    const filesToRemove: string[] = [];

    // 找出过期文件
    this.audioCache.forEach((audioFile, fileName) => {
      const age = now.getTime() - audioFile.createdAt.getTime();
      if (age > this.MAX_CACHE_AGE) {
        filesToRemove.push(fileName);
      }
    });

    // 移除过期文件
    filesToRemove.forEach(fileName => {
      this.removeAudioFile(fileName);
    });

    // 如果缓存仍然太大，移除最旧的文件
    while (this.getTotalCacheSize() > this.MAX_CACHE_SIZE && this.audioCache.size > 0) {
      const oldestFile = this.findOldestFile();
      if (oldestFile) {
        console.log('[LocalAudioManager] 缓存空间不足，移除最旧文件', {
          fileName: oldestFile,
          totalSize: this.getTotalCacheSize()
        });
        this.removeAudioFile(oldestFile);
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

    this.audioCache.forEach((audioFile, fileName) => {
      if (audioFile.createdAt.getTime() < oldestTime) {
        oldestTime = audioFile.createdAt.getTime();
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
      console.log('[LocalAudioManager] 执行定期清理');
      this.cleanupOldFiles();
    }, 60 * 60 * 1000);
  }
}

// 创建单例实例
export const localAudioManager = new LocalAudioManager();

// 导出类型和实例
export { LocalAudioManager };
export default localAudioManager; 