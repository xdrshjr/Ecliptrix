import { NextRequest, NextResponse } from 'next/server';

const BACKEND_BASE_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const { searchParams } = new URL(request.url);
    const runninghubTaskId = searchParams.get('runninghub_task_id');

    if (!runninghubTaskId) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'runninghub_task_id parameter is required',
          error_code: 'MISSING_PARAMETER'
        },
        { status: 400 }
      );
    }
    
    // Forward the request to the backend service
    const response = await fetch(
      `${BACKEND_BASE_URL}/api/flux/status/${taskId}?runninghub_task_id=${runninghubTaskId}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await response.json();
    
    return NextResponse.json(data, { 
      status: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  } catch (error) {
    console.error('FLUX status check proxy error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
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