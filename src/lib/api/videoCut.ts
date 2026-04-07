import { VideoCutRequest, VideoCutResponse } from '@/types';

import { TimeoutError, http } from '@/lib/api/http-client';

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
   * Cut video clips and upload to storage.
   *
   * Long-running call (~5 minutes); the wrapper's timeout is bumped to
   * match the previous behavior.
   */
  async cutVideoClips(request: VideoCutRequest): Promise<VideoCutResponse> {
    try {
      return await http.post<VideoCutResponse>('/api/video-cut', request, {
        timeoutMs: 300_000,
      });
    } catch (error) {
      if (error instanceof TimeoutError) {
        // Preserve the original user-facing message so existing UI
        // notifications stay consistent.
        throw new Error('视频切分请求超时，请稍后重试');
      }
      throw error;
    }
  }
}

// Create a default instance
export const videoCutAPI = new VideoCutAPI();
