import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    console.log('[API] POST /api/admin/users/[userId]/reset-password:', userId);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    // Body is optional (may contain new_password)
    let body: string | undefined;
    try {
      const parsed = await request.json();
      body = JSON.stringify(parsed);
    } catch {
      // No body or invalid JSON - that's fine, backend handles optional body
      body = JSON.stringify({});
    }

    const response = await fetch(`${BACKEND_URL}/api/user/reset-password/${userId}`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to reset password:', data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error resetting password:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
