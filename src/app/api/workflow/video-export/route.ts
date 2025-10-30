import { NextRequest, NextResponse } from 'next/server';

// Get backend service configuration
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// Logging functions
const logRequest = (nodeId: string, videoUrls: string | string[]) => {
  console.log(`[Video Export API] ${new Date().toISOString()} - Incoming Video Export request`);
  console.log(`[Video Export API] Node ID: ${nodeId}`);
  const urlsArray = Array.isArray(videoUrls) ? videoUrls : [videoUrls];
  console.log(`[Video Export API] Video URLs count: ${urlsArray.length}`);
};

const logResponse = (success: boolean, nodeId: string, error?: string, materialsCount?: number) => {
  if (success) {
    console.log(`[Video Export API] ${new Date().toISOString()} - Video Export completed successfully for node: ${nodeId}`);
    if (materialsCount !== undefined) {
      console.log(`[Video Export API] Converted ${materialsCount} videos to materials`);
    }
  } else {
    console.error(`[Video Export API] ${new Date().toISOString()} - Video Export failed for node: ${nodeId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      nodeId, 
      taskId,
      inputs,
      config 
    } = body as { 
      nodeId: string;
      taskId: string;
      inputs: {
        videoUrls?: string | string[];
        inputFormat?: string;
      };
      config?: {
        videoUrls?: string | string[];
        inputFormat?: string;
      };
    };

    // Validate request parameters
    if (!nodeId || typeof nodeId !== 'string') {
      console.error('[Video Export API] Invalid request: nodeId is required');
      return NextResponse.json(
        { error: 'Node ID is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Video Export API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Get video URLs from either inputs or config
    const videoUrls = inputs?.videoUrls || config?.videoUrls;
    
    if (!videoUrls) {
      console.error('[Video Export API] Invalid request: videoUrls is required');
      return NextResponse.json(
        { error: 'Video URLs are required' },
        { status: 400 }
      );
    }

    const backendConfig = getBackendConfig();
    logRequest(nodeId, videoUrls);

    // Prepare request data for Python backend
    const requestData = {
      nodeId,
      taskId,
      videoUrls,
      inputFormat: inputs?.inputFormat || config?.inputFormat || 'array'
    };

    console.log(`[Video Export API] Calling Python backend: ${backendConfig.backendUrl}/api/workflow/video-export for node: ${nodeId}`);

    // Call Python backend API
    const response = await fetch(`${backendConfig.backendUrl}/api/workflow/video-export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Video Export API] Backend error: ${response.status} - ${errorText} for node: ${nodeId}`);
      logResponse(false, nodeId, `Backend error: ${response.status}`);
      
      // Try to parse error response
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }
      
      return NextResponse.json(
        { 
          error: `Backend service error: ${response.status}`,
          details: errorData 
        },
        { status: response.status }
      );
    }

    const result = await response.json();

    // Validate backend response
    if (!result.success) {
      console.error('[Video Export API] Backend returned failure:', result.message);
      logResponse(false, nodeId, result.message);
      
      return NextResponse.json(
        { 
          error: result.message || 'Video export failed',
          details: result.details 
        },
        { status: 400 }
      );
    }

    logResponse(true, nodeId, undefined, result.materials?.length);

    // Return success response
    return NextResponse.json({
      success: true,
      message: result.message || 'Video export completed successfully',
      materials: result.materials
    });

  } catch (error) {
    console.error('[Video Export API] Request processing error:', error);
    
    // Check if it's a JSON parse error
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return NextResponse.json(
        { error: 'Invalid JSON format in request body' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

