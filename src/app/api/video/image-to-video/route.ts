import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// Request logging
const logRequest = (data: any) => {
  console.log(`[Image-to-Video API] Request:`, {
    ...data,
    timestamp: new Date().toISOString()
  });
};

// Response logging
const logResponse = (data: any, error?: string) => {
  console.log(`[Image-to-Video API] Response:`, {
    success: !error,
    ...data,
    error,
    timestamp: new Date().toISOString()
  });
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      image_url,
      image_data,
      image_filename,
      effect,
      duration = 5.0,
      task_id,
      custom_filename,
      ken_burns_direction = 'zoom_in',
      pan_direction = 'left_to_right',
      focus_x = 0.5,
      focus_y = 0.5
    } = body;

    // Validate request parameters
    if (!image_url && !image_data) {
      console.error('[Image-to-Video API] Invalid request: either image_url or image_data is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Either image URL or image data is required',
          error_code: 'MISSING_IMAGE_SOURCE'
        },
        { status: 400 }
      );
    }

    if (!effect || !['static', 'ken_burns', 'pan'].includes(effect)) {
      console.error('[Image-to-Video API] Invalid request: invalid effect type');
      return NextResponse.json(
        { 
          success: false,
          message: 'Effect must be one of: static, ken_burns, pan',
          error_code: 'INVALID_EFFECT'
        },
        { status: 400 }
      );
    }

    if (typeof duration !== 'number' || duration < 1 || duration > 30) {
      console.error('[Image-to-Video API] Invalid request: invalid duration');
      return NextResponse.json(
        { 
          success: false,
          message: 'Duration must be between 1 and 30 seconds',
          error_code: 'INVALID_DURATION'
        },
        { status: 400 }
      );
    }

    const requestData = { 
      image_url: image_url?.trim(),
      image_data,
      image_filename,
      effect,
      duration,
      task_id,
      custom_filename,
      ken_burns_direction,
      pan_direction,
      focus_x,
      focus_y
    };
    logRequest(requestData);

    // Call backend service
    console.log(`[Image-to-Video API] Calling backend service: ${BACKEND_URL}/api/video/image-to-video`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/image-to-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Image-to-Video API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Image-to-Video API] Backend error: ${backendResponse.status} - ${errorText}`);
      
      logResponse(
        { status: backendResponse.status },
        `Backend service error: ${backendResponse.status} - ${errorText}`
      );

      return NextResponse.json(
        { 
          success: false,
          message: 'Image-to-video conversion service unavailable',
          error_code: 'SERVICE_UNAVAILABLE',
          details: errorText
        },
        { status: backendResponse.status }
      );
    }

    const responseData = await backendResponse.json();
    
    logResponse(responseData);

    return NextResponse.json(responseData);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Image-to-Video API] Error:', errorMessage);
    
    logResponse(
      { error: errorMessage },
      `API error: ${errorMessage}`
    );

    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        error_code: 'INTERNAL_ERROR',
        details: errorMessage
      },
      { status: 500 }
    );
  }
} 