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
      totalDuration: request.total_duration
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
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
    } catch (error) {
      console.error('[VideoCompositionAPI] Composition request failed', error);
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
        }
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
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      
      console.log('[VideoCompositionAPI] Video download completed from Next.js API', {
        compositionId,
        blobSize: blob.size,
        blobType: blob.type
      });

      return blob;
    } catch (error) {
      console.error('[VideoCompositionAPI] Video download failed', error);
      throw error;
    }
  }

  /**
   * Trigger automatic download of a composed video
   */
  async triggerDownload(compositionId: string, taskId?: string, filename?: string): Promise<void> {
    try {
      const blob = await this.downloadVideo(compositionId, taskId);
      
      // Create a download link and trigger the download
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename || `composed_video_${compositionId}.mp4`;
      
      // Append to body, click, and remove
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the object URL
      window.URL.revokeObjectURL(downloadUrl);
      
      console.log('[VideoCompositionAPI] Download triggered successfully', {
        compositionId,
        filename: link.download
      });
    } catch (error) {
      console.error('[VideoCompositionAPI] Failed to trigger download', error);
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
    maxAttempts: number = 150 // 5 minutes at 2s intervals
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
        }
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