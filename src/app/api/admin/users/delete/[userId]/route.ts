import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  try {
    const { userId } = params;
    console.log('[API] DELETE /api/admin/users/delete/[userId] - Deleting user:', userId);

    // Call the backend API to delete user
    const response = await fetch(`${BACKEND_URL}/api/user/delete/${userId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[API] Failed to delete user:', {
        status: response.status,
        userId,
        detail: data.detail,
        error: data
      });
      
      return NextResponse.json(
        { 
          success: false, 
          message: data.detail || 'Failed to delete user',
        },
        { status: response.status }
      );
    }

    console.log('[API] User deleted successfully:', {
      userId,
      timestamp: data.timestamp
    });
    
    return NextResponse.json({
      success: true,
      message: data.message || 'User deleted successfully',
      timestamp: data.timestamp
    });

  } catch (error) {
    console.error('[API] Error deleting user:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error',
      },
      { status: 500 }
    );
  }
}

