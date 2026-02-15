import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * GET /api/storage/user-materials
 *
 * Get user's uploaded materials from storage with pagination
 * 获取用户上传的所有素材，支持分页
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    const page = searchParams.get('page') || '1';
    const pageSize = searchParams.get('page_size') || '20';
    const materialType = searchParams.get('material_type') || '';

    console.log('[User Materials API] 接收到查询请求', {
      userId,
      page,
      pageSize,
      materialType,
      timestamp: new Date().toISOString()
    });

    if (!userId) {
      console.warn('[User Materials API] 缺少user_id参数');
      return NextResponse.json(
        {
          success: false,
          message: 'User ID is required',
          materials: [],
          total: 0,
          page: parseInt(page),
          page_size: parseInt(pageSize),
          total_pages: 0
        },
        { status: 400 }
      );
    }

    // Build query parameters
    const queryParams = new URLSearchParams({
      user_id: userId,
      page,
      page_size: pageSize,
    });

    if (materialType) {
      queryParams.append('material_type', materialType);
    }

    // Forward request to backend
    const backendUrl = `${BACKEND_URL}/api/storage/user-materials?${queryParams.toString()}`;
    console.log(`[User Materials API] 转发请求到后端: ${backendUrl}`);

    const backendResponse = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(30000), // 30 seconds timeout
    });

    console.log(`[User Materials API] 后端响应状态: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('[User Materials API] 后端请求失败', {
        status: backendResponse.status,
        statusText: backendResponse.statusText,
        error: errorText
      });

      return NextResponse.json(
        {
          success: false,
          message: `Backend request failed: ${backendResponse.statusText}`,
          materials: [],
          total: 0,
          page: parseInt(page),
          page_size: parseInt(pageSize),
          total_pages: 0
        },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();

    console.log('[User Materials API] 查询成功', {
      success: result.success,
      total: result.total,
      page: result.page,
      returned: result.materials?.length || 0
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('[User Materials API] 请求异常', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });

    return NextResponse.json(
      {
        success: false,
        message: `查询素材失败: ${error instanceof Error ? error.message : String(error)}`,
        materials: [],
        total: 0,
        page: 1,
        page_size: 20,
        total_pages: 0
      },
      { status: 500 }
    );
  }
}
