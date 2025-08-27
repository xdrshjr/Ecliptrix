import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 请求日志记录
const logRequest = (data: any) => {
  console.log(`[YouTube Search API] Request: ${JSON.stringify(data)}`);
};

// 响应日志记录
const logResponse = (success: boolean, data?: any, error?: string) => {
  if (success) {
    console.log(`[YouTube Search API] Success: Found ${data?.total_found || 0} videos`);
  } else {
    console.error(`[YouTube Search API] Error: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, max_videos = 20, orientation = 'mixed', min_duration, max_duration, min_views, max_views } = body;

    // 验证请求参数
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      console.error('[YouTube Search API] Invalid request: query is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Search query is required',
          videos: [],
          total_found: 0,
          query: query || '',
          error: 'Search query is required'
        },
        { status: 400 }
      );
    }

    if (max_videos < 1 || max_videos > 50) {
      console.error('[YouTube Search API] Invalid request: max_videos must be between 1 and 50');
      return NextResponse.json(
        { 
          success: false,
          message: 'max_videos must be between 1 and 50',
          videos: [],
          total_found: 0,
          query: query,
          error: 'max_videos must be between 1 and 50'
        },
        { status: 400 }
      );
    }

    if (!['landscape', 'portrait', 'mixed'].includes(orientation)) {
      console.error('[YouTube Search API] Invalid request: invalid orientation');
      return NextResponse.json(
        { 
          success: false,
          message: 'orientation must be one of: landscape, portrait, mixed',
          videos: [],
          total_found: 0,
          query: query,
          error: 'orientation must be one of: landscape, portrait, mixed'
        },
        { status: 400 }
      );
    }

    const requestData = { 
      query: query.trim(), 
      max_videos, 
      orientation,
      ...(min_duration && { min_duration }),
      ...(max_duration && { max_duration }),
      ...(min_views && { min_views }),
      ...(max_views && { max_views })
    };
    logRequest(requestData);

    // 调用后端YouTube搜索服务
    console.log(`[YouTube Search API] Calling backend service: ${BACKEND_URL}/api/youtube/search`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/youtube/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[YouTube Search API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      let errorMessage = `Backend service error: ${backendResponse.status}`;
      try {
        const errorData = await backendResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[YouTube Search API] Failed to parse error response:', parseError);
      }

      console.error(`[YouTube Search API] Backend error: ${errorMessage}`);
      logResponse(false, null, errorMessage);

      return NextResponse.json(
        {
          success: false,
          message: 'YouTube search service unavailable',
          videos: [],
          total_found: 0,
          query: query,
          error: errorMessage
        },
        { status: backendResponse.status }
      );
    }

    const data = await backendResponse.json();
    console.log(`[YouTube Search API] Backend response received`);

    // 验证响应格式
    if (typeof data.success !== 'boolean') {
      const error = 'Invalid response format from backend service';
      console.error(`[YouTube Search API] ${error}`);
      logResponse(false, null, error);

      return NextResponse.json(
        {
          success: false,
          message: 'Invalid response from YouTube search service',
          videos: [],
          total_found: 0,
          query: query,
          error: error
        },
        { status: 500 }
      );
    }

    // 转换后端响应格式为前端期望的格式
    const responseData = {
      success: data.success,
      videos: data.videos || [],
      total_found: data.total_found || 0,
      message: data.message,
      query: data.query || query,
      ...(data.error && { error: data.error })
    };

    logResponse(data.success, responseData, data.error);

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('[YouTube Search API] Unexpected error:', error);
    logResponse(false, null, error instanceof Error ? error.message : String(error));

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        videos: [],
        total_found: 0,
        query: '',
        error: 'Internal server error occurred'
      },
      { status: 500 }
    );
  }
} 