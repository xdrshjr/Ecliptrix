import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 请求日志记录
const logRequest = (data: any) => {
  console.log(`[YouTube Info API] Request: ${JSON.stringify(data)}`);
};

// 响应日志记录
const logResponse = (success: boolean, data?: any, error?: string) => {
  if (success) {
    console.log(`[YouTube Info API] Success: Retrieved video info for ${data?.video?.title || 'Unknown'}`);
  } else {
    console.error(`[YouTube Info API] Error: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = body;

    // 验证请求参数
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      console.error('[YouTube Info API] Invalid request: url is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Video URL is required',
          video: null,
          error: 'Video URL is required'
        },
        { status: 400 }
      );
    }

    // 验证YouTube URL格式
    if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
      console.error('[YouTube Info API] Invalid YouTube URL');
      return NextResponse.json(
        { 
          success: false,
          message: 'Please provide a valid YouTube video URL',
          video: null,
          error: 'Please provide a valid YouTube video URL'
        },
        { status: 400 }
      );
    }

    const requestData = { url: url.trim() };
    logRequest(requestData);

    // 调用后端YouTube信息服务
    console.log(`[YouTube Info API] Calling backend service: ${BACKEND_URL}/api/youtube/info`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/youtube/info`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[YouTube Info API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      let errorMessage = `Backend service error: ${backendResponse.status}`;
      try {
        const errorData = await backendResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[YouTube Info API] Failed to parse error response:', parseError);
      }

      console.error(`[YouTube Info API] Backend error: ${errorMessage}`);
      logResponse(false, null, errorMessage);

      return NextResponse.json(
        {
          success: false,
          message: 'YouTube info service unavailable',
          video: null,
          error: errorMessage
        },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    console.log(`[YouTube Info API] Backend response received`);

    // 验证响应格式
    if (typeof data.success !== 'boolean') {
      const error = 'Invalid response format from backend service';
      console.error(`[YouTube Info API] ${error}`);
      logResponse(false, null, error);

      return NextResponse.json(
        {
          success: false,
          message: 'Invalid response from YouTube info service',
          video: null,
          error: error
        },
        { status: 500 }
      );
    }

    const responseData = {
      success: data.success,
      video: data.video || null,
      message: data.message,
      ...(data.error && { error: data.error })
    };

    logResponse(data.success, responseData, data.error);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('[YouTube Info API] Unexpected error:', error);
    logResponse(false, null, error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        video: null,
        error: 'Internal server error occurred'
      },
      { status: 500 }
    );
  }
} 