import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * GET /api/silence/status/[taskId]
 *
 * Proxy endpoint for polling silence removal task progress.
 * Forwards the request to the FastAPI backend and returns the response as-is.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;

    console.log('[Silence Status API] Polling task status', {
      taskId,
      timestamp: new Date().toISOString(),
    });

    if (!taskId) {
      console.error('[Silence Status API] Missing taskId');
      return NextResponse.json(
        {
          success: false,
          message: 'Missing taskId',
          error_code: 'MISSING_TASK_ID',
        },
        { status: 400 }
      );
    }

    // Forward to backend
    const backendUrl = `${BACKEND_URL}/api/silence/status/${taskId}`;
    console.log(
      `[Silence Status API] Forwarding to backend: ${backendUrl}`
    );

    const backendResponse = await fetch(backendUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    console.log(
      `[Silence Status API] Backend response status: ${backendResponse.status}`
    );

    const responseData = await backendResponse.json();

    if (backendResponse.ok) {
      console.log('[Silence Status API] Status retrieved', {
        taskId,
        status: responseData.data?.status,
        progress: responseData.data?.progress,
      });
    } else {
      console.error('[Silence Status API] Status query failed', {
        status: backendResponse.status,
        errorCode: responseData.error_code ?? responseData.detail?.error_code,
        message: responseData.message ?? responseData.detail?.message,
      });
    }

    return NextResponse.json(responseData, {
      status: backendResponse.status,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    console.error('[Silence Status API] Internal error:', errorMessage);

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error_code: 'INTERNAL_ERROR',
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
