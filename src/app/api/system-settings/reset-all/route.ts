import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// POST reset ALL settings across all categories to defaults
export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization') || '';
    const response = await fetch(`${BACKEND_URL}/api/system-settings/reset-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error resetting all settings:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to reset all settings' },
      { status: 500 }
    );
  }
}
