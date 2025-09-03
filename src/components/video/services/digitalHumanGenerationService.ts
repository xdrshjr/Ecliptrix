import { VideoEditingLogger } from '../utils';
import { 
  DigitalHumanGenerationRequest, 
  DigitalHumanGenerationResponse, 
  DigitalHumanGenerationStatus 
} from '../types';

export interface DigitalHumanGenerationService {
  uploadFiles(videoFile: File, audioFile: File): Promise<{video_filename: string, audio_filename: string}>;
  uploadSingleFile(file: File, type: 'video' | 'audio', onProgress?: (progress: number) => void): Promise<string>;
  generateVideo(request: DigitalHumanGenerationRequest): Promise<DigitalHumanGenerationResponse>;
  getGenerationStatus(promptId: string): Promise<DigitalHumanGenerationStatus>;
  downloadVideo(filename: string): string;
}

export class DigitalHumanGenerationServiceImpl implements DigitalHumanGenerationService {
  private logger: VideoEditingLogger;

  constructor(taskId: string) {
    this.logger = new VideoEditingLogger({
      taskId,
      component: 'DigitalHumanGenerationService'
    });
  }

  async uploadFiles(videoFile: File, audioFile: File): Promise<{video_filename: string, audio_filename: string}> {
    this.logger.info('上传数字人生成文件', {
      videoName: videoFile.name,
      videoSize: videoFile.size,
      audioName: audioFile.name,
      audioSize: audioFile.size
    });

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('audio', audioFile);

      const response = await fetch('/api/digital-human-generation/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('文件上传失败', new Error(errorMessage), {
          status: response.status,
          errorData
        });
        
        throw new Error(`Failed to upload files: ${errorMessage}`);
      }

      const result = await response.json();
      
      this.logger.info('文件上传成功', {
        videoFilename: result.video_filename,
        audioFilename: result.audio_filename
      });

      return {
        video_filename: result.video_filename,
        audio_filename: result.audio_filename
      };
    } catch (error) {
      this.logger.error('文件上传异常', error as Error);
      throw error;
    }
  }

  async uploadSingleFile(file: File, type: 'video' | 'audio', onProgress?: (progress: number) => void): Promise<string> {
    this.logger.info(`上传单个${type}文件`, {
      fileName: file.name,
      fileSize: file.size,
      fileType: type
    });

    try {
      const formData = new FormData();
      formData.append(type, file);

      const xhr = new XMLHttpRequest();
      
      return new Promise((resolve, reject) => {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && onProgress) {
            const progress = (event.loaded / event.total) * 100;
            onProgress(progress);
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              const result = JSON.parse(xhr.responseText);
              const filename = type === 'video' ? result.video_filename : result.audio_filename;
              
              this.logger.info(`${type}文件上传成功`, {
                filename,
                originalName: file.name
              });
              
              resolve(filename);
            } catch (parseError) {
              this.logger.error(`解析${type}上传响应失败`, parseError as Error);
              reject(new Error(`Failed to parse ${type} upload response`));
            }
          } else {
            const errorMessage = `HTTP ${xhr.status}: ${xhr.statusText}`;
            this.logger.error(`${type}文件上传失败`, new Error(errorMessage), {
              status: xhr.status,
              statusText: xhr.statusText
            });
            reject(new Error(`Failed to upload ${type}: ${errorMessage}`));
          }
        };

        xhr.onerror = () => {
          const errorMessage = `Network error during ${type} upload`;
          this.logger.error(errorMessage, new Error(errorMessage));
          reject(new Error(errorMessage));
        };

        xhr.open('POST', '/api/digital-human-generation/upload');
        xhr.send(formData);
      });
    } catch (error) {
      this.logger.error(`${type}文件上传异常`, error as Error);
      throw error;
    }
  }

  async generateVideo(request: DigitalHumanGenerationRequest): Promise<DigitalHumanGenerationResponse> {
    this.logger.info('提交数字人生成请求', {
      positivePrompt: request.positive_prompt.substring(0, 100),
      negativePrompt: request.negative_prompt?.substring(0, 50),
      dimensions: `${request.width}x${request.height}`,
      steps: request.steps,
      cfg: request.cfg,
      shift: request.shift,
      referenceVideo: request.reference_video_filename,
      audioFile: request.audio_filename
    });

    try {
      const response = await fetch('/api/digital-human-generation/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('数字人生成请求失败', new Error(errorMessage), {
          status: response.status,
          errorData
        });
        
        throw new Error(`Failed to generate digital human video: ${errorMessage}`);
      }

      const result: DigitalHumanGenerationResponse = await response.json();
      
      this.logger.info('数字人生成请求成功提交', {
        promptId: result.prompt_id,
        status: result.status,
        estimatedTime: result.estimated_time
      });

      return result;
    } catch (error) {
      this.logger.error('数字人生成请求异常', error as Error);
      throw error;
    }
  }

  async getGenerationStatus(promptId: string): Promise<DigitalHumanGenerationStatus> {
    this.logger.debug(`查询数字人生成状态: ${promptId}`);

    try {
      const response = await fetch(`/api/digital-human-generation/status/${promptId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = errorData.message || `HTTP ${response.status}`;
        
        this.logger.error('数字人状态查询失败', new Error(errorMessage), {
          promptId,
          status: response.status,
          errorData
        });
        
        throw new Error(`Failed to get digital human generation status: ${errorMessage}`);
      }

      const result: DigitalHumanGenerationStatus = await response.json();
      
      this.logger.debug('数字人状态查询成功', {
        promptId: result.prompt_id,
        status: result.status,
        progress: result.progress,
        videosCount: result.videos.length
      });

      return result;
    } catch (error) {
      this.logger.error('数字人状态查询异常', error as Error, { promptId });
      throw error;
    }
  }

  downloadVideo(filename: string): string {
    this.logger.info('获取数字人视频下载链接', { filename });
    return `/api/digital-human-generation/download/${filename}`;
  }
}

export const createDigitalHumanGenerationService = (taskId: string): DigitalHumanGenerationService => {
  return new DigitalHumanGenerationServiceImpl(taskId);
}; 