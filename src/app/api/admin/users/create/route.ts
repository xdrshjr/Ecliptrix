import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    console.log('[API] POST /api/admin/users/create - Creating new user');

    const body = await request.json();
    
    // Log the request data (excluding password for security)
    console.log('[API] User creation request:', {
      username: body.username,
      email: body.email,
      is_admin: body.is_admin,
      user_role: body.user_role,
      is_active: body.is_active
    });

    // Call the backend API to create user
    const response = await fetch(`${BACKEND_URL}/api/user/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to create user:', {
        status: response.status,
        detail: data.detail,
        error: data
      });
      
      return NextResponse.json(
        { 
          success: false, 
          message: data.detail || 'Failed to create user',
        },
        { status: response.status }
      );
    }

    console.log('[API] User created successfully:', {
      user_id: data.user?.id,
      username: data.user?.username,
      timestamp: data.timestamp
    });
    
    return NextResponse.json({
      success: true,
      message: data.message || 'User created successfully',
      user: data.user,
      timestamp: data.timestamp
    });

  } catch (error) {
    console.error('[API] Error creating user:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

