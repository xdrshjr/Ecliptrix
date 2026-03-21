import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await params;

    const backendResponse = await fetch(`${BACKEND_URL}/api/storyboard/batch-video/status/${packId}`, {
      method: 'GET',
    });

    const result = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(result, { status: backendResponse.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Storyboard Batch Video Status API] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error', error_code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
