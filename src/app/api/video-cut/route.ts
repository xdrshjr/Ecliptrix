import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/video-cut
 * 
 * Proxy endpoint to cut video clips through the backend service
 * 代理端点，通过后端服务切分视频片段
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Video Cut API] 接收到视频切分请求', {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent')?.slice(0, 100)
    });

    // Get the JSON data from the request
    const requestData = await request.json();
    
    // Log request details
    console.log('[Video Cut API] 请求参数', {
      taskId: requestData.task_id,
      videoUrl: requestData.video_url?.slice(0, 100) + '...',
      clipsCount: requestData.clips?.length,
      generateThumbnails: requestData.generate_thumbnails
    });

    // Validate required fields
    if (!requestData.task_id) {
      console.error('[Video Cut API] 缺少任务ID');
      return NextResponse.json(
        {
          success: false,
          message: '缺少任务ID',
          clips: [],
          total_clips: 0,
          processing_time: 0.0
        },
        { status: 400 }
      );
    }

    if (!requestData.video_url) {
      console.error('[Video Cut API] 缺少视频URL');
      return NextResponse.json(
        {
          success: false,
          message: '缺少视频URL',
          clips: [],
          total_clips: 0,
          processing_time: 0.0
        },
        { status: 400 }
      );
    }

    if (!requestData.clips || !Array.isArray(requestData.clips) || requestData.clips.length === 0) {
      console.error('[Video Cut API] 缺少切片信息');
      return NextResponse.json(
        {
          success: false,
          message: '至少需要指定一个切片',
          clips: [],
          total_clips: 0,
          processing_time: 0.0
        },
        { status: 400 }
      );
    }

    // Forward the request to the backend service
    console.log(`[Video Cut API] 转发请求到后端服务: ${BACKEND_URL}/api/video/cut`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/cut`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
      // Set a longer timeout for video processing (5 minutes)
      signal: AbortSignal.timeout(300000), // 300 seconds timeout for video cutting
    });

    console.log(`[Video Cut API] 后端响应状态: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Video Cut API] 后端服务错误: ${backendResponse.status} - ${errorText}`);
      
      return NextResponse.json(
        {
          success: false,
          message: '视频切分服务暂时不可用',
          clips: [],
          total_clips: 0,
          processing_time: 0.0,
          details: {
            status: backendResponse.status,
            statusText: backendResponse.statusText
          }
        },
        { status: backendResponse.status }
      );
    }

    const result = await backendResponse.json();
    
    // Log successful response
    if (result.success) {
      console.log('[Video Cut API] 视频切分成功', {
        taskId: requestData.task_id,
        totalClips: result.total_clips,
        processingTime: result.processing_time,
        clipsInfo: result.clips.map((clip: any) => ({
          id: clip.id,
          name: clip.name,
          fileSize: clip.file_size,
          duration: clip.duration
        })),
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('[Video Cut API] 视频切分失败', {
        taskId: requestData.task_id,
        error: result.message,
        processingTime: result.processing_time
      });
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Video Cut API] 请求处理错误:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: '内部服务器错误',
        clips: [],
        total_clips: 0,
        processing_time: 0.0,
        details: {
          error: error instanceof Error ? error.message : String(error)
        }
      },
      { status: 500 }
    );
  }
} 