import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (compositionId: string) => {
  console.log(`[Video Compose Status API] ${new Date().toISOString()} - Status check request`);
  console.log(`[Video Compose Status API] Composition ID: ${compositionId}`);
};

const logResponse = (success: boolean, status?: string, progress?: number, error?: string) => {
  if (success) {
    console.log(`[Video Compose Status API] ${new Date().toISOString()} - Status check completed successfully`);
    console.log(`[Video Compose Status API] Status: ${status || 'N/A'}`);
    console.log(`[Video Compose Status API] Progress: ${progress !== undefined ? `${(progress * 100).toFixed(1)}%` : 'N/A'}`);
  } else {
    console.error(`[Video Compose Status API] ${new Date().toISOString()} - Status check failed: ${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ compositionId: string }> }
) {
  try {
    const { compositionId } = await params;

    // 验证参数
    if (!compositionId || typeof compositionId !== 'string') {
      console.error('[Video Compose Status API] Invalid request: compositionId is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Composition ID is required',
          data: null
        },
        { status: 400 }
      );
    }

    logRequest(compositionId);

    // 调用后端服务
    console.log(`[Video Compose Status API] Calling backend service: ${BACKEND_URL}/api/video/compose/${compositionId}/status`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/compose/${compositionId}/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[Video Compose Status API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Video Compose Status API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, undefined, `Backend error: ${backendResponse.status}`);
      
      if (backendResponse.status === 404) {
        return NextResponse.json(
          { 
            success: false,
            message: 'Composition not found',
            data: null
          },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Video composition status service temporarily unavailable',
          data: null
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    logResponse(true, result.status, result.progress);

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Video Compose Status API] Request processing error:', error);
    logResponse(false, undefined, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        data: null
      },
      { status: 500 }
    );
  }
} 