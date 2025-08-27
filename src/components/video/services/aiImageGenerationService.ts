/**
 * AI Image Generation Service
 * 处理AI图片生成相关的API调用
 */

import { VideoEditingLogger } from '../utils';
import { 
  AIImageGenerationRequest, 
  AIImageGenerationResponse, 
  AIImageGenerationStatus 
} from '../types';

export interface AIImageGenerationService {
  generateImage(request: AIImageGenerationRequest): Promise<AIImageGenerationResponse>;
  getGenerationStatus(promptId: string): Promise<AIImageGenerationStatus>;
  downloadImage(filename: string): Promise<string>;
  downloadImageByPromptId(promptId: string): Promise<string>;
}

export class AIImageGenerationServiceImpl implements AIImageGenerationService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'AIImageGenerationService'
    });
  }

  async generateImage(request: AIImageGenerationRequest): Promise<AIImageGenerationResponse> {
    this.logger.info('提交AI图片生成请求', {
      positivePrompt: request.positive_prompt.substring(0, 100),
      negativePrompt: request.negative_prompt?.substring(0, 50),
      dimensions: `${request.width}x${request.height}`,
      steps: request.steps,
      cfg: request.cfg,
      guidance: request.guidance,
      checkpoint: request.checkpoint
    });

    try {
      const response = await fetch('/api/ai-image-generation/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('AI图片生成请求失败', new Error(errorMessage), {
          status: response.status,
          errorData
        });
        
        throw new Error(`Failed to generate image: ${errorMessage}`);
      }

      const result: AIImageGenerationResponse = await response.json();
      
      this.logger.info('AI图片生成请求成功提交', {
        promptId: result.prompt_id,
        status: result.status,
        estimatedTime: result.estimated_time
      });

      return result;
    } catch (error) {
      this.logger.error('AI图片生成请求异常', error as Error);
      throw error;
    }
  }

  async getGenerationStatus(promptId: string): Promise<AIImageGenerationStatus> {
    try {
      const response = await fetch(`/api/ai-image-generation/status/${promptId}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('获取生成状态失败', new Error(errorMessage), {
          promptId,
          status: response.status
        });
        
        throw new Error(`Failed to get generation status: ${errorMessage}`);
      }

      const result: AIImageGenerationStatus = await response.json();
      
      this.logger.debug('获取生成状态', {
        promptId,
        status: result.status,
        progress: result.progress,
        imagesCount: result.images?.length || 0
      });

      return result;
    } catch (error) {
      this.logger.error('获取生成状态异常', error as Error, { promptId });
      throw error;
    }
  }

  async downloadImage(filename: string): Promise<string> {
    this.logger.info('下载生成的图片', { filename });

    try {
      const response = await fetch(`/api/ai-image-generation/download/${filename}`);

      if (!response.ok) {
        const errorMessage = `Failed to download image: HTTP ${response.status}`;
        this.logger.error('图片下载失败', new Error(errorMessage), {
          filename,
          status: response.status
        });
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      this.logger.info('图片下载成功', {
        filename,
        blobSize: blob.size,
        blobType: blob.type
      });

      return url;
    } catch (error) {
      this.logger.error('图片下载异常', error as Error, { filename });
      throw error;
    }
  }

  async downloadImageByPromptId(promptId: string): Promise<string> {
    this.logger.info('通过prompt_id下载生成的图片', { promptId });

    try {
      const response = await fetch(`/api/ai-image-generation/download/${promptId}`);

      if (!response.ok) {
        const errorMessage = `Failed to download image: HTTP ${response.status}`;
        this.logger.error('图片下载失败', new Error(errorMessage), {
          promptId,
          status: response.status
        });
        throw new Error(errorMessage);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      this.logger.info('图片下载成功', {
        promptId,
        blobSize: blob.size,
        blobType: blob.type
      });

      return url;
    } catch (error) {
      this.logger.error('图片下载异常', error as Error, { promptId });
      throw error;
    }
  }
}

export const createAIImageGenerationService = (taskId: string): AIImageGenerationService => {
  return new AIImageGenerationServiceImpl(taskId);
}; 