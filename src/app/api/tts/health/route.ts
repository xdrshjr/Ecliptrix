import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = () => {
  console.log(`[TTS Health API] ${new Date().toISOString()} - TTS health check request`);
};

const logResponse = (success: boolean, status?: string, error?: string) => {
  if (success) {
    console.log(`[TTS Health API] ${new Date().toISOString()} - TTS health check completed successfully`);
    console.log(`[TTS Health API] Service status: ${status || 'unknown'}`);
  } else {
    console.error(`[TTS Health API] ${new Date().toISOString()} - TTS health check failed: ${error}`);
  }
};

export async function GET(request: NextRequest) {
  try {
    logRequest();

    // 调用后端服务
    console.log(`[TTS Health API] Calling backend service: ${BACKEND_URL}/api/tts/health`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/tts/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[TTS Health API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[TTS Health API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'TTS health service unavailable',
          status: 'unhealthy',
          timestamp: new Date().toISOString()
        },
        { status: 503 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    logResponse(true, result.status);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[TTS Health API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        status: 'error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
} 