import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * GET /api/workflow/status/[taskId]
 * 
 * Proxy endpoint to check workflow task status via the backend service
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  try {
    const { taskId } = params;
    
    console.log('Checking workflow task status via backend service', { taskId });
    
    // Forward the request to the backend service
    const response = await fetch(`${BACKEND_BASE_URL}/api/workflow/status/${taskId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    if (!response.ok) {
      console.error(`Backend workflow status request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to check workflow status via backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
          error_details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful status check
    console.log('Workflow status retrieved successfully', {
      taskId,
      status: data.data?.status,
      runninghub_task_id: data.data?.runninghub_task_id
    });

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Error checking workflow status:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while checking workflow status',
        error: error instanceof Error ? error.message : 'Unknown error',
        error_code: 'PROXY_ERROR'
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}