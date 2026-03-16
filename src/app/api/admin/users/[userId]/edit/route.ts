import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    console.log('[API] PUT /api/admin/users/[userId]/edit:', userId);

    const body = await request.json();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/profile/${userId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to update user profile:', data);
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error updating user profile:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
