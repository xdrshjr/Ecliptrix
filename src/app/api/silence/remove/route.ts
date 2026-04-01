import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/silence/remove
 *
 * Proxy endpoint for silence removal.
 * Forwards the request to the FastAPI backend which starts an async task
 * and returns a task_id for progress polling.
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Silence Remove API] Received silence removal request', {
      timestamp: new Date().toISOString(),
    });

    const requestData = await request.json();

    console.log('[Silence Remove API] Request params', {
      videoUrl: requestData.video_url?.slice(0, 120),
      segmentsCount: requestData.segments_to_remove?.length ?? 0,
      preservedGap: requestData.preserved_gap,
      fadeDuration: requestData.fade_duration,
    });

    // Basic validation
    if (!requestData.video_url) {
      console.error('[Silence Remove API] Missing video_url');
      return NextResponse.json(
        {
          success: false,
          message: 'Missing video_url',
          error_code: 'MISSING_VIDEO_URL',
        },
        { status: 400 }
      );
    }

    if (
      !requestData.segments_to_remove ||
      !Array.isArray(requestData.segments_to_remove) ||
      requestData.segments_to_remove.length === 0
    ) {
      console.error('[Silence Remove API] Missing or empty segments_to_remove');
      return NextResponse.json(
        {
          success: false,
          message: 'Missing or empty segments_to_remove',
          error_code: 'MISSING_SEGMENTS',
        },
        { status: 400 }
      );
    }

    // Forward to backend
    console.log(
      `[Silence Remove API] Forwarding to backend: ${BACKEND_URL}/api/silence/remove`
    );

    const backendResponse = await fetch(
      `${BACKEND_URL}/api/silence/remove`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      }
    );

    console.log(
      `[Silence Remove API] Backend response status: ${backendResponse.status}`
    );

    const responseData = await backendResponse.json();

    if (backendResponse.ok) {
      console.log('[Silence Remove API] Task accepted', {
        taskId: responseData.data?.task_id,
      });
    } else {
      console.error('[Silence Remove API] Request failed', {
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
    console.error('[Silence Remove API] Internal error:', errorMessage);

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
