import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/auth/validate-session
 * 
 * Validate user session token to check if it's still active
 * 验证用户会话令牌，检查是否仍然有效
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Session Validation API] 接收到会话验证请求', {
      timestamp: new Date().toISOString()
    });

    // Get the request body
    const body = await request.json();
    const { user_id, session_token } = body;

    // Log request details
    console.log('[Session Validation API] 验证会话', {
      user_id,
      hasSessionToken: !!session_token,
      timestamp: new Date().toISOString()
    });

    // Validate input
    if (!user_id || !session_token) {
      console.warn('[Session Validation API] 缺少必要参数');
      return NextResponse.json(
        { 
          success: false,
          valid: false,
          error: 'User ID and session token are required' 
        },
        { status: 400 }
      );
    }

    // Forward the request to the backend service
    console.log(`[Session Validation API] 转发验证请求到后端服务: ${BACKEND_URL}/api/auth/validate-session`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/auth/validate-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id, session_token }),
      signal: AbortSignal.timeout(10000), // 10 seconds timeout
    });

    console.log(`[Session Validation API] 后端响应状态: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorData = await backendResponse.json().catch(() => ({}));
      console.error(`[Session Validation API] 后端服务验证失败: ${backendResponse.status}`, {
        error: errorData,
        user_id
      });
      
      return NextResponse.json(
        {
          success: false,
          valid: false,
          error: errorData.detail?.message || errorData.message || 'Session validation failed',
          error_code: errorData.detail?.error_code || 'VALIDATION_FAILED'
        },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    
    // Log validation result
    console.log('[Session Validation API] 会话验证结果', {
      user_id,
      valid: result.valid,
      reason: result.reason,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      valid: result.valid,
      reason: result.reason,
      message: result.message
    });

  } catch (error) {
    console.error('[Session Validation API] 会话验证请求处理错误:', error);
    
    return NextResponse.json(
      {
        success: false,
        valid: false,
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

