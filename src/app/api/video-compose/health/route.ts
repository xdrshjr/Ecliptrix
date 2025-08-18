import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = () => {
  console.log(`[Video Compose Health API] ${new Date().toISOString()} - Health check request`);
};

const logResponse = (success: boolean, status?: string, error?: string) => {
  if (success) {
    console.log(`[Video Compose Health API] ${new Date().toISOString()} - Health check completed successfully`);
    console.log(`[Video Compose Health API] Service status: ${status || 'N/A'}`);
  } else {
    console.error(`[Video Compose Health API] ${new Date().toISOString()} - Health check failed: ${error}`);
  }
};

export async function GET(request: NextRequest) {
  try {
    logRequest();

    // 调用后端服务
    console.log(`[Video Compose Health API] Calling backend service: ${BACKEND_URL}/api/video/compose/health`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/compose/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // 设置10秒超时，健康检查应该快速响应
      signal: AbortSignal.timeout(10000), // 10秒超时
    });

    console.log(`[Video Compose Health API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Video Compose Health API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          service: "video_composition",
          status: "error",
          message: 'Video composition health service unavailable',
          ffmpeg_available: false,
          active_compositions: 0,
          timestamp: new Date().toISOString()
        },
        { status: 503 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    logResponse(true, result.status);

    return NextResponse.json(result);

  } catch (error: any) {
    // 检查是否是超时错误并记录详细信息
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      console.error('[Video Compose Health API] Health check timeout after 10 seconds', {
        error: error.message
      });
      logResponse(false, undefined, `Health check timeout: ${error.message}`);
      
      return NextResponse.json(
        { 
          service: "video_composition",
          status: "error",
          message: 'Health check timeout - service may be overloaded',
          ffmpeg_available: false,
          active_compositions: 0,
          timestamp: new Date().toISOString()
        },
        { status: 408 }
      );
    }
    
    console.error('[Video Compose Health API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        service: "video_composition",
        status: "error",
        message: 'Internal server error',
        ffmpeg_available: false,
        active_compositions: 0,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 