import { MaterialItem, MaterialType } from '@/types';
import { VideoEditingLogger } from '../utils';
import { SearchOrientation, YoutubeVideoSearchResult, YoutubeVideoSearchResponse } from '../types';

/**
 * Youtube Video Search Service Interface
 * 处理Youtube视频搜索相关的API调用和处理
 */
export interface YoutubeVideoSearchService {
  searchVideos(params: {
    query: string;
    maxVideos: number;
    orientation: SearchOrientation;
    minDuration?: number;
    maxDuration?: number;
  }): Promise<YoutubeVideoSearchResponse>;
  
  validateSearchQuery(query: string): boolean;
  convertToMaterials(videos: YoutubeVideoSearchResult[]): MaterialItem[];
}

/**
 * Mock Youtube Video Data
 * 用于前端开发的模拟数据
 */
const MOCK_YOUTUBE_VIDEOS: YoutubeVideoSearchResult[] = [
  {
    id: 'dQw4w9WgXcQ',
    title: '【4K】美丽自然风景 - 放松音乐背景视频',
    channelTitle: 'Nature Relaxation',
    description: '享受这个美丽的4K自然风景视频，配有放松的背景音乐。非常适合冥想、学习或工作时播放。',
    thumbnailUrl: 'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    duration: 3600, // 1小时
    publishedAt: '2023-12-01T10:00:00Z',
    viewCount: 1250000,
    likeCount: 45000,
    width: 3840,
    height: 2160
  },
  {
    id: 'jNQXAC9IVRw',
    title: '城市夜景延时摄影 - 现代都市生活',
    channelTitle: 'Urban Cinematics',
    description: '令人惊叹的城市夜景延时摄影，展现现代都市的繁华与活力。高质量4K画面，适合商业和创意项目使用。',
    thumbnailUrl: 'https://img.youtube.com/vi/jNQXAC9IVRw/maxresdefault.jpg',
    videoUrl: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    duration: 1800, // 30分钟
    publishedAt: '2023-11-15T14:30:00Z',
    viewCount: 890000,
    likeCount: 32000,
    width: 3840,
    height: 2160
  }
];

/**
 * Youtube Video Search Service Implementation (Mock)
 * 实现Youtube视频搜索服务的具体逻辑（使用Mock数据）
 */
export class YoutubeVideoSearchServiceImpl implements YoutubeVideoSearchService {
  private logger: VideoEditingLogger;
  private taskId: string;

  constructor(taskId: string) {
    this.taskId = taskId;
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'YoutubeVideoSearchService'
    });
  }

  /**
   * 搜索Youtube视频
   * @param params - 搜索参数
   * @returns Promise<YoutubeVideoSearchResponse> - 搜索结果
   */
  async searchVideos(params: {
    query: string;
    maxVideos: number;
    orientation: SearchOrientation;
    minDuration?: number;
    maxDuration?: number;
  }): Promise<YoutubeVideoSearchResponse> {
    const { query, maxVideos, orientation, minDuration, maxDuration } = params;

    // 参数验证
    if (!this.validateSearchQuery(query)) {
      const error = 'Search query is invalid or empty';
      this.logger.error('Youtube视频搜索参数验证失败', new Error(error), { 
        query,
        queryLength: query.length,
        reason: 'invalid_query'
      });
      return {
        success: false,
        error
      };
    }

    if (maxVideos <= 0 || maxVideos > 100) {
      const error = 'Max videos must be between 1 and 100';
      this.logger.error('Youtube视频搜索参数验证失败', new Error(error), { 
        maxVideos,
        reason: 'invalid_max_videos'
      });
      return {
        success: false,
        error
      };
    }

    // 验证时间范围参数
    if (minDuration !== undefined && maxDuration !== undefined) {
      if (minDuration < 0 || maxDuration < 0) {
        const error = 'Duration values must be non-negative';
        this.logger.error('Youtube视频搜索时间参数验证失败', new Error(error), { 
          minDuration,
          maxDuration,
          reason: 'negative_duration'
        });
        return {
          success: false,
          error
        };
      }

      if (minDuration >= maxDuration) {
        const error = 'Min duration must be less than max duration';
        this.logger.error('Youtube视频搜索时间参数验证失败', new Error(error), { 
          minDuration,
          maxDuration,
          reason: 'invalid_duration_range'
        });
        return {
          success: false,
          error
        };
      }
    }

    const startTime = performance.now();
    
    this.logger.apiCall('开始Youtube视频搜索流程', '/api/youtube/search', {
      query: query.trim(),
      maxVideos,
      orientation,
      queryLength: query.length,
      minDuration,
      maxDuration,
      hasDurationFilter: minDuration !== undefined || maxDuration !== undefined
    });

    try {
      // 调用YouTube搜索API
      const response = await fetch('/api/youtube/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          max_videos: maxVideos,
          orientation: orientation,
          ...(minDuration !== undefined && { min_duration: minDuration }),
          ...(maxDuration !== undefined && { max_duration: maxDuration }),
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (parseError) {
          this.logger.error('解析YouTube搜索错误响应失败', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('Youtube视频搜索请求', '/api/youtube/search', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText,
          query: query.trim()
        });

        return {
          success: false,
          error: errorMessage
        };
      }

      const data = await response.json();
      const searchTime = performance.now() - startTime;

      // 验证响应格式
      if (typeof data.success !== 'boolean') {
        const error = 'Invalid response format: missing success field';
        this.logger.error('Youtube视频搜索响应格式错误', new Error(error), {
          responseData: data,
          expectedFields: ['success', 'videos', 'total_found']
        });

        return {
          success: false,
          error
        };
      }

      if (!data.success) {
        this.logger.warn('Youtube视频搜索失败', {
          error: data.error,
          message: data.message,
          query: query.trim()
        });

        return {
          success: false,
          error: data.error || data.message || 'YouTube search failed'
        };
      }

      // 转换后端响应为前端格式
      const videos = (data.videos || []).map((video: any) => ({
        id: video.id || '',
        title: video.title || 'Unknown',
        channelTitle: video.uploader || 'Unknown',
        description: video.description || '',
        thumbnailUrl: video.thumbnail_url || '',
        videoUrl: video.url || '',
        duration: video.duration || 0,
        viewCount: video.view_count || 0,
        uploadDate: video.upload_date || 'Unknown',
        width: video.width || 1920,
        height: video.height || 1080
      }));

      this.logger.apiComplete('Youtube视频搜索', '/api/youtube/search', true, searchTime, {
        totalFound: data.total_found,
        videosCount: videos.length,
        query: query.trim(),
        orientation
      });

      this.logger.info('Youtube视频搜索成功', {
        totalFound: data.total_found,
        validVideos: videos.length,
        searchTime,
        query: query.trim()
      });

      return {
        success: true,
        videos,
        total_found: data.total_found,
        message: data.message || `找到 ${videos.length} 个Youtube视频`
      };

    } catch (error) {
      const errorTime = performance.now();
      this.logger.apiError('Youtube视频搜索请求', '/api/youtube/search', error as Error, {
        responseTime: errorTime - startTime,
        query: query.trim(),
        maxVideos,
        orientation
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 验证搜索查询
   * @param query - 搜索查询字符串
   * @returns boolean - 是否有效
   */
  validateSearchQuery(query: string): boolean {
    if (!query || typeof query !== 'string') {
      this.logger.warn('Youtube搜索查询验证失败', { query, reason: 'not_string_or_empty' });
      return false;
    }

    const trimmedQuery = query.trim();
    
    if (trimmedQuery.length === 0) {
      this.logger.warn('Youtube搜索查询验证失败', { query, reason: 'empty_after_trim' });
      return false;
    }

    if (trimmedQuery.length < 2) {
      this.logger.warn('Youtube搜索查询验证失败', { query, reason: 'too_short', length: trimmedQuery.length });
      return false;
    }

    if (trimmedQuery.length > 200) {
      this.logger.warn('Youtube搜索查询验证失败', { query, reason: 'too_long', length: trimmedQuery.length });
      return false;
    }

    // 检查是否包含有效字符（至少包含字母或数字）
    const hasValidChars = /[a-zA-Z0-9\u4e00-\u9fff]/.test(trimmedQuery);
    if (!hasValidChars) {
      this.logger.warn('Youtube搜索查询验证失败', { query, reason: 'no_valid_chars' });
      return false;
    }

    this.logger.debug('Youtube搜索查询验证通过', { 
      query: trimmedQuery, 
      length: trimmedQuery.length 
    });
    
    return true;
  }

  /**
   * 将Youtube搜索结果转换为素材项
   * @param videos - Youtube视频搜索结果
   * @returns MaterialItem[] - 素材项数组
   */
  convertToMaterials(videos: YoutubeVideoSearchResult[]): MaterialItem[] {
    this.logger.info('开始转换Youtube视频为素材项', { 
      videoCount: videos.length,
      videosDetail: videos.map(v => ({
        id: v.id,
        title: v.title,
        channelTitle: v.channelTitle,
        hasVideoUrl: !!v.videoUrl
      }))
    });

    const materials: MaterialItem[] = videos.map(video => {
      const material = {
        id: `youtube-${video.id}`,
        name: video.title,
        type: 'video' as MaterialType,
        format: 'mp4',
        size: 0, // Youtube视频暂时无法获取准确大小
        duration: video.duration,
        width: video.width,
        height: video.height,
        thumbnailUrl: video.thumbnailUrl,
        url: video.videoUrl,
        createdAt: new Date(),
        tags: ['YOUTUBE', '在线素材', video.channelTitle],
        description: `来自Youtube的视频素材，频道：${video.channelTitle}，观看次数：${video.viewCount.toLocaleString()}`,
        metadata: {
          source: 'youtube',
          youtubeId: video.id,
          originalUrl: video.videoUrl,
          channelTitle: video.channelTitle,
          viewCount: video.viewCount,
          publishedAt: video.publishedAt
        }
      };

      this.logger.debug('单个Youtube视频转换完成', {
        originalVideo: {
          id: video.id,
          title: video.title,
          channelTitle: video.channelTitle,
          videoUrl: video.videoUrl
        },
        convertedMaterial: {
          id: material.id,
          name: material.name,
          url: material.url
        }
      });

      return material;
    });

    this.logger.info('Youtube视频转换为素材项完成', {
      originalCount: videos.length,
      convertedCount: materials.length,
      materials: materials.map(m => ({ 
        id: m.id, 
        name: m.name, 
        channelTitle: m.tags?.[2],
        hasUrl: !!m.url 
      }))
    });

    return materials;
  }
}

/**
 * 创建Youtube视频搜索服务实例的工厂函数
 * @param taskId - 任务ID
 * @returns YoutubeVideoSearchService实例
 */
export const createYoutubeVideoSearchService = (taskId: string): YoutubeVideoSearchService => {
  return new YoutubeVideoSearchServiceImpl(taskId);
}; 