import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 请求日志记录
const logRequest = (data: any) => {
  console.log(`[YouTube Download API] Request: ${JSON.stringify(data)}`);
};

// 响应日志记录
const logResponse = (success: boolean, data?: any, error?: string) => {
  if (success) {
    console.log(`[YouTube Download API] Success: Downloaded to ${data?.file_path || 'Unknown'}`);
  } else {
    console.error(`[YouTube Download API] Error: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      url, 
      video_quality = '720p', 
      audio_quality = 'best', 
      format_type = 'mp4',
      start_time,
      end_time,
      duration,
      subtitle = false
    } = body;

    // 验证请求参数
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      console.error('[YouTube Download API] Invalid request: url is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Video URL is required',
          file_path: null,
          file_size: null,
          error: 'Video URL is required'
        },
        { status: 400 }
      );
    }

    // 验证YouTube URL格式
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      console.error('[YouTube Download API] Invalid YouTube URL');
      return NextResponse.json(
        { 
          success: false,
          message: 'Please provide a valid YouTube video URL',
          file_path: null,
          file_size: null,
          error: 'Please provide a valid YouTube video URL'
        },
        { status: 400 }
      );
    }

    const requestData = { 
      url: url.trim(),
      video_quality,
      audio_quality,
      format_type,
      ...(start_time && { start_time }),
      ...(end_time && { end_time }),
      ...(duration && { duration }),
      subtitle
    };
    logRequest(requestData);

    // 调用后端YouTube下载服务
    console.log(`[YouTube Download API] Calling backend service: ${BACKEND_URL}/api/youtube/download`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/youtube/download`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[YouTube Download API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      let errorMessage = `Backend service error: ${backendResponse.status}`;
      try {
        const errorData = await backendResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[YouTube Download API] Failed to parse error response:', parseError);
      }

      console.error(`[YouTube Download API] Backend error: ${errorMessage}`);
      logResponse(false, null, errorMessage);

      return NextResponse.json(
        {
          success: false,
          message: 'YouTube download service unavailable',
          file_path: null,
          file_size: null,
          error: errorMessage
        },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    console.log(`[YouTube Download API] Backend response received`);

    // 验证响应格式
    if (typeof data.success !== 'boolean') {
      const error = 'Invalid response format from backend service';
      console.error(`[YouTube Download API] ${error}`);
      logResponse(false, null, error);

      return NextResponse.json(
        {
          success: false,
          message: 'Invalid response from YouTube download service',
          file_path: null,
          file_size: null,
          error: error
        },
        { status: 500 }
      );
    }

    const responseData = {
      success: data.success,
      message: data.message,
      file_path: data.file_path || null,
      file_size: data.file_size || null,
      ...(data.error && { error: data.error })
    };

    logResponse(data.success, responseData, data.error);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('[YouTube Download API] Unexpected error:', error);
    logResponse(false, null, error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        file_path: null,
        file_size: null,
        error: 'Internal server error occurred'
      },
      { status: 500 }
    );
  }
} 