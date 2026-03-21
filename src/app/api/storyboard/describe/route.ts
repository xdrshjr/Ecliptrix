import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const backendResponse = await fetch(`${BACKEND_URL}/api/storyboard/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const result = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(result, { status: backendResponse.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Storyboard Describe API] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error', error_code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
