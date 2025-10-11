import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';

/**
 * POST /api/workflow/agent/save
 * 
 * Proxy endpoint to save agent workflow to the backend service
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Workflow Agent Save API] Saving agent workflow to backend service');
    
    // Parse request body
    const body = await request.json();
    
    console.log('[Workflow Agent Save API] Request data:', {
      workflow_id: body.workflow_id,
      workflow_name: body.workflow_name,
      user_id: body.user_id,
      nodes_count: body.nodes?.length || 0,
      connections_count: body.connections?.length || 0,
    });
    
    // Forward the request to the backend service
    const response = await fetch(`${BACKEND_BASE_URL}/api/workflow/agent/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    if (!response.ok) {
      console.error(`[Workflow Agent Save API] Backend request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to save workflow to backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
          error_details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful workflow save
    console.log('[Workflow Agent Save API] Workflow saved successfully:', {
      workflow_id: data.data?.workflow_id,
      version: data.data?.version,
    });

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('[Workflow Agent Save API] Error saving workflow:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while saving workflow',
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
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

