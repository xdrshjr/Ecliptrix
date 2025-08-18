import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (compositionId: string, taskId?: string, filename?: string) => {
  console.log(`[Video Compose Download API] ${new Date().toISOString()} - Download request`);
  console.log(`[Video Compose Download API] Composition ID: ${compositionId}`);
  console.log(`[Video Compose Download API] Task ID: ${taskId || 'N/A'}`);
  console.log(`[Video Compose Download API] Filename: ${filename || 'N/A'}`);
};

const logResponse = (success: boolean, fileSize?: number, error?: string) => {
  if (success) {
    console.log(`[Video Compose Download API] ${new Date().toISOString()} - Download completed successfully`);
    console.log(`[Video Compose Download API] File size: ${fileSize ? `${(fileSize / 1024 / 1024).toFixed(2)} MB` : 'N/A'}`);
  } else {
    console.error(`[Video Compose Download API] ${new Date().toISOString()} - Download failed: ${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ compositionId: string }> }
) {
  try {
    const { compositionId } = await params;
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get('task_id');
    const filename = searchParams.get('filename');

    // 验证参数
    if (!compositionId || typeof compositionId !== 'string') {
      console.error('[Video Compose Download API] Invalid request: compositionId is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Composition ID is required',
          data: null
        },
        { status: 400 }
      );
    }

    logRequest(compositionId, taskId || undefined, filename || undefined);

    // 构建后端URL
    const backendUrl = new URL(`${BACKEND_URL}/api/video/compose/${compositionId}/download`);
    if (taskId) backendUrl.searchParams.set('task_id', taskId);
    if (filename) backendUrl.searchParams.set('filename', filename);

    // 调用后端服务
    console.log(`[Video Compose Download API] Calling backend service: ${backendUrl.toString()}`);
    
    const backendResponse = await fetch(backendUrl.toString(), {
      method: 'GET',
      // 设置10分钟超时，适应大视频文件下载
      signal: AbortSignal.timeout(600000), // 600秒（10分钟）超时
    });

    console.log(`[Video Compose Download API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Video Compose Download API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, `Backend error: ${backendResponse.status}`);
      
      if (backendResponse.status === 404) {
        return NextResponse.json(
          { 
            success: false,
            message: 'Composition not found or not ready for download',
            data: null
          },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Video download service temporarily unavailable',
          data: null
        },
        { status: 500 }
      );
    }

    // 获取响应头信息
    const contentType = backendResponse.headers.get('content-type') || 'video/mp4';
    const contentLength = backendResponse.headers.get('content-length');
    const compositionIdHeader = backendResponse.headers.get('x-composition-id');
    const contentDisposition = backendResponse.headers.get('content-disposition') || 
      `attachment; filename="${filename || `composed_video_${compositionId}.mp4`}"`;

    // 记录响应结果
    logResponse(true, contentLength ? parseInt(contentLength) : undefined);

    // 使用流式传输，避免将大文件加载到内存中
    const response = new NextResponse(backendResponse.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': contentLength || '0',
        'Content-Disposition': contentDisposition,
        'X-Composition-ID': compositionIdHeader || compositionId,
        // 添加缓存控制头，优化大文件传输
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
        // 添加CORS头，确保前端可以正确访问
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition, X-Composition-ID',
      },
    });

    console.log(`[Video Compose Download API] Streaming file response`, {
      compositionId,
      contentType,
      contentLength,
      streamingMode: 'enabled'
    });

    return response;

  } catch (error: any) {
    // 检查是否是超时错误并记录详细信息
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      console.error('[Video Compose Download API] Request timeout after 10 minutes', {
        compositionId: (await params).compositionId,
        error: error.message
      });
      logResponse(false, undefined, `Download timeout: ${error.message}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Video download timeout - file may be too large or processing is incomplete',
          data: null
        },
        { status: 408 }
      );
    }
    
    console.error('[Video Compose Download API] Request processing error:', error);
    logResponse(false, undefined, String(error));
    
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