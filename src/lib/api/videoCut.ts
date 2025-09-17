import { VideoCutRequest, VideoCutResponse } from '@/types';

/**
 * Video Cut API Client
 * 视频切分API客户端
 */
export class VideoCutAPI {
  private baseUrl: string;

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl;
  }

  /**
   * Cut video clips and upload to Supabase
   * 切分视频片段并上传到Supabase
   */
  async cutVideoClips(request: VideoCutRequest): Promise<VideoCutResponse> {
    const url = `/api/video-cut`;
    
    console.log('[VideoCutAPI] Sending video cut request to Next.js API', {
      taskId: request.task_id,
      videoUrl: request.video_url?.slice(0, 100) + '...',
      clipsCount: request.clips.length,
      generateThumbnails: request.generate_thumbnails,
      timeout: '5 minutes'
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        // Set 5 minute timeout for video cutting
        signal: AbortSignal.timeout(300000) // 300 seconds (5 minutes) timeout
      });

      if (!response.ok) {
        // Try to get detailed error information from response
        let errorData: any = null;
        try {
          errorData = await response.json();
        } catch (parseError) {
          // If parsing fails, create a generic error
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // Create an error object with the response data for better error handling
        const error = new Error(errorData.message || `HTTP error! status: ${response.status}`);
        (error as any).response = { json: async () => errorData };
        throw error;
      }

      const result: VideoCutResponse = await response.json();
      
      console.log('[VideoCutAPI] Video cut response received from Next.js API', {
        success: result.success,
        totalClips: result.total_clips,
        processingTime: result.processing_time,
        clipsInfo: result.clips.map(clip => ({
          id: clip.id,
          name: clip.name,
          fileSize: clip.file_size,
          duration: clip.duration
        }))
      });

      return result;
    } catch (error: any) {
      // Check if it's a timeout error and log detailed information
      if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
        console.error('[VideoCutAPI] Request timeout', {
          taskId: request.task_id,
          timeout: '5 minutes',
          clipsCount: request.clips.length,
          error: error.message
        });
        throw new Error('视频切分请求超时，请稍后重试');
      }
      
      console.error('[VideoCutAPI] Request failed', error);
      throw error;
    }
  }
}

// Create a default instance
export const videoCutAPI = new VideoCutAPI(); 