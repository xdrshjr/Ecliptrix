import { NextRequest, NextResponse } from 'next/server';

/**
 * Logging functions
 */
const logRequest = (promptId: string) => {
  console.log(`[Digital Human Status API] Status check requested for prompt_id: ${promptId}`);
};

const logResponse = (success: boolean, promptId: string, status?: string, error?: string) => {
  if (success && status) {
    console.log(`[Digital Human Status API] Status response sent for ${promptId}: ${status}`);
  } else {
    console.error(`[Digital Human Status API] Status response failed for ${promptId}: ${error}`);
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
      console.error('[Digital Human Status API] Invalid request: promptId is required');
      return NextResponse.json(
        { error: 'Prompt ID is required' },
        { status: 400 }
      );
    }

    logRequest(promptId);

    // 调用ComfyUI API服务状态查询接口
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    console.log(`[Digital Human Status API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/digital-human-status/${promptId}`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/digital-human-status/${promptId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log(`[Digital Human Status API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[Digital Human Status API] Failed to parse error response:', parseError);
      }

      console.error(`[Digital Human Status API] ComfyUI error: ${errorMessage}`);
      logResponse(false, promptId, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'Digital human generation service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    const data = await comfyuiResponse.json();
    console.log(`[Digital Human Status API] ComfyUI response received:`,
      {
        promptId: data.prompt_id,
        status: data.status,
        progress: data.progress,
        videosCount: data.videos?.length || 0
      }
    );

    // 验证响应格式
    if (!data.prompt_id) {
      console.error('[Digital Human Status API] Invalid response: missing prompt_id');
      logResponse(false, promptId, undefined, 'Invalid response format');
      
      return NextResponse.json(
        { error: 'Invalid response from digital human generation service' },
        { status: 500 }
      );
    }

    logResponse(true, promptId, data.status);

    // 返回标准化的响应
    return NextResponse.json({
      prompt_id: data.prompt_id,
      status: data.status,
      progress: data.progress,
      videos: data.videos || [],
      error_message: data.error_message,
      created_at: data.created_at,
      completed_at: data.completed_at
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Digital Human Status API] Unexpected error:', error);
    logResponse(false, promptId || 'unknown', undefined, errorMessage);

    return NextResponse.json(
      { error: 'Internal server error', message: errorMessage },
      { status: 500 }
    );
  }
} 