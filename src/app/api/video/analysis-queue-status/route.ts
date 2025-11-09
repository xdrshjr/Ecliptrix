import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * GET /api/video/analysis-queue-status
 * 
 * Proxy endpoint to get video analysis queue status from backend service
 * 代理端点，从后端服务获取视频解析队列状态
 */
export async function GET(request: NextRequest) {
  try {
    console.log('[Video Analysis Queue Status API] 接收到队列状态查询请求', {
      timestamp: new Date().toISOString()
    });

    // Proxy request to backend service
    const response = await fetch(`${BACKEND_URL}/api/video/analysis-queue-status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[Video Analysis Queue Status API] 后端服务返回错误', {
        status: response.status,
        error: data.detail || data.message
      });
      
      return NextResponse.json(
        { 
          success: false,
          error: data.detail || data.message || 'Failed to get queue status' 
        },
        { status: response.status }
      );
    }

    console.log('[Video Analysis Queue Status API] 队列状态查询成功', {
      queueName: data.queue_info?.queue_name,
      currentProcessing: data.queue_info?.current_processing,
      queuedCount: data.queue_info?.queued_count,
      maxConcurrent: data.queue_info?.max_concurrent
    });

    return NextResponse.json(data);
    
  } catch (error) {
    console.error('[Video Analysis Queue Status API] 请求失败:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

