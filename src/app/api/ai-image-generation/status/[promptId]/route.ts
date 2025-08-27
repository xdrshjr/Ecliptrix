import { NextRequest, NextResponse } from 'next/server';

// 日志记录函数
const logRequest = (promptId: string) => {
  console.log(`[AI Image Status API] Status check requested for promptId: ${promptId}`, {
    timestamp: new Date().toISOString()
  });
};

const logResponse = (success: boolean, promptId: string, status?: string, error?: string) => {
  if (success) {
    console.log(`[AI Image Status API] Status check success: promptId=${promptId}, status=${status}`);
  } else {
    console.error(`[AI Image Status API] Status check failed: promptId=${promptId}, error=${error}`);
  }
};

export async function GET(
  request: NextRequest,
  { params }: { params: { promptId: string } }
) {
  try {
    const { promptId } = params;

    if (!promptId) {
      console.error('[AI Image Status API] Invalid request: promptId is required');
      return NextResponse.json(
        { error: 'Prompt ID is required' },
        { status: 400 }
      );
    }

    logRequest(promptId);

    // 调用ComfyUI API服务状态查询接口
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    console.log(`[AI Image Status API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/status/${promptId}`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/status/${promptId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[AI Image Status API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[AI Image Status API] Failed to parse error response:', parseError);
      }

      console.error(`[AI Image Status API] ComfyUI error: ${errorMessage}`);
      logResponse(false, promptId, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'AI image generation service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    const data = await comfyuiResponse.json();
    console.log(`[AI Image Status API] ComfyUI response received:`, {
      promptId: data.prompt_id,
      status: data.status,
      progress: data.progress,
      imagesCount: data.images?.length || 0
    });

    // 验证响应格式
    if (!data.prompt_id) {
      const error = 'Invalid response format from ComfyUI service';
      console.error(`[AI Image Status API] ${error}`);
      logResponse(false, promptId, undefined, error);

      return NextResponse.json(
        {
          error: 'Invalid response from AI image generation service'
        },
        { status: 500 }
      );
    }

    logResponse(true, promptId, data.status);

    // 返回标准响应格式
    return NextResponse.json({
      prompt_id: data.prompt_id,
      status: data.status,
      progress: data.progress,
      images: data.images,
      error_message: data.error_message,
      created_at: data.created_at,
      completed_at: data.completed_at
    });

  } catch (error) {
    console.error('[AI Image Status API] Unexpected error:', error);
    logResponse(false, params.promptId, undefined, error instanceof Error ? error.message : 'Unknown error');
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 