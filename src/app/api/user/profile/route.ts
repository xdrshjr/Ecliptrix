import { NextRequest, NextResponse } from 'next/server';

// Mock user data - in a real app, this would come from a database
const mockUsers = new Map([
  ['admin', {
    id: '550e8400-e29b-41d4-a716-446655440000',
    username: 'admin',
    email: 'admin@ecliptrix.com',
    fullName: 'System Administrator',
    avatar: null,
    avatarUrl: null,
    isActive: true,
    isAdmin: true,
    createdAt: '2023-12-01T10:00:00.000Z',
    updatedAt: '2023-12-01T12:00:00.000Z',
    lastLoginAt: '2023-12-01T12:00:00.000Z'
  }]
]);

export async function GET(request: NextRequest) {
  try {
    console.log('[API] GET /api/user/profile - Fetching user profile');

    // In a real application, you would get the user ID from the session/token
    // For this demo, we'll use the admin user
    const userId = 'admin';
    const user = mockUsers.get(userId);

    if (!user) {
      console.log('[API] User not found:', userId);
      return NextResponse.json(
        { 
          success: false, 
          message: 'User not found' 
        },
        { status: 404 }
      );
    }

    console.log('[API] User profile fetched successfully:', user.username);
    
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        avatar: user.avatar,
        avatarUrl: user.avatarUrl,
      },
      message: 'Profile fetched successfully'
    });

  } catch (error) {
    console.error('[API] Error fetching user profile:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    console.log('[API] PUT /api/user/profile - Updating user profile');

    const body = await request.json();
    const { username, email, fullName, avatarUrl } = body;

    // Validate required fields
    if (!username) {
      console.log('[API] Missing required field: username');
      return NextResponse.json(
        { 
          success: false, 
          message: 'Username is required' 
        },
        { status: 400 }
      );
    }

    // In a real application, you would get the user ID from the session/token
    // For this demo, we'll use the admin user
    const userId = 'admin';
    const existingUser = mockUsers.get(userId);

    if (!existingUser) {
      console.log('[API] User not found for update:', userId);
      return NextResponse.json(
        { 
          success: false, 
          message: 'User not found' 
        },
        { status: 404 }
      );
    }

    // Update user data
    const updatedUser = {
      ...existingUser,
      username,
      email: email || existingUser.email,
      fullName: fullName || existingUser.fullName,
      avatarUrl: avatarUrl || existingUser.avatarUrl,
      updatedAt: new Date().toISOString()
    };

    // Save updated user (in a real app, this would be saved to database)
    mockUsers.set(userId, updatedUser);

    console.log('[API] User profile updated successfully:', updatedUser.username);

    return NextResponse.json({
      success: true,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        email: updatedUser.email,
        fullName: updatedUser.fullName,
        avatar: updatedUser.avatar,
        avatarUrl: updatedUser.avatarUrl,
      },
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('[API] Error updating user profile:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error' 
      },
      { status: 500 }
    );
  }
} 