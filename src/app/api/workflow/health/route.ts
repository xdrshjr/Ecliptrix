import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * GET /api/workflow/health
 * 
 * Proxy endpoint to check workflow service health via the backend service
 */
export async function GET(request: NextRequest) {
  try {
    console.log('Checking workflow service health via backend service');
    
    // Forward the request to the backend service
    const response = await fetch(`${BACKEND_BASE_URL}/api/workflow/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    if (!response.ok) {
      console.error(`Backend workflow health request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to check workflow service health via backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
          error_details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful health check
    console.log('Workflow service health check completed successfully', {
      service_status: data.data?.status,
      available_workflows: data.data?.available_workflows
    });

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Error checking workflow service health:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while checking workflow service health',
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