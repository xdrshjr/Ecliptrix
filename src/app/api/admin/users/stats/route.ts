import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] GET /api/admin/users/stats - Fetching user stats');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/stats`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to fetch user stats:', data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error fetching user stats:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
