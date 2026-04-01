import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/silence/detect
 *
 * Proxy endpoint for silence detection.
 * Forwards the request to the FastAPI backend and returns the response as-is.
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Silence Detect API] Received silence detection request', {
      timestamp: new Date().toISOString(),
    });

    const requestData = await request.json();

    console.log('[Silence Detect API] Request params', {
      videoUrl: requestData.video_url?.slice(0, 120),
      noiseThreshold: requestData.noise_threshold,
      minSilenceDuration: requestData.min_silence_duration,
    });

    // Basic validation
    if (!requestData.video_url) {
      console.error('[Silence Detect API] Missing video_url');
      return NextResponse.json(
        {
          success: false,
          message: 'Missing video_url',
          error_code: 'MISSING_VIDEO_URL',
        },
        { status: 400 }
      );
    }

    // Forward to backend
    console.log(
      `[Silence Detect API] Forwarding to backend: ${BACKEND_URL}/api/silence/detect`
    );

    const backendResponse = await fetch(
      `${BACKEND_URL}/api/silence/detect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestData),
      }
    );

    console.log(
      `[Silence Detect API] Backend response status: ${backendResponse.status}`
    );

    const responseData = await backendResponse.json();

    if (backendResponse.ok) {
      console.log('[Silence Detect API] Detection succeeded', {
        segmentCount: responseData.data?.silence_segments?.length ?? 0,
        audioDuration: responseData.data?.audio_duration,
        silencePercentage: responseData.data?.silence_percentage,
      });
    } else {
      console.error('[Silence Detect API] Detection failed', {
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
    console.error('[Silence Detect API] Internal error:', errorMessage);

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
