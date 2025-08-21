import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

interface DownloadAndUploadRequest {
  url: string;
  task_id?: string;
  video_quality?: string;
  audio_quality?: string;
  format_type?: string;
  generate_thumbnail?: boolean;
  custom_filename?: string;
}

interface DownloadAndUploadResponse {
  success: boolean;
  message: string;
  video_url?: string;
  thumbnail_url?: string;
  file_size?: number;
  duration?: number;
  width?: number;
  height?: number;
  original_youtube_url?: string;
  error?: string;
}

const logRequest = (data: any) => {
  console.log('[YouTube Download-Upload API] Request:', {
    url: data.url,
    task_id: data.task_id,
    video_quality: data.video_quality,
    timestamp: new Date().toISOString()
  });
};

const logResponse = (data: any) => {
  console.log('[YouTube Download-Upload API] Response:', {
    success: data.success,
    video_url: data.success ? data.video_url : null,
    error: data.success ? null : data.error,
    timestamp: new Date().toISOString()
  });
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      url, 
      task_id,
      video_quality = '720p', 
      audio_quality = 'best', 
      format_type = 'mp4',
      generate_thumbnail = true,
      custom_filename
    }: DownloadAndUploadRequest = body;

    // 验证请求参数
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      console.error('[YouTube Download-Upload API] Invalid request: url is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Video URL is required',
          error: 'Video URL is required'
        },
        { status: 400 }
      );
    }

    // 验证YouTube URL格式
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      console.error('[YouTube Download-Upload API] Invalid YouTube URL');
      return NextResponse.json(
        { 
          success: false,
          message: 'Please provide a valid YouTube video URL',
          error: 'Please provide a valid YouTube video URL'
        },
        { status: 400 }
      );
    }

    const requestData = { 
      url: url.trim(),
      task_id,
      video_quality,
      audio_quality,
      format_type,
      generate_thumbnail,
      custom_filename
    };
    logRequest(requestData);

    // 调用后端YouTube下载并上传服务
    console.log(`[YouTube Download-Upload API] Calling backend service: ${BACKEND_URL}/api/youtube/download-and-upload`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/youtube/download-and-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[YouTube Download-Upload API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('[YouTube Download-Upload API] Backend error:', errorText);
      
      return NextResponse.json(
        { 
          success: false,
          message: `Backend service error: ${backendResponse.status}`,
          error: errorText || 'Unknown backend error'
        },
        { status: backendResponse.status }
      );
    }

    const result: DownloadAndUploadResponse = await backendResponse.json();
    logResponse(result);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[YouTube Download-Upload API] Unexpected error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error during download and upload',
        error: errorMessage
      },
      { status: 500 }
    );
  }
} 