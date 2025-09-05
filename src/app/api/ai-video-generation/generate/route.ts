import { NextRequest, NextResponse } from 'next/server';

// 日志记录函数
const logRequest = (request: any) => {
  console.log(`[AI Video Generation API] Request received:`, {
    positivePrompt: request.positive_prompt?.substring(0, 100),
    negativePrompt: request.negative_prompt?.substring(0, 50),
    dimensions: `${request.width}x${request.height}`,
    duration: request.duration_seconds,
    steps: request.steps,
    aspectRatio: request.aspect_ratio,
    enableLora: request.enable_lora,
    timestamp: new Date().toISOString()
  });
};

const logResponse = (success: boolean, promptId?: string, error?: string) => {
  if (success) {
    console.log(`[AI Video Generation API] Response success: promptId=${promptId}`);
  } else {
    console.error(`[AI Video Generation API] Response failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      positive_prompt, 
      negative_prompt,
      width = 600,
      height = 800,
      duration_seconds = 5,
      steps = 8,
      seed,
      enable_lora = true,
      aspect_ratio
    } = body;

    // 验证必需参数
    if (!positive_prompt || !positive_prompt.trim()) {
      console.error('[AI Video Generation API] Invalid request: positive_prompt is required');
      return NextResponse.json(
        { error: 'Positive prompt is required' },
        { status: 400 }
      );
    }

    // 验证参数范围
    if (width < 64 || width > 2048 || width % 8 !== 0) {
      console.error('[AI Video Generation API] Invalid width:', width);
      return NextResponse.json(
        { error: 'Width must be between 64-2048 and multiple of 8' },
        { status: 400 }
      );
    }

    if (height < 64 || height > 2048 || height % 8 !== 0) {
      console.error('[AI Video Generation API] Invalid height:', height);
      return NextResponse.json(
        { error: 'Height must be between 64-2048 and multiple of 8' },
        { status: 400 }
      );
    }

    if (duration_seconds < 1 || duration_seconds > 30) {
      console.error('[AI Video Generation API] Invalid duration:', duration_seconds);
      return NextResponse.json(
        { error: 'Duration must be between 1-30 seconds' },
        { status: 400 }
      );
    }

    if (steps < 1 || steps > 100) {
      console.error('[AI Video Generation API] Invalid steps:', steps);
      return NextResponse.json(
        { error: 'Steps must be between 1-100' },
        { status: 400 }
      );
    }

    // 验证aspect_ratio
    const validAspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'];
    if (aspect_ratio && !validAspectRatios.includes(aspect_ratio)) {
      console.error('[AI Video Generation API] Invalid aspect ratio:', aspect_ratio);
      return NextResponse.json(
        { error: `Aspect ratio must be one of: ${validAspectRatios.join(', ')}` },
        { status: 400 }
      );
    }

    const requestData = {
      positive_prompt: positive_prompt.trim(),
      negative_prompt: negative_prompt?.trim() || '低质量，模糊，静态，细节模糊不清',
      width,
      height,
      duration_seconds,
      steps,
      seed: seed || null,
      enable_lora,
      aspect_ratio: aspect_ratio || null
    };

    logRequest(requestData);

    // 调用ComfyUI API服务
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8000';
    console.log(`[AI Video Generation API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/generate-ai-video`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/generate-ai-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[AI Video Generation API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[AI Video Generation API] Failed to parse error response:', parseError);
      }

      console.error(`[AI Video Generation API] ComfyUI error: ${errorMessage}`);
      logResponse(false, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'AI video generation service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    const data = await comfyuiResponse.json();
    console.log(`[AI Video Generation API] ComfyUI response received:`, {
      promptId: data.prompt_id,
      status: data.status,
      estimatedTime: data.estimated_time
    });

    // 验证响应格式
    if (!data.prompt_id) {
      const error = 'Invalid response format from ComfyUI service';
      console.error(`[AI Video Generation API] ${error}`);
      logResponse(false, undefined, error);

      return NextResponse.json(
        {
          error: 'Invalid response from AI video generation service'
        },
        { status: 500 }
      );
    }

    logResponse(true, data.prompt_id);

    // 返回标准响应格式
    return NextResponse.json({
      prompt_id: data.prompt_id,
      status: data.status,
      message: data.message || 'Video generation started',
      estimated_time: data.estimated_time
    });

  } catch (error) {
    console.error('[AI Video Generation API] Unexpected error:', error);
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