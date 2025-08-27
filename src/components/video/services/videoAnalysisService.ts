/**
 * Video Analysis Service
 * 视频AI解析服务
 */

import { VideoEditingLogger } from '../utils/logger';

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
}

export interface VideoAnalysisService {
  analyzeVideo(params: VideoAnalysisServiceParams): Promise<VideoAnalysisResponse>;
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
   * 分析视频内容
   * @param params - 请求参数
   * @returns Promise<VideoAnalysisResponse> - 解析结果
   */
  async analyzeVideo(params: VideoAnalysisServiceParams): Promise<VideoAnalysisResponse> {
    const { videoUrl, frameInterval = 5, customPrompt, taskId } = params;
    
    // 参数验证
    if (!videoUrl.trim()) {
      const error = new Error('Video URL cannot be empty');
      this.logger.error('视频解析失败', error, { reason: 'empty_video_url' });
      throw error;
    }

    const startTime = performance.now();
    this.logger.apiCall('发送视频解析请求', '/api/video/analyze', {
      videoUrl,
      frameInterval,
      hasCustomPrompt: !!customPrompt,
      taskId
    });

    try {
      const requestBody: VideoAnalysisRequest = {
        video_url: videoUrl,
        frame_interval: frameInterval,
        custom_prompt: customPrompt
      };

      const response = await fetch('/api/video/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch (parseError) {
          this.logger.error('解析错误响应失败', parseError as Error, {
            status: response.status,
            statusText: response.statusText
          });
        }

        const error = new Error(errorMessage);
        this.logger.apiError('视频解析请求', '/api/video/analyze', error, {
          responseTime: performance.now() - startTime,
          status: response.status,
          statusText: response.statusText,
          videoUrl
        });
        throw error;
      }

      const data: VideoAnalysisResponse = await response.json();
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
        videoUrl
      });

      return data;

    } catch (error) {
      const responseTime = performance.now() - startTime;
      this.logger.error('视频解析请求失败', error as Error, {
        responseTime,
        videoUrl,
        frameInterval,
        hasCustomPrompt: !!customPrompt
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