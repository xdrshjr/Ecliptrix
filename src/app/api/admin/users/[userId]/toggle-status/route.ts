import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    console.log('[API] POST /api/admin/users/[userId]/toggle-status:', userId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/toggle-status/${userId}`, {
      method: 'POST',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to toggle user status:', data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error toggling user status:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
