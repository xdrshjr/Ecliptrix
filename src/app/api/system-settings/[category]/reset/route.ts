import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// POST reset all settings in a category to defaults
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category } = await params;
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/api/system-settings/${category}/reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error resetting category settings:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to reset category settings' },
      { status: 500 }
    );
  }
}
