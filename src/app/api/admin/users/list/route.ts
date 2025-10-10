import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function GET(request: NextRequest) {
  try {
    console.log('[API] GET /api/admin/users/list - Fetching all users');

    // Call the backend API to get all users
    const response = await fetch(`${BACKEND_URL}/api/user/list`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to fetch users from backend:', data);
      return NextResponse.json(
        { 
          success: false, 
          message: data.detail || 'Failed to fetch users',
          users: [],
          total_count: 0
        },
        { status: response.status }
      );
    }

    console.log('[API] Users fetched successfully:', {
      total_count: data.total_count,
      timestamp: data.timestamp
    });
    
    return NextResponse.json({
      success: true,
      message: data.message || 'Users fetched successfully',
      total_count: data.total_count,
      users: data.users,
      timestamp: data.timestamp
    });

  } catch (error) {
    console.error('[API] Error fetching users:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error',
        users: [],
        total_count: 0
      },
      { status: 500 }
    );
  }
}

