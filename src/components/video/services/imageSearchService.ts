import { ImageSearchResponse, ImageSearchResult, ImageOrientation, ImageColor, ImageOrderBy } from '../types';
import { VideoEditingLogger } from '../utils';
import { http, ApiError } from '@/lib/api/http-client';

export interface ImageSearchService {
  searchImages: (
    query: string,
    maxImages?: number,
    orientation?: ImageOrientation,
    color?: ImageColor,
    orderBy?: ImageOrderBy
  ) => Promise<ImageSearchResponse>;
}

export class ImageSearchServiceImpl implements ImageSearchService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'ImageSearchService'
    });
  }

  async searchImages(
    query: string,
    maxImages: number = 60,
    orientation: ImageOrientation = 'all',
    color: ImageColor = 'all',
    orderBy: ImageOrderBy = 'relevant'
  ): Promise<ImageSearchResponse> {
    this.logger.info('开始图片搜索', {
      query,
      maxImages,
      orientation,
      color,
      orderBy,
      timestamp: new Date().toISOString()
    });

    try {
      // 验证参数
      if (!query || query.trim().length === 0) {
        const errorMessage = '搜索关键词不能为空';
        this.logger.warn(errorMessage);
        return {
          success: false,
          message: errorMessage,
          images: [],
          total_found: 0,
          query: query
        };
      }

      if (maxImages < 1 || maxImages > 60) {
        const errorMessage = '图片数量必须在1-60之间';
        this.logger.warn(errorMessage);
        return {
          success: false,
          message: errorMessage,
          images: [],
          total_found: 0,
          query: query
        };
      }

      // 调用API
      let data: ImageSearchResponse;
      try {
        data = await http.post<ImageSearchResponse>('/api/image-search', {
          query: query.trim(),
          max_images: maxImages,
          orientation,
          color,
          order_by: orderBy
        });
      } catch (httpError) {
        const errorMessage = httpError instanceof ApiError
          ? `API请求失败: ${httpError.status} ${httpError.message}`
          : `图片搜索异常: ${httpError instanceof Error ? httpError.message : String(httpError)}`;
        const errorObj = httpError instanceof Error ? httpError : new Error(String(httpError));
        this.logger.error(errorMessage, errorObj, {
          status: httpError instanceof ApiError ? httpError.status : undefined
        });

        return {
          success: false,
          message: errorMessage,
          images: [],
          total_found: 0,
          query: query
        };
      }

      this.logger.info('API响应已接收', {
        success: data.success
      });

      // 验证响应数据
      if (!data || typeof data.success !== 'boolean') {
        const errorMessage = 'API返回数据格式错误';
        const error = new Error(errorMessage);
        this.logger.error(errorMessage, error, { data });
        return {
          success: false,
          message: errorMessage,
          images: [],
          total_found: 0,
          query: query
        };
      }

      this.logger.info('图片搜索完成', {
        success: data.success,
        imageCount: data.images?.length || 0,
        totalFound: data.total_found,
        message: data.message,
        query: data.query
      });

      // 记录图片详细信息（仅前3个）
      if (data.images && data.images.length > 0) {
        const sampleImages = data.images.slice(0, 3);
        this.logger.debug('搜索结果示例', {
          sampleCount: sampleImages.length,
          totalCount: data.images.length,
          samples: sampleImages.map(img => ({
            id: img.id,
            description: img.description || img.alt_description,
            dimensions: `${img.width}x${img.height}`,
            likes: img.likes,
            user: img.user_username
          }))
        });
      }

      return data;

    } catch (error) {
      const errorMessage = `图片搜索异常: ${error instanceof Error ? error.message : String(error)}`;
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.logger.error(errorMessage, errorObj, {
        query,
        maxImages,
        orientation,
        color,
        orderBy
      });

      return {
        success: false,
        message: errorMessage,
        images: [],
        total_found: 0,
        query: query
      };
    }
  }
}

export const createImageSearchService = (taskId: string): ImageSearchService => {
  return new ImageSearchServiceImpl(taskId);
}; 