import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// GET — redirects to assignments endpoint for backward compatibility
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/model-settings/assignments`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching model settings:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch model settings', assignments: [] },
      { status: 500 }
    );
  }
}
