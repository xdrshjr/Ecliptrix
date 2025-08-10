import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (requestData: any) => {
  console.log(`[Video Search API] ${new Date().toISOString()} - Video search request`);
  console.log(`[Video Search API] Query: "${requestData.query}"`);
  console.log(`[Video Search API] Max videos: ${requestData.max_videos}`);
  console.log(`[Video Search API] Orientation: ${requestData.orientation}`);
};

const logResponse = (success: boolean, resultCount?: number, error?: string) => {
  if (success) {
    console.log(`[Video Search API] ${new Date().toISOString()} - Search completed successfully`);
    console.log(`[Video Search API] Found ${resultCount || 0} videos`);
  } else {
    console.error(`[Video Search API] ${new Date().toISOString()} - Search failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, max_videos = 20, orientation = 'mixed' } = body;

    // 验证请求参数
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      console.error('[Video Search API] Invalid request: query is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Search query is required',
          videos: [],
          total_found: 0,
          query: query || ''
        },
        { status: 400 }
      );
    }

    if (max_videos < 1 || max_videos > 50) {
      console.error('[Video Search API] Invalid request: max_videos must be between 1 and 50');
      return NextResponse.json(
        { 
          success: false,
          message: 'max_videos must be between 1 and 50',
          videos: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    if (!['landscape', 'portrait', 'mixed'].includes(orientation)) {
      console.error('[Video Search API] Invalid request: invalid orientation');
      return NextResponse.json(
        { 
          success: false,
          message: 'orientation must be one of: landscape, portrait, mixed',
          videos: [],
          total_found: 0,
          query: query
        },
        { status: 400 }
      );
    }

    const requestData = { query: query.trim(), max_videos, orientation };
    logRequest(requestData);

    // 调用后端服务
    console.log(`[Video Search API] Calling backend service: ${BACKEND_URL}/api/video/search`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Video Search API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Video Search API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Backend service error',
          videos: [],
          total_found: 0,
          query: query
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 验证后端响应格式
    if (!result || typeof result.success !== 'boolean') {
      console.error('[Video Search API] Invalid backend response format');
      logResponse(false, undefined, 'Invalid backend response format');
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Invalid response from backend service',
          videos: [],
          total_found: 0,
          query: query
        },
        { status: 500 }
      );
    }

    logResponse(result.success, result.videos?.length, result.message);

    // 返回结果，确保格式一致
    return NextResponse.json({
      success: result.success,
      message: result.message || (result.success ? 'Search completed' : 'Search failed'),
      videos: result.videos || [],
      total_found: result.total_found || (result.videos?.length || 0),
      query: query
    });

  } catch (error) {
    console.error('[Video Search API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        videos: [],
        total_found: 0,
        query: ''
      },
      { status: 500 }
    );
  }
}

// 健康检查端点
export async function GET() {
  try {
    console.log('[Video Search API] Health check requested');
    
    // 检查后端服务是否可用
    const backendHealthResponse = await fetch(`${BACKEND_URL}/api/video/search/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const backendHealth = backendHealthResponse.ok ? await backendHealthResponse.json() : null;

    const healthStatus = {
      service: 'video_search_proxy',
      status: backendHealthResponse.ok ? 'healthy' : 'degraded',
      backend_url: BACKEND_URL,
      backend_status: backendHealth?.status || 'unknown',
      backend_api_keys_configured: backendHealth?.api_keys_configured || false,
      message: backendHealthResponse.ok ? 'Proxy service operational' : 'Backend service unavailable'
    };

    console.log(`[Video Search API] Health check completed - Status: ${healthStatus.status}`);
    return NextResponse.json(healthStatus);

  } catch (error) {
    console.error('[Video Search API] Health check error:', error);
    
    return NextResponse.json({
      service: 'video_search_proxy',
      status: 'error',
      backend_url: BACKEND_URL,
      message: `Health check failed: ${String(error)}`
    });
  }
} 