import { NextRequest, NextResponse } from 'next/server';

// 日志记录函数
const logRequest = (request: any) => {
  console.log(`[AI Image Generation API] Request received:`, {
    positivePrompt: request.positive_prompt?.substring(0, 100),
    negativePrompt: request.negative_prompt?.substring(0, 50),
    dimensions: `${request.width}x${request.height}`,
    steps: request.steps,
    cfg: request.cfg,
    guidance: request.guidance,
    checkpoint: request.checkpoint,
    timestamp: new Date().toISOString()
  });
};

const logResponse = (success: boolean, promptId?: string, error?: string) => {
  if (success) {
    console.log(`[AI Image Generation API] Response success: promptId=${promptId}`);
  } else {
    console.error(`[AI Image Generation API] Response failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      positive_prompt, 
      negative_prompt,
      width = 1024,
      height = 1024,
      steps = 20,
      seed,
      cfg = 1.0,
      guidance = 3.5,
      checkpoint = 'flux1-dev-fp8.safetensors'
    } = body;

    // 验证必需参数
    if (!positive_prompt || !positive_prompt.trim()) {
      console.error('[AI Image Generation API] Invalid request: positive_prompt is required');
      return NextResponse.json(
        { error: 'Positive prompt is required' },
        { status: 400 }
      );
    }

    // 验证参数范围
    if (width < 64 || width > 2048 || width % 8 !== 0) {
      console.error('[AI Image Generation API] Invalid width:', width);
      return NextResponse.json(
        { error: 'Width must be between 64-2048 and multiple of 8' },
        { status: 400 }
      );
    }

    if (height < 64 || height > 2048 || height % 8 !== 0) {
      console.error('[AI Image Generation API] Invalid height:', height);
      return NextResponse.json(
        { error: 'Height must be between 64-2048 and multiple of 8' },
        { status: 400 }
      );
    }

    if (steps < 1 || steps > 100) {
      console.error('[AI Image Generation API] Invalid steps:', steps);
      return NextResponse.json(
        { error: 'Steps must be between 1-100' },
        { status: 400 }
      );
    }

    if (cfg < 0.1 || cfg > 20.0) {
      console.error('[AI Image Generation API] Invalid cfg:', cfg);
      return NextResponse.json(
        { error: 'CFG must be between 0.1-20.0' },
        { status: 400 }
      );
    }

    if (guidance < 0.1 || guidance > 20.0) {
      console.error('[AI Image Generation API] Invalid guidance:', guidance);
      return NextResponse.json(
        { error: 'Guidance must be between 0.1-20.0' },
        { status: 400 }
      );
    }

    const requestData = {
      positive_prompt: positive_prompt.trim(),
      negative_prompt: negative_prompt?.trim() || 'low quality, blurry, distorted',
      width,
      height,
      steps,
      seed: seed || null,
      cfg,
      guidance,
      checkpoint
    };

    logRequest(requestData);

    // 调用ComfyUI API服务
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    console.log(`[AI Image Generation API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/generate-image`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/generate-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[AI Image Generation API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[AI Image Generation API] Failed to parse error response:', parseError);
      }

      console.error(`[AI Image Generation API] ComfyUI error: ${errorMessage}`);
      logResponse(false, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'AI image generation service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    const data = await comfyuiResponse.json();
    console.log(`[AI Image Generation API] ComfyUI response received:`, {
      promptId: data.prompt_id,
      status: data.status,
      estimatedTime: data.estimated_time
    });

    // 验证响应格式
    if (!data.prompt_id) {
      const error = 'Invalid response format from ComfyUI service';
      console.error(`[AI Image Generation API] ${error}`);
      logResponse(false, undefined, error);

      return NextResponse.json(
        {
          error: 'Invalid response from AI image generation service'
        },
        { status: 500 }
      );
    }

    logResponse(true, data.prompt_id);

    // 返回标准响应格式
    return NextResponse.json({
      prompt_id: data.prompt_id,
      status: data.status,
      message: data.message || 'Image generation started',
      estimated_time: data.estimated_time
    });

  } catch (error) {
    console.error('[AI Image Generation API] Unexpected error:', error);
    logResponse(false, undefined, error instanceof Error ? error.message : 'Unknown error');
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 