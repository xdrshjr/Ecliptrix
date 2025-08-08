import { MaterialItem, MaterialType } from '@/types';
import { VideoEditingLogger } from '../utils';
import { SearchOrientation } from '../types';

/**
 * Video Search Service Interface
 * 处理视频搜索相关的API调用和处理
 */
export interface VideoSearchService {
  searchVideos(params: {
    query: string;
    maxVideos: number;
    orientation: SearchOrientation;
  }): Promise<VideoSearchResponse>;
  
  validateSearchQuery(query: string): boolean;
  convertToMaterials(videos: VideoSearchResult[]): MaterialItem[];
}

/**
 * 视频搜索结果接口
 */
export interface VideoSearchResult {
  id: number;
  title: string;
  author: string;
  width: number;
  height: number;
  duration?: number;
  thumbnail?: string;
  video_url?: string;
}

/**
 * 视频搜索响应接口
 */
export interface VideoSearchResponse {
  success: boolean;
  videos?: VideoSearchResult[];
  total_found?: number;
  message?: string;
  error?: string;
}

/**
 * Video Search Service Implementation
 * 实现视频搜索服务的具体逻辑
 */
export class VideoSearchServiceImpl implements VideoSearchService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'VideoSearchService'
    });
  }

  /**
   * 搜索视频
   * @param params - 搜索参数
   * @returns Promise<VideoSearchResponse> - 搜索结果
   */
  async searchVideos(params: {
    query: string;
    maxVideos: number;
    orientation: SearchOrientation;
  }): Promise<VideoSearchResponse> {
    const { query, maxVideos, orientation } = params;

    // 参数验证
    if (!this.validateSearchQuery(query)) {
      const error = 'Search query is invalid or empty';
      this.logger.error('视频搜索参数验证失败', new Error(error), { 
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
      this.logger.error('视频搜索参数验证失败', new Error(error), { 
        maxVideos,
        reason: 'invalid_max_videos'
      });
      return {
        success: false,
        error
      };
    }

    const startTime = performance.now();
    this.logger.apiCall('开始视频搜索', '/api/video-search', {
      query: query.trim(),
      maxVideos,
      orientation,
      queryLength: query.length
    });

    try {
      const response = await fetch('/api/video-search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          max_videos: maxVideos,
          orientation: orientation,
        }),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (parseError) {
          this.logger.error('解析错误响应失败', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('视频搜索请求', '/api/video-search', error, {
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
      const endTime = performance.now();

      // 验证响应格式
      if (typeof data.success !== 'boolean') {
        const error = 'Invalid response format: missing success field';
        this.logger.error('视频搜索响应格式错误', new Error(error), {
          responseData: data,
          expectedFields: ['success', 'videos', 'total_found']
        });

        return {
          success: false,
          error
        };
      }

      this.logger.apiComplete('视频搜索', '/api/video-search', data.success, endTime - startTime, {
        totalFound: data.total_found || 0,
        videosCount: data.videos?.length || 0,
        searchQuery: query.trim(),
        orientation
      });

      if (data.success && data.videos) {
        // 验证视频数据
        const validatedVideos = this.validateVideoResults(data.videos);
        
        this.logger.info('视频搜索成功', {
          totalFound: data.total_found || 0,
          validVideos: validatedVideos.length,
          invalidVideos: (data.videos.length - validatedVideos.length),
          averageResponseTime: (endTime - startTime) / validatedVideos.length
        });

        return {
          success: true,
          videos: validatedVideos,
          total_found: data.total_found,
          message: data.message
        };
      } else {
        this.logger.warn('视频搜索无结果', {
          query: query.trim(),
          message: data.message,
          responseTime: endTime - startTime
        });

        return {
          success: false,
          error: data.message || '搜索失败，请稍后重试',
          total_found: 0
        };
      }

    } catch (error) {
      const endTime = performance.now();
      this.logger.apiError('视频搜索请求', '/api/video-search', error as Error, {
        responseTime: endTime - startTime,
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
      this.logger.warn('搜索查询验证失败', { query, reason: 'not_string_or_empty' });
      return false;
    }

    const trimmedQuery = query.trim();
    
    if (trimmedQuery.length === 0) {
      this.logger.warn('搜索查询验证失败', { query, reason: 'empty_after_trim' });
      return false;
    }

    if (trimmedQuery.length < 2) {
      this.logger.warn('搜索查询验证失败', { query, reason: 'too_short', length: trimmedQuery.length });
      return false;
    }

    if (trimmedQuery.length > 200) {
      this.logger.warn('搜索查询验证失败', { query, reason: 'too_long', length: trimmedQuery.length });
      return false;
    }

    // 检查是否包含有效字符（至少包含字母或数字）
    const hasValidChars = /[a-zA-Z0-9\u4e00-\u9fff]/.test(trimmedQuery);
    if (!hasValidChars) {
      this.logger.warn('搜索查询验证失败', { query, reason: 'no_valid_chars' });
      return false;
    }

    this.logger.debug('搜索查询验证通过', { 
      query: trimmedQuery, 
      length: trimmedQuery.length 
    });
    
    return true;
  }

  /**
   * 验证视频结果数据
   * @param videos - 原始视频数据
   * @returns VideoSearchResult[] - 验证后的视频数据
   */
  private validateVideoResults(videos: any[]): VideoSearchResult[] {
    if (!Array.isArray(videos)) {
      this.logger.warn('视频结果不是数组', { videos });
      return [];
    }

    const validatedVideos: VideoSearchResult[] = [];

    videos.forEach((video, index) => {
      const errors: string[] = [];

      // 必需字段验证
      if (typeof video.id !== 'number') {
        errors.push('missing or invalid id');
      }
      if (!video.title || typeof video.title !== 'string') {
        errors.push('missing or invalid title');
      }
      if (!video.author || typeof video.author !== 'string') {
        errors.push('missing or invalid author');
      }
      if (typeof video.width !== 'number' || video.width <= 0) {
        errors.push('missing or invalid width');
      }
      if (typeof video.height !== 'number' || video.height <= 0) {
        errors.push('missing or invalid height');
      }

      if (errors.length === 0) {
        validatedVideos.push({
          id: video.id,
          title: video.title,
          author: video.author,
          width: video.width,
          height: video.height,
          duration: typeof video.duration === 'number' ? video.duration : undefined,
          thumbnail: typeof video.thumbnail === 'string' ? video.thumbnail : undefined,
          video_url: typeof video.video_url === 'string' ? video.video_url : undefined
        });
      } else {
        this.logger.warn('视频数据验证失败', { 
          index, 
          videoId: video.id, 
          errors 
        });
      }
    });

    this.logger.info('视频结果验证完成', {
      totalVideos: videos.length,
      validVideos: validatedVideos.length,
      invalidVideos: videos.length - validatedVideos.length
    });

    return validatedVideos;
  }

  /**
   * 将搜索结果转换为素材项
   * @param videos - 视频搜索结果
   * @returns MaterialItem[] - 素材项数组
   */
  convertToMaterials(videos: VideoSearchResult[]): MaterialItem[] {
    this.logger.info('开始转换视频为素材项', { videoCount: videos.length });

    const materials: MaterialItem[] = videos
      .filter(video => video.video_url) // 只处理有URL的视频
      .map(video => ({
        id: `pexels-${video.id}`,
        name: video.title,
        type: 'video' as MaterialType,
        format: 'mp4',
        size: 0, // 在线视频暂时无法获取准确大小
        duration: video.duration || 0,
        width: video.width,
        height: video.height,
        thumbnailUrl: video.thumbnail,
        url: video.video_url!, // 已经通过filter确保存在
        createdAt: new Date(),
        tags: ['PEXELS', '在线素材', video.author],
        description: `来自PEXELS的视频素材，作者：${video.author}`
      }));

    this.logger.info('视频转换为素材项完成', {
      originalCount: videos.length,
      convertedCount: materials.length,
      materials: materials.map(m => ({ id: m.id, name: m.name, author: m.tags?.[2] }))
    });

    return materials;
  }
}

/**
 * 创建视频搜索服务实例的工厂函数
 * @param taskId - 任务ID
 * @returns VideoSearchService实例
 */
export const createVideoSearchService = (taskId: string): VideoSearchService => {
  return new VideoSearchServiceImpl(taskId);
}; 