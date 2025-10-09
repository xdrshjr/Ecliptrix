import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/auth/login
 * 
 * Proxy endpoint to authenticate users through the backend service
 * 代理端点，通过后端服务进行用户认证
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Auth API] 接收到用户登录请求', {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent')?.slice(0, 100)
    });

    // Get the request body
    const body = await request.json();
    const { username, password } = body;

    // Log request details (without password)
    console.log('[Auth API] 登录尝试', {
      username,
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent'),
      ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    });

    // Validate input
    if (!username || !password) {
      console.warn('[Auth API] 缺少登录凭据');
      return NextResponse.json(
        { 
          success: false, 
          error: 'Username and password are required' 
        },
        { status: 400 }
      );
    }

    // Forward the request to the backend service
    console.log(`[Auth API] 转发登录请求到后端服务: ${BACKEND_URL}/api/auth/login`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    console.log(`[Auth API] 后端响应状态: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      console.error(`[Auth API] 后端服务登录失败: ${backendResponse.status}`, {
        error: errorData,
        username
      });
      
      return NextResponse.json(
        {
          success: false,
          error: errorData.detail?.message || errorData.message || 'Authentication failed',
          error_code: errorData.detail?.error_code || 'AUTHENTICATION_FAILED'
        },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    
    // Log successful response
    if (result.success && result.user) {
      console.log('[Auth API] 用户登录成功', {
        username: result.user.username,
        userId: result.user.id,
        isAdmin: result.user.is_admin,
        hasSessionToken: !!result.session_token,
        timestamp: new Date().toISOString()
      });

      // Transform the response to match frontend expectations
      const transformedUser = {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email,
        avatar: result.user.avatar_url
      };

      return NextResponse.json({
        success: true,
        user: transformedUser,
        session_token: result.session_token,
        message: result.message || 'Login successful'
      });
    } else {
      console.error('[Auth API] 后端返回登录失败', {
        username,
        result
      });
      
      return NextResponse.json(
        {
          success: false,
          error: result.message || 'Authentication failed'
        },
        { status: 401 }
      );
    }

  } catch (error) {
    console.error('[Auth API] 登录请求处理错误:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        error_code: 'INTERNAL_ERROR'
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