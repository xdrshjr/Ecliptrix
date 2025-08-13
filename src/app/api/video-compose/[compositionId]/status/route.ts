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

    // 调用后端服务，带重试机制
    console.log(`[Video Compose Status API] Calling backend service: ${BACKEND_URL}/api/video/compose/${compositionId}/status`);
    
    let backendResponse: Response | null = null;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount <= maxRetries) {
      try {
        backendResponse = await fetch(`${BACKEND_URL}/api/video/compose/${compositionId}/status`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          // 减少超时时间到30秒，但使用重试机制
          signal: AbortSignal.timeout(30000), // 30秒超时
        });
        
        // 如果请求成功，跳出重试循环
        break;
        
      } catch (error: any) {
        retryCount++;
        console.log(`[Video Compose Status API] Attempt ${retryCount} failed:`, error.message);
        
        if (retryCount > maxRetries) {
          console.error(`[Video Compose Status API] All ${maxRetries + 1} attempts failed`);
          throw error;
        }
        
        // 等待一段时间后重试（指数退避）
        const waitTime = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // 1s, 2s, 4s, 最多5s
        console.log(`[Video Compose Status API] Waiting ${waitTime}ms before retry ${retryCount + 1}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    // 确保 backendResponse 不为 null
    if (!backendResponse) {
      throw new Error('Failed to get response from backend after all retries');
    }

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