/**
 * AI Video Generation Service
 * 处理AI视频生成相关的API调用
 */

import { VideoEditingLogger } from '../utils';
import { 
  AIVideoGenerationRequest, 
  AIVideoGenerationResponse, 
  AIVideoGenerationStatus 
} from '../types';

export interface AIVideoGenerationService {
  generateVideo(request: AIVideoGenerationRequest): Promise<AIVideoGenerationResponse>;
  getGenerationStatus(promptId: string): Promise<AIVideoGenerationStatus>;
  downloadVideo(promptId: string): Promise<string>;
}

export class AIVideoGenerationServiceImpl implements AIVideoGenerationService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'AIVideoGenerationService'
    });
  }

  async generateVideo(request: AIVideoGenerationRequest): Promise<AIVideoGenerationResponse> {
    this.logger.info('提交AI视频生成请求', {
      positivePrompt: request.positive_prompt.substring(0, 100),
      negativePrompt: request.negative_prompt?.substring(0, 50),
      dimensions: `${request.width}x${request.height}`,
      duration: request.duration_seconds,
      steps: request.steps,
      aspectRatio: request.aspect_ratio,
      enableLora: request.enable_lora
    });

    try {
      const response = await fetch('/api/ai-video-generation/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('AI视频生成请求失败', new Error(errorMessage), {
          status: response.status,
          errorData
        });
        
        throw new Error(`Failed to generate video: ${errorMessage}`);
      }

      const result: AIVideoGenerationResponse = await response.json();
      
      this.logger.info('AI视频生成请求成功提交', {
        promptId: result.prompt_id,
        status: result.status,
        estimatedTime: result.estimated_time
      });

      return result;
    } catch (error) {
      this.logger.error('AI视频生成请求异常', error as Error);
      throw error;
    }
  }

  async getGenerationStatus(promptId: string): Promise<AIVideoGenerationStatus> {
    try {
      const response = await fetch(`/api/ai-video-generation/status/${promptId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('获取生成状态失败', new Error(errorMessage), {
          promptId,
          status: response.status
        });
        
        throw new Error(`Failed to get generation status: ${errorMessage}`);
      }

      const result: AIVideoGenerationStatus = await response.json();
      
      this.logger.debug('获取生成状态', {
        promptId,
        status: result.status,
        progress: result.progress,
        videosCount: result.videos?.length || 0
      });

      return result;
    } catch (error) {
      this.logger.error('获取生成状态异常', error as Error, { promptId });
      throw error;
    }
  }

  async downloadVideo(promptId: string): Promise<string> {
    this.logger.info('下载生成的视频', { promptId });

    try {
      const response = await fetch(`/api/ai-video-generation/download/${promptId}`);

      if (!response.ok) {
        const errorMessage = `Failed to download video: HTTP ${response.status}`;
        this.logger.error('视频下载失败', new Error(errorMessage), {
          promptId,
          status: response.status
        });
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      this.logger.info('视频下载成功', {
        promptId,
        blobSize: blob.size,
        blobType: blob.type
      });

      return url;
    } catch (error) {
      this.logger.error('视频下载异常', error as Error, { promptId });
      throw error;
    }
  }
}

export const createAIVideoGenerationService = (taskId: string): AIVideoGenerationService => {
  return new AIVideoGenerationServiceImpl(taskId);
};