import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await params;

    const backendResponse = await fetch(`${BACKEND_URL}/api/storyboard/packs/${packId}`, {
      method: 'GET',
    });

    const result = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(result, { status: backendResponse.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Storyboard Pack GET API] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error', error_code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await params;

    const backendResponse = await fetch(`${BACKEND_URL}/api/storyboard/packs/${packId}`, {
      method: 'DELETE',
    });

    const result = await backendResponse.json();

    if (!backendResponse.ok) {
      return NextResponse.json(result, { status: backendResponse.status });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Storyboard Pack DELETE API] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error', error_code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
