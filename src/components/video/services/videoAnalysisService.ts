/**
 * Video Analysis Service
 * 视频AI解析服务
 */

import { VideoEditingLogger } from '../utils/logger';
import { http, ApiError } from '@/lib/api/http-client';

// 类型定义
export interface FrameAnalysis {
  frame_number: number;
  timestamp: number;
  analysis: string;
  frame_path?: string;
}

export interface VideoAnalysisRequest {
  video_url: string;
  frame_interval?: number;
  custom_prompt?: string;
  thumbnail_url?: string;
  use_thumbnail?: boolean;
}

export interface VideoAnalysisResponse {
  success: boolean;
  video_url: string;
  total_frames_extracted: number;
  video_duration: number;
  frame_analyses: FrameAnalysis[];
  processing_time: number;
  timestamp: string;
  message?: string;
}

export interface VideoAnalysisServiceParams {
  videoUrl: string;
  frameInterval?: number;
  customPrompt?: string;
  taskId: string;
  thumbnailUrl?: string;
  useThumbnail?: boolean;
}

export interface QueueInfo {
  queue_name: string;
  max_concurrent: number;
  current_processing: number;
  queued_count: number;
  total_processed: number;
  average_processing_time: number | null;
}

export interface QueueStatusResponse {
  success: boolean;
  queue_info: QueueInfo;
  tasks: any[] | null;
}

export interface VideoAnalysisService {
  analyzeVideo(params: VideoAnalysisServiceParams): Promise<VideoAnalysisResponse>;
  getQueueStatus(): Promise<QueueStatusResponse>;
}

/**
 * Video Analysis Service Implementation
 * 实现视频AI解析服务的具体逻辑
 */
export class VideoAnalysisServiceImpl implements VideoAnalysisService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'VideoAnalysisService'
    });
  }

  /**
   * 检查URL是否为blob URL
   * @param url - 要检查的URL
   * @returns 是否为blob URL
   */
  private isBlobUrl(url: string): boolean {
    return url.startsWith('blob:');
  }

  /**
   * 将blob URL转换为File对象
   * @param blobUrl - blob URL
   * @param fileName - 文件名（可选）
   * @param fileType - 文件类型（可选）
   * @returns Promise<File> - File对象
   */
  private async blobUrlToFile(blobUrl: string, fileName?: string, fileType?: string): Promise<File> {
    this.logger.info('开始转换blob URL为File对象', { blobUrl, fileName, fileType });
    
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch blob: ${response.status}`);
      }
      
      const blob = await response.blob();
      
      // 从blob URL或使用默认文件名
      const timestamp = Date.now();
      const defaultFileName = fileType?.startsWith('image/') 
        ? `thumbnail_${timestamp}.jpg` 
        : `video_${timestamp}.mp4`;
      const finalFileName = fileName || defaultFileName;
      const finalFileType = fileType || blob.type || 'video/mp4';
      
      // 创建File对象
      const file = new File([blob], finalFileName, { type: finalFileType });
      
      this.logger.info('blob URL转换为File对象成功', {
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type
      });
      
      return file;
    } catch (error) {
      this.logger.error('blob URL转换为File对象失败', error as Error, { blobUrl });
      throw error;
    }
  }

  /**
   * 分析视频内容
   * @param params - 请求参数
   * @returns Promise<VideoAnalysisResponse> - 解析结果
   */
  async analyzeVideo(params: VideoAnalysisServiceParams): Promise<VideoAnalysisResponse> {
    const { videoUrl, frameInterval = 5, customPrompt, taskId, thumbnailUrl, useThumbnail = false } = params;
    
    // 参数验证
    if (!videoUrl.trim()) {
      const error = new Error('Video URL cannot be empty');
      this.logger.error('视频解析失败', error, { reason: 'empty_video_url' });
      throw error;
    }

    const startTime = performance.now();
    const isBlobUrl = this.isBlobUrl(videoUrl);
    
    this.logger.apiCall('发送视频解析请求', '/api/video/analyze', {
      videoUrl,
      isBlobUrl,
      frameInterval,
      hasCustomPrompt: !!customPrompt,
      taskId,
      useThumbnail,
      hasThumbnailUrl: !!thumbnailUrl
    });

    try {
      let data: VideoAnalysisResponse;

      try {
        // 如果是blob URL，需要上传文件
        if (isBlobUrl) {
          this.logger.info('检测到blob URL，转换为文件上传', { videoUrl, useThumbnail });

          // 将blob URL转换为File对象
          const file = await this.blobUrlToFile(videoUrl);

          // 创建FormData
          const formData = new FormData();
          formData.append('video', file);
          formData.append('frame_interval', frameInterval.toString());
          if (customPrompt) {
            formData.append('custom_prompt', customPrompt);
          }

          // 添加缩略图相关参数
          if (useThumbnail && thumbnailUrl) {
            formData.append('use_thumbnail', 'true');

            // 如果缩略图也是blob URL，需要转换并上传
            if (this.isBlobUrl(thumbnailUrl)) {
              this.logger.info('缩略图是blob URL，转换为文件上传', { thumbnailUrl });
              const thumbnailFile = await this.blobUrlToFile(thumbnailUrl, undefined, 'image/jpeg');
              formData.append('thumbnail', thumbnailFile);
              formData.append('thumbnail_url', ''); // 留空，使用上传的文件
            } else {
              // 如果是普通URL，直接传递
              formData.append('thumbnail_url', thumbnailUrl);
            }
          } else {
            formData.append('use_thumbnail', 'false');
          }

          this.logger.info('上传视频文件进行解析', {
            fileName: file.name,
            fileSize: file.size,
            frameInterval,
            hasCustomPrompt: !!customPrompt,
            useThumbnail,
            hasThumbnailUrl: !!thumbnailUrl
          });

          // 发送multipart/form-data请求
          data = await http.upload<VideoAnalysisResponse>('/api/video/analyze', formData, {
            timeoutMs: 600_000,
          });
        } else {
          // 如果是普通URL，使用JSON请求
          this.logger.info('使用URL方式进行视频解析', { videoUrl, useThumbnail });

          const requestBody: VideoAnalysisRequest = {
            video_url: videoUrl,
            frame_interval: frameInterval,
            custom_prompt: customPrompt,
            thumbnail_url: thumbnailUrl,
            use_thumbnail: useThumbnail
          };

          data = await http.post<VideoAnalysisResponse>('/api/video/analyze', requestBody, {
            timeoutMs: 600_000,
          });
        }
      } catch (httpError) {
        const errorMessage = httpError instanceof ApiError
          ? (httpError.message || `HTTP error! status: ${httpError.status}`)
          : (httpError instanceof Error ? httpError.message : String(httpError));
        const error = new Error(errorMessage);
        this.logger.apiError('视频解析请求', '/api/video/analyze', error, {
          responseTime: performance.now() - startTime,
          status: httpError instanceof ApiError ? httpError.status : undefined,
          videoUrl,
          isBlobUrl
        });
        throw error;
      }

      const responseTime = performance.now() - startTime;

      // 验证响应格式
      if (typeof data.success !== 'boolean') {
        const error = 'Invalid response format: missing success field';
        this.logger.error('视频解析响应格式错误', new Error(error), {
          responseData: data,
          expectedFields: ['success', 'video_url', 'frame_analyses']
        });
        throw new Error(error);
      }

      this.logger.info('视频解析API响应成功', {
        success: data.success,
        framesExtracted: data.total_frames_extracted,
        videoDuration: data.video_duration,
        processingTime: data.processing_time,
        responseTime,
        videoUrl,
        isBlobUrl
      });

      return data;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error('视频解析请求失败', error as Error, {
        responseTime,
        videoUrl,
        isBlobUrl,
        frameInterval,
        hasCustomPrompt: !!customPrompt
      });
      throw error;
    }
  }

  /**
   * 查询视频解析队列状态
   * @returns Promise<QueueStatusResponse> - 队列状态信息
   */
  async getQueueStatus(): Promise<QueueStatusResponse> {
    const startTime = performance.now();
    
    this.logger.apiCall('查询解析队列状态', '/api/video/analysis-queue-status', {});

    try {
      let data: QueueStatusResponse;
      try {
        data = await http.get<QueueStatusResponse>('/api/video/analysis-queue-status');
      } catch (httpError) {
        const errorMessage = httpError instanceof ApiError
          ? (httpError.message || `HTTP error! status: ${httpError.status}`)
          : (httpError instanceof Error ? httpError.message : String(httpError));
        const error = new Error(errorMessage);
        this.logger.apiError('查询解析队列状态', '/api/video/analysis-queue-status', error, {
          responseTime: performance.now() - startTime,
          status: httpError instanceof ApiError ? httpError.status : undefined
        });
        throw error;
      }
      const responseTime = performance.now() - startTime;

      this.logger.info('查询解析队列状态成功', {
        queueName: data.queue_info.queue_name,
        maxConcurrent: data.queue_info.max_concurrent,
        currentProcessing: data.queue_info.current_processing,
        queuedCount: data.queue_info.queued_count,
        totalProcessed: data.queue_info.total_processed,
        averageProcessingTime: data.queue_info.average_processing_time,
        responseTime
      });

      return data;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      
      this.logger.apiError('查询解析队列状态', '/api/video/analysis-queue-status', error as Error, {
        responseTime
      });

      throw error;
    }
  }
}

/**
 * 创建视频解析服务实例
 * @param taskId - 任务ID
 * @returns VideoAnalysisService实例
 */
export const createVideoAnalysisService = (taskId: string): VideoAnalysisService => {
  return new VideoAnalysisServiceImpl(taskId);
}; 