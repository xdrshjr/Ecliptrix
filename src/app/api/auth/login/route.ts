import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/auth/login
 * 
 * Simple authentication endpoint with hardcoded admin credentials
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Auth API] Login request received');
    
    const body = await request.json();
    const { username, password } = body;

    // Log request details (without password)
    console.log('[Auth API] Login attempt:', {
      username,
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    });

    // Validate input
    if (!username || !password) {
      console.warn('[Auth API] Missing credentials');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Username and password are required' 
        },
        { status: 400 }
      );
    }

    // Simple hardcoded authentication
    if (username === 'admin' && password === 'admin') {
      console.log('[Auth API] Login successful for user:', username);
      
      const user = {
        id: '1',
        username: 'admin',
        email: 'admin@ecliptrix.com',
        avatar: null
      };

      return NextResponse.json({
        success: true,
        user,
        message: 'Login successful'
      });
    } else {
      console.warn('[Auth API] Invalid credentials for user:', username);
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid username or password' 
        },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('[Auth API] Login error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
} 