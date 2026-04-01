import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// PUT update a single setting by category and key
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ category: string; key: string }> }
) {
  try {
    const { category, key } = await params;
    const body = await request.json();
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/api/system-settings/${category}/${key}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error updating setting:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update setting' },
      { status: 500 }
    );
  }
}
