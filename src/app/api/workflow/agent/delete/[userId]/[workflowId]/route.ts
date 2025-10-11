import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';

/**
 * DELETE /api/workflow/agent/delete/[userId]/[workflowId]
 * 
 * Proxy endpoint to delete agent workflow from the backend service
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { userId: string; workflowId: string } }
) {
  try {
    const { userId, workflowId } = params;
    
    console.log('[Workflow Agent Delete API] Deleting workflow:', {
      user_id: userId,
      workflow_id: workflowId,
    });
    
    // Forward the request to the backend service
    const response = await fetch(`${BACKEND_BASE_URL}/api/workflow/agent/delete/${userId}/${workflowId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    if (!response.ok) {
      console.error(`[Workflow Agent Delete API] Backend request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to delete workflow from backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
          error_details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful workflow deletion
    console.log('[Workflow Agent Delete API] Workflow deleted successfully:', {
      workflow_id: workflowId,
    });

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('[Workflow Agent Delete API] Error deleting workflow:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while deleting workflow',
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
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

