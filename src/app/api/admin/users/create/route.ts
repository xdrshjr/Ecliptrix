import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    console.log('[API] POST /api/admin/users/create - Creating new user');

    const body = await request.json();

    // Forward Authorization header to backend
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const authHeader = request.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await fetch(`${BACKEND_URL}/api/user/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to create user:', data);
      return NextResponse.json(data, { status: response.status });
    }

    console.log('[API] User created successfully');
    return NextResponse.json(data);

  } catch (error) {
    console.error('[API] Error creating user:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}
