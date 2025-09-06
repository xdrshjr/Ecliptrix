import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/workflow/execute
 * 
 * Proxy endpoint to execute a workflow via the backend service
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('Executing workflow via backend service', {
      workflow_id: body.workflow_id,
      parameter_count: body.parameters?.length || 0,
      task_id: body.task_id
    });
    
    // Forward the request to the backend service
    const response = await fetch(`${BACKEND_BASE_URL}/api/workflow/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Add timeout to prevent hanging requests
      signal: AbortSignal.timeout(60000), // 60 seconds timeout for workflow execution
    });

    if (!response.ok) {
      console.error(`Backend workflow execution request failed: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to execute workflow via backend service',
          error: `Backend service returned ${response.status}: ${response.statusText}`,
          error_details: errorText
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Log successful workflow execution
    console.log('Workflow execution initiated successfully', {
      workflow_id: body.workflow_id,
      task_id: data.data?.task_id,
      runninghub_task_id: data.data?.runninghub_task_id,
      status: data.data?.status
    });

    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('Error executing workflow:', error);
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error while executing workflow',
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