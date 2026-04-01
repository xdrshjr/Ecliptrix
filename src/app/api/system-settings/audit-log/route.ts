import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// GET audit log entries with optional filtering
export async function GET(request: NextRequest) {
  try {
    const authorization = request.headers.get('authorization') || '';
    // Forward query params (category, limit, offset) to backend
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const url = `${BACKEND_URL}/api/system-settings/audit-log${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authorization,
      },
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error('[API] Error fetching audit log:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch audit log', logs: [], total: 0 },
      { status: 500 }
    );
  }
}
