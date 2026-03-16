import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    console.log('[API] DELETE /api/admin/users/delete/[userId] - Deleting user:', userId);

    // Forward Authorization header to backend
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/delete/${userId}`, {
      method: 'DELETE',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to delete user:', data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log('[API] User deleted successfully:', userId);
    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error deleting user:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
