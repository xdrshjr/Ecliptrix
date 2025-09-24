import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

/**
 * POST /api/video/watermark-removal
 * 
 * Proxy endpoint to remove watermarks from videos through the backend service
 * 代理端点，通过后端服务去除视频水印
 */
export async function POST(request: NextRequest) {
  try {
    console.log('[Watermark Removal API] 接收到水印去除请求', {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent')?.slice(0, 100)
    });

    // Get the JSON data from the request
    const requestData = await request.json();
    
    // Log request details (without sensitive information)
    console.log('[Watermark Removal API] 请求参数', {
      taskId: requestData.task_id,
      videoUrl: requestData.video_url?.slice(0, 100) + '...',
      watermarkArea: requestData.watermark_area,
      customFilename: requestData.custom_filename,
      inpaintRadius: requestData.inpaint_radius,
      inpaintMethod: requestData.inpaint_method
    });

    // Validate required fields
    if (!requestData.task_id) {
      console.error('[Watermark Removal API] 缺少任务ID');
      return NextResponse.json(
        {
          success: false,
          message: '缺少任务ID',
          error_code: 'MISSING_TASK_ID'
        },
        { status: 400 }
      );
    }

    if (!requestData.video_url) {
      console.error('[Watermark Removal API] 缺少视频URL');
      return NextResponse.json(
        {
          success: false,
          message: '缺少视频URL',
          error_code: 'MISSING_VIDEO_URL'
        },
        { status: 400 }
      );
    }

    if (!requestData.watermark_area) {
      console.error('[Watermark Removal API] 缺少水印区域坐标');
      return NextResponse.json(
        {
          success: false,
          message: '缺少水印区域坐标',
          error_code: 'MISSING_WATERMARK_AREA'
        },
        { status: 400 }
      );
    }

    // Validate watermark area coordinates
    const { watermark_area } = requestData;
    if (!watermark_area.x1 && watermark_area.x1 !== 0 ||
        !watermark_area.y1 && watermark_area.y1 !== 0 ||
        !watermark_area.x2 ||
        !watermark_area.y2) {
      console.error('[Watermark Removal API] 水印区域坐标不完整', { watermark_area });
      return NextResponse.json(
        {
          success: false,
          message: '水印区域坐标不完整',
          error_code: 'INCOMPLETE_COORDINATES'
        },
        { status: 400 }
      );
    }

    if (watermark_area.x1 >= watermark_area.x2 || watermark_area.y1 >= watermark_area.y2) {
      console.error('[Watermark Removal API] 水印区域坐标无效', { watermark_area });
      return NextResponse.json(
        {
          success: false,
          message: '水印区域坐标无效',
          error_code: 'INVALID_COORDINATES'
        },
        { status: 400 }
      );
    }

    // Forward the request to the backend service
    console.log(`[Watermark Removal API] 转发请求到后端服务: ${BACKEND_URL}/api/video/watermark-removal`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/watermark-removal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Watermark Removal API] 后端响应状态: ${backendResponse.status}`);

    const responseData = await backendResponse.json();

    // Log response details
    if (backendResponse.ok) {
      console.log('[Watermark Removal API] 水印去除成功', {
        taskId: responseData.task_id,
        success: responseData.success,
        processingTime: responseData.processing_time,
        processedVideoUrl: responseData.processed_video_url?.slice(0, 100) + '...'
      });
    } else {
      console.error('[Watermark Removal API] 水印去除失败', {
        status: backendResponse.status,
        errorCode: responseData.error_code,
        message: responseData.message,
        details: responseData.details
      });
    }

    // Return the response from the backend service
    return NextResponse.json(responseData, { 
      status: backendResponse.status 
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Watermark Removal API] API错误:', errorMessage);
    
    return NextResponse.json(
      {
        success: false,
        message: '内部服务器错误',
        error_code: 'INTERNAL_ERROR',
        details: errorMessage
      },
      { status: 500 }
    );
  }
} 