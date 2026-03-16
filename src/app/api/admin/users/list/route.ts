import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  try {
    // Forward query parameters for pagination/filtering/sorting
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const url = `${BACKEND_URL}/api/user/list${queryString ? `?${queryString}` : ''}`;

    console.log('[API] GET /api/admin/users/list - Fetching users', { url });

    // Forward Authorization header to backend
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to fetch users from backend:', data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log('[API] Users fetched successfully');
    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error fetching users:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
