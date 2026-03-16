import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    // Forward query parameters (page, page_size)
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const url = `${BACKEND_URL}/api/user/login-history/${userId}${queryString ? `?${queryString}` : ''}`;

    console.log('[API] GET /api/admin/users/[userId]/login-history:', userId);

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
      console.error('[API] Failed to fetch login history:', data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error fetching login history:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
