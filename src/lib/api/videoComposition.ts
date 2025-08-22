/**
 * Video Composition API client
 */

export interface VideoCompositionItem {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  volume?: number;
  opacity?: number;
}

export interface AudioCompositionItem {
  id: string;
  name: string;
  url: string;
  start_time: number;
  duration: number;
  track_id: string;
  volume?: number;
}

export interface SubtitleCompositionItem {
  id: string;
  name: string;
  text: string;
  start_time: number;
  duration: number;
  track_id: string;
  font_family?: string;
  font_size?: number;
  font_color?: string;
  background_color?: string;
  position?: string;
}

export interface VideoCompositionRequest {
  task_id: string;
  aspect_ratio?: string; // Add aspect ratio support (e.g., "16:9", "9:16", "4:3", "1:1", "21:9")
  video_items: VideoCompositionItem[];
  audio_items?: AudioCompositionItem[];
  subtitle_items?: SubtitleCompositionItem[];
  total_duration: number;
  output_resolution?: {
    width: number;
    height: number;
  };
  output_fps?: number;
  output_format?: string;
}

export interface VideoCompositionResponse {
  success: boolean;
  message: string;
  composition_id?: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  output_file_path?: string;
  output_file_size?: number;
  processing_time?: number;
  error_details?: any;
}

export interface CompositionStatusResponse {
  composition_id: string;
  task_id: string;
  status: 'processing' | 'completed' | 'failed';
  progress: number;
  start_time: number;
  processing_time?: number;
  output_file_size?: number;
  error_details?: any;
}

/**
 * Video Composition API Client Class
 */
export class VideoCompositionAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    // Use Next.js API routes instead of direct backend calls
    this.baseUrl = baseUrl || '';
  }

  /**
   * Compose a video from timeline data
   */
  async composeVideo(request: VideoCompositionRequest): Promise<VideoCompositionResponse> {
    const url = `/api/video-compose`;
    
    console.log('[VideoCompositionAPI] Sending composition request to Next.js API', {
      taskId: request.task_id,
      videoItemsCount: request.video_items.length,
      audioItemsCount: request.audio_items?.length || 0,
      subtitleItemsCount: request.subtitle_items?.length || 0,
      totalDuration: request.total_duration,
      timeout: '10 minutes'
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        // 设置10分钟超时，适应视频合成的长处理时间
        signal: AbortSignal.timeout(600000) // 600秒（10分钟）超时
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: VideoCompositionResponse = await response.json();
      
      console.log('[VideoCompositionAPI] Composition response received from Next.js API', {
        success: result.success,
        status: result.status,
        compositionId: result.composition_id,
        progress: result.progress
      });

      return result;
    } catch (error: any) {
      // 检查是否是超时错误并记录详细信息
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        console.error('[VideoCompositionAPI] Composition request timeout after 10 minutes', {
          taskId: request.task_id,
          videoItemsCount: request.video_items.length,
          totalDuration: request.total_duration,
          error: error.message
        });
      } else {
        console.error('[VideoCompositionAPI] Composition request failed', error);
      }
      throw error;
    }
  }

  /**
   * Get the status of a video composition
   */
  async getCompositionStatus(compositionId: string): Promise<CompositionStatusResponse> {
    const url = `/api/video-compose/${compositionId}/status`;
    
    console.log('[VideoCompositionAPI] Requesting composition status via Next.js API', {
      compositionId
    });

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // 设置较短超时，状态查询应该快速响应
        signal: AbortSignal.timeout(30000) // 30秒超时
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result: CompositionStatusResponse = await response.json();
      
      console.log('[VideoCompositionAPI] Status response received from Next.js API', {
        compositionId: result.composition_id,
        status: result.status,
        progress: result.progress
      });

      return result;
    } catch (error) {
      console.error('[VideoCompositionAPI] Status request failed', error);
      throw error;
    }
  }

  /**
   * Download a composed video
   */
  async downloadVideo(compositionId: string, taskId?: string): Promise<Blob> {
    const url = `/api/video-compose/${compositionId}/download${taskId ? `?task_id=${taskId}` : ''}`;
    
    console.log('[VideoCompositionAPI] Downloading video via Next.js API', {
      compositionId,
      taskId
    });

    try {
      const response = await fetch(url, {
        method: 'GET',
        // 设置10分钟超时，适应大视频文件下载
        signal: AbortSignal.timeout(600000) // 600秒（10分钟）超时
      });

      console.log('[VideoCompositionAPI] Download response received', {
        compositionId,
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: response.headers.get('content-length'),
        headers: Object.fromEntries(response.headers.entries())
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[VideoCompositionAPI] Download response error', {
          status: response.status,
          statusText: response.statusText,
          errorText
        });
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      // 检查响应是否有body
      if (!response.body) {
        throw new Error('Response body is empty');
      }

      console.log('[VideoCompositionAPI] Starting blob conversion...');
      
      try {
        const blob = await response.blob();
        
        console.log('[VideoCompositionAPI] Video download completed from Next.js API', {
          compositionId,
          blobSize: blob.size,
          blobType: blob.type
        });

        // 验证blob是否有效
        if (blob.size === 0) {
          throw new Error('Downloaded blob is empty');
        }

        return blob;
      } catch (blobError: any) {
        console.error('[VideoCompositionAPI] Blob conversion failed', {
          compositionId,
          error: blobError.message,
          responseBodyUsed: response.bodyUsed,
          responseRedirected: response.redirected
        });
        throw new Error(`Failed to convert response to blob: ${blobError.message}`);
      }
    } catch (error: any) {
      // 检查是否是超时错误并记录详细信息
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        console.error('[VideoCompositionAPI] Video download timeout after 10 minutes', {
          compositionId,
          taskId,
          error: error.message
        });
      } else {
        console.error('[VideoCompositionAPI] Video download failed', error);
      }
      throw error;
    }
  }

  /**
   * Trigger automatic download of a composed video
   * Uses direct URL download instead of blob conversion to avoid memory issues
   */
  async triggerDownload(compositionId: string, taskId?: string, filename?: string): Promise<void> {
    console.log('[VideoCompositionAPI] Starting direct download', {
      compositionId,
      taskId,
      filename,
      method: 'direct_url'
    });

    try {
      // 构建下载URL
      const downloadUrl = `/api/video-compose/${compositionId}/download${taskId ? `?task_id=${taskId}` : ''}`;
      
      // 创建下载链接并触发下载
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || `composed_video_${compositionId}.mp4`;
      
      // 设置必要的属性以确保下载行为
      link.style.display = 'none';
      link.target = '_blank';
      
      console.log('[VideoCompositionAPI] Creating download link', {
        url: downloadUrl,
        filename: link.download,
        compositionId
      });
      
      // 添加到DOM，点击，然后移除
      document.body.appendChild(link);
      link.click();
      
      // 延迟移除链接，确保下载开始
      setTimeout(() => {
        if (document.body.contains(link)) {
          document.body.removeChild(link);
        }
      }, 100);
      
      console.log('[VideoCompositionAPI] Direct download triggered successfully', {
        compositionId,
        filename: link.download,
        url: downloadUrl
      });
      
    } catch (error: any) {
      console.error('[VideoCompositionAPI] Failed to trigger direct download', {
        compositionId,
        taskId,
        filename,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Poll composition status until completion
   */
  async pollCompositionStatus(
    compositionId: string, 
    onProgress?: (status: CompositionStatusResponse) => void,
    pollInterval: number = 2000,
    maxAttempts: number = 300 // 10 minutes at 2s intervals (increased for subtitle processing)
  ): Promise<CompositionStatusResponse> {
    console.log('[VideoCompositionAPI] Starting status polling', {
      compositionId,
      pollInterval,
      maxAttempts
    });

    let attempts = 0;
    
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          attempts++;
          const status = await this.getCompositionStatus(compositionId);
          
          // Call progress callback if provided
          if (onProgress) {
            onProgress(status);
          }
          
          // Check if composition is complete
          if (status.status === 'completed') {
            console.log('[VideoCompositionAPI] Composition completed', {
              compositionId,
              attempts,
              processingTime: status.processing_time
            });
            resolve(status);
            return;
          }
          
          // Check if composition failed
          if (status.status === 'failed') {
            console.error('[VideoCompositionAPI] Composition failed', {
              compositionId,
              attempts,
              errorDetails: status.error_details
            });
            reject(new Error(`Composition failed: ${status.error_details?.error || 'Unknown error'}`));
            return;
          }
          
          // Check if we've exceeded max attempts
          if (attempts >= maxAttempts) {
            console.error('[VideoCompositionAPI] Polling timeout', {
              compositionId,
              attempts,
              maxAttempts
            });
            reject(new Error('Composition polling timeout'));
            return;
          }
          
          // Continue polling
          setTimeout(poll, pollInterval);
          
        } catch (error) {
          console.error('[VideoCompositionAPI] Polling error', {
            compositionId,
            attempts,
            error
          });
          reject(error);
        }
      };
      
      // Start polling
      poll();
    });
  }

  /**
   * Check video composition service health
   */
  async checkHealth(): Promise<any> {
    const url = `/api/video-compose/health`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // 设置较短超时，健康检查应该快速响应
        signal: AbortSignal.timeout(10000) // 10秒超时
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      console.log('[VideoCompositionAPI] Health check result from Next.js API', result);
      return result;
    } catch (error) {
      console.error('[VideoCompositionAPI] Health check failed', error);
      throw error;
    }
  }
}

// Export a default instance
export const videoCompositionAPI = new VideoCompositionAPI(); 