import { NextRequest, NextResponse } from 'next/server';

/**
 * Digital Human Generation API Request Interface
 */
interface DigitalHumanGenerationRequest {
  positive_prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  cfg?: number;
  shift?: number;
  reference_video_filename: string;
  audio_filename: string;
}

/**
 * Logging functions
 */
const logRequest = (requestData: DigitalHumanGenerationRequest) => {
  console.log(`[Digital Human Generation API] Request received:`, {
    positivePrompt: requestData.positive_prompt.substring(0, 100),
    negativePrompt: requestData.negative_prompt?.substring(0, 50),
    dimensions: `${requestData.width}x${requestData.height}`,
    steps: requestData.steps,
    cfg: requestData.cfg,
    shift: requestData.shift,
    referenceVideo: requestData.reference_video_filename,
    audioFile: requestData.audio_filename
  });
};

const logResponse = (success: boolean, promptId?: string, error?: string) => {
  if (success && promptId) {
    console.log(`[Digital Human Generation API] Response sent successfully - Prompt ID: ${promptId}`);
  } else {
    console.error(`[Digital Human Generation API] Response failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      positive_prompt,
      negative_prompt,
      width = 832,
      height = 480,
      steps = 4,
      seed,
      cfg = 1.0,
      shift = 8.0,
      reference_video_filename,
      audio_filename
    } = body as DigitalHumanGenerationRequest;

    // Validate required fields
    if (!positive_prompt || !positive_prompt.trim()) {
      console.error('[Digital Human Generation API] Invalid request: positive_prompt is required');
      return NextResponse.json(
        { error: 'Positive prompt is required' },
        { status: 400 }
      );
    }

    if (!reference_video_filename || !reference_video_filename.trim()) {
      console.error('[Digital Human Generation API] Invalid request: reference_video_filename is required');
      return NextResponse.json(
        { error: 'Reference video filename is required' },
        { status: 400 }
      );
    }

    if (!audio_filename || !audio_filename.trim()) {
      console.error('[Digital Human Generation API] Invalid request: audio_filename is required');
      return NextResponse.json(
        { error: 'Audio filename is required' },
        { status: 400 }
      );
    }

    // Validate dimensions are multiples of 8
    if (width % 8 !== 0 || height % 8 !== 0) {
      console.error('[Digital Human Generation API] Invalid request: dimensions must be multiples of 8');
      return NextResponse.json(
        { error: 'Width and height must be multiples of 8' },
        { status: 400 }
      );
    }

    const requestData = {
      positive_prompt: positive_prompt.trim(),
      negative_prompt: negative_prompt?.trim() || 'bright tones, overexposed, static, blurred details, subtitles, style, works, paintings, images, static, overall gray, worst quality, low quality, JPEG compression residue, ugly, incomplete, extra fingers, poorly drawn hands, poorly drawn faces, deformed, disfigured, misshapen limbs, fused fingers, still picture, messy background, three legs, many people in the background, walking backwards',
      width,
      height,
      steps,
      seed: seed || undefined,
      cfg,
      shift,
      reference_video_filename: reference_video_filename.trim(),
      audio_filename: audio_filename.trim()
    };

    logRequest(requestData);

    // 调用ComfyUI API服务
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    console.log(`[Digital Human Generation API] Calling ComfyUI service: ${comfyuiServiceUrl}/api/v1/generate-digital-human`);
    
    const comfyuiResponse = await fetch(`${comfyuiServiceUrl}/api/v1/generate-digital-human`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Digital Human Generation API] ComfyUI response status: ${comfyuiResponse.status}`);

    if (!comfyuiResponse.ok) {
      let errorMessage = `ComfyUI service error: ${comfyuiResponse.status}`;
      try {
        const errorData = await comfyuiResponse.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[Digital Human Generation API] Failed to parse error response:', parseError);
      }

      console.error(`[Digital Human Generation API] ComfyUI error: ${errorMessage}`);
      logResponse(false, undefined, errorMessage);

      return NextResponse.json(
        {
          error: 'Digital human generation service unavailable',
          message: errorMessage
        },
        { status: comfyuiResponse.status }
      );
    }

    const data = await comfyuiResponse.json();
    console.log(`[Digital Human Generation API] ComfyUI response received:`, {
      promptId: data.prompt_id,
      status: data.status,
      estimatedTime: data.estimated_time
    });

    // 验证响应格式
    if (!data.prompt_id) {
      console.error('[Digital Human Generation API] Invalid response: missing prompt_id');
      logResponse(false, undefined, 'Invalid response format');
      
      return NextResponse.json(
        { error: 'Invalid response from digital human generation service' },
        { status: 500 }
      );
    }

    logResponse(true, data.prompt_id);

    // 返回标准化的响应
    return NextResponse.json({
      prompt_id: data.prompt_id,
      status: data.status || 'pending',
      message: data.message || 'Digital human generation started',
      estimated_time: data.estimated_time || 120
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Digital Human Generation API] Unexpected error:', error);
    logResponse(false, undefined, errorMessage);

    return NextResponse.json(
      { error: 'Internal server error', message: errorMessage },
      { status: 500 }
    );
  }
} 