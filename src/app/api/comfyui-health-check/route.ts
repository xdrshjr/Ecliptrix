import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/comfyui-health-check
 * 
 * Proxy endpoint to check ComfyUI service health
 * Calls the ComfyUI API service health endpoint
 */
export async function GET(request: NextRequest) {
  try {
    // Get the ComfyUI API service URL from environment
    const comfyuiServiceUrl = process.env.COMFY_API_SERVICE_URL || 'http://localhost:8001';
    
    console.log(`[ComfyUI Health Check API] Checking health at: ${comfyuiServiceUrl}/api/v1/health`);
    
    // Forward the request to the ComfyUI API service
    const response = await fetch(`${comfyuiServiceUrl}/api/v1/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Set timeout to prevent hanging requests
      signal: AbortSignal.timeout(5000), // 5 seconds timeout
    });

    console.log(`[ComfyUI Health Check API] ComfyUI service response status: ${response.status}`);

    if (!response.ok) {
      console.error(`ComfyUI health check failed: ${response.status} ${response.statusText}`);
      
      let errorMessage = 'ComfyUI service unavailable';
      try {
        const errorData = await response.json();
        errorMessage = errorData.detail || errorData.message || errorMessage;
      } catch (parseError) {
        console.error('[ComfyUI Health Check API] Failed to parse error response:', parseError);
      }

      return NextResponse.json(
        {
          status: 'unhealthy',
          comfyui_status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: errorMessage,
        },
        { status: 503 }
      );
    }

    const data = await response.json();
    console.log('[ComfyUI Health Check API] Health check successful:', {
      status: data.status,
      comfyui_status: data.comfyui_status,
      version: data.version
    });

    // Return the health status with consistent format
    return NextResponse.json({
      status: data.status || 'healthy',
      comfyui_status: data.comfyui_status || 'healthy',
      timestamp: new Date().toISOString(),
      version: data.version
    });

  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      console.error('ComfyUI health check timeout:', error);
      return NextResponse.json(
        {
          status: 'error',
          comfyui_status: 'timeout',
          timestamp: new Date().toISOString(),
          error: 'Health check timeout',
        },
        { status: 504 }
      );
    }

    console.error('Error checking ComfyUI health:', error);
    return NextResponse.json(
      {
        status: 'error',
        comfyui_status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
} 