import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';

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
      
      try {
        // Try to parse the error response as JSON to preserve error structure
        const errorData = await response.json();
        
        // Log detailed error information
        console.error('Backend error details:', {
          status: response.status,
          statusText: response.statusText,
          errorData: errorData,
          timestamp: new Date().toISOString()
        });
        
        // Check for TASK_QUEUE_MAXED error specifically
        if (errorData.message && errorData.message.includes('TASK_QUEUE_MAXED')) {
          console.warn('TASK_QUEUE_MAXED error detected, forwarding to frontend', {
            errorCode: errorData.error_code,
            message: errorData.message,
            timestamp: errorData.timestamp
          });
        }
        
        // Forward the complete error structure from backend
        return NextResponse.json(errorData, { status: response.status });
        
      } catch (parseError) {
        // Fallback to text if JSON parsing fails
        const errorText = await response.text();
        console.error('Failed to parse backend error response as JSON, falling back to text:', parseError);
        
        return NextResponse.json(
          {
            success: false,
            message: 'Failed to execute workflow via backend service',
            error: `Backend service returned ${response.status}: ${response.statusText}`,
            error_details: errorText,
            timestamp: new Date().toISOString()
          },
          { status: response.status }
        );
      }
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