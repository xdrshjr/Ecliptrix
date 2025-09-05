import { NextRequest, NextResponse } from 'next/server';

// 日志记录函数
const logRequest = (promptId: string) => {
  console.log(`[AI Video Download API] Download requested for promptId: ${promptId}`, {
    timestamp: new Date().toISOString()
  });
};

const logResponse = (success: boolean, promptId: string, size?: number, error?: string) => {
  if (success) {
    console.log(`[AI Video Download API] Download success: promptId=${promptId}, size=${size} bytes`);
  } else {
    console.error(`[AI Video Download API] Download failed: promptId=${promptId}, error=${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ promptId: string }> }
) {
  let promptId: string | undefined;
  
  try {
    const resolvedParams = await params;
    promptId = resolvedParams.promptId;

    if (!promptId) {
      console.error('[AI Video Download API] Invalid request: promptId is required');
      return NextResponse.json(
        { error: 'Prompt ID is required' },
        { status: 400 }
      );
    }

    // 验证promptId安全性
    if (promptId.includes('..') || promptId.includes('/') || promptId.includes('\\')) {
      console.error('[AI Video Download API] Invalid promptId:', promptId);
      return NextResponse.json(
        { error: 'Invalid prompt ID' },
        { status: 400 }
      );
    }

    logRequest(promptId);

    // 调用ComfyUI API服务视频下载接口
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8000';
    console.log(`[AI Video Download API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/download-ai-video/${promptId}`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/download-ai-video/${promptId}`, {
      method: 'GET',
    });

    console.log(`[AI Video Download API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[AI Video Download API] Failed to parse error response:', parseError);
      }

      console.error(`[AI Video Download API] ComfyUI error: ${errorMessage}`);
      logResponse(false, promptId, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'AI video download service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    // 获取视频数据
    const videoBuffer = await comfyuiResponse.arrayBuffer();
    const contentType = comfyuiResponse.headers.get('content-type') || 'video/mp4';
    const contentDisposition = comfyuiResponse.headers.get('content-disposition') || `attachment; filename="ai_video_${promptId}.mp4"`;
    
    console.log(`[AI Video Download API] Video received:`, {
      promptId,
      size: videoBuffer.byteLength,
      contentType
    });

    logResponse(true, promptId, videoBuffer.byteLength);

    // 返回视频数据
    return new NextResponse(videoBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'public, max-age=31536000', // 缓存1年
      },
    });

  } catch (error) {
    console.error('[AI Video Download API] Unexpected error:', error);
    logResponse(false, promptId || 'unknown', undefined, error instanceof Error ? error.message : 'Unknown error');
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}