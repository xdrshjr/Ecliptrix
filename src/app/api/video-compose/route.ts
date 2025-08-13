import { NextRequest, NextResponse } from 'next/server';

// 后端服务配置
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 日志记录函数
const logRequest = (requestData: any) => {
  console.log(`[Video Compose API] ${new Date().toISOString()} - Video composition request`);
  console.log(`[Video Compose API] Task ID: ${requestData.task_id || 'N/A'}`);
  console.log(`[Video Compose API] Aspect ratio: ${requestData.aspect_ratio || 'default (will use output_resolution)'}`);
  console.log(`[Video Compose API] Video items count: ${requestData.video_items?.length || 0}`);
  console.log(`[Video Compose API] Audio items count: ${requestData.audio_items?.length || 0}`);
  console.log(`[Video Compose API] Subtitle items count: ${requestData.subtitle_items?.length || 0}`);
  console.log(`[Video Compose API] Total duration: ${requestData.total_duration || 0}s`);
  console.log(`[Video Compose API] Output resolution: ${requestData.output_resolution?.width || 1920}x${requestData.output_resolution?.height || 1080}`);
  console.log(`[Video Compose API] Output FPS: ${requestData.output_fps || 30}`);
  console.log(`[Video Compose API] Output format: ${requestData.output_format || 'mp4'}`);
  
  // Log aspect ratio usage details
  if (requestData.aspect_ratio) {
    console.log(`[Video Compose API] Using aspect ratio: ${requestData.aspect_ratio} (backend will calculate resolution automatically)`);
  } else {
    console.log(`[Video Compose API] No aspect ratio specified, using fixed resolution: ${requestData.output_resolution?.width || 1920}x${requestData.output_resolution?.height || 1080}`);
  }
};

const logResponse = (success: boolean, compositionId?: string, status?: string, error?: string) => {
  if (success) {
    console.log(`[Video Compose API] ${new Date().toISOString()} - Video composition started successfully`);
    console.log(`[Video Compose API] Composition ID: ${compositionId || 'N/A'}`);
    console.log(`[Video Compose API] Status: ${status || 'N/A'}`);
  } else {
    console.error(`[Video Compose API] ${new Date().toISOString()} - Video composition failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      task_id, 
      aspect_ratio, // Add aspect ratio extraction
      video_items, 
      audio_items, 
      subtitle_items, 
      total_duration, 
      output_resolution, 
      output_fps, 
      output_format 
    } = body;

    // 验证请求参数
    if (!task_id || typeof task_id !== 'string') {
      console.error('[Video Compose API] Invalid request: task_id is required');
      return NextResponse.json(
        { 
          success: false,
          message: 'Task ID is required',
          data: null
        },
        { status: 400 }
      );
    }

    if (!video_items || !Array.isArray(video_items) || video_items.length === 0) {
      console.error('[Video Compose API] Invalid request: video_items is required and must be a non-empty array');
      return NextResponse.json(
        { 
          success: false,
          message: 'Video items are required and must be a non-empty array',
          data: null
        },
        { status: 400 }
      );
    }

    if (typeof total_duration !== 'number' || total_duration <= 0) {
      console.error('[Video Compose API] Invalid request: total_duration must be a positive number');
      return NextResponse.json(
        { 
          success: false,
          message: 'Total duration must be a positive number',
          data: null
        },
        { status: 400 }
      );
    }

    // 验证video_items格式
    for (const item of video_items) {
      if (!item.id || !item.name || !item.url || typeof item.start_time !== 'number' || typeof item.duration !== 'number') {
        console.error('[Video Compose API] Invalid video item format');
        return NextResponse.json(
          { 
            success: false,
            message: 'Each video item must have id, name, url, start_time, and duration',
            data: null
          },
          { status: 400 }
        );
      }
    }

    // 验证audio_items格式（如果存在）
    if (audio_items && Array.isArray(audio_items)) {
      for (const item of audio_items) {
        if (!item.id || !item.name || !item.url || typeof item.start_time !== 'number' || typeof item.duration !== 'number') {
          console.error('[Video Compose API] Invalid audio item format');
          return NextResponse.json(
            { 
              success: false,
              message: 'Each audio item must have id, name, url, start_time, and duration',
              data: null
            },
            { status: 400 }
          );
        }
      }
    }

    const requestData = { 
      task_id,
      aspect_ratio, // Include aspect ratio in backend request
      video_items,
      audio_items: audio_items || [],
      subtitle_items: subtitle_items || [],
      total_duration,
      output_resolution: output_resolution || { width: 1920, height: 1080 },
      output_fps: output_fps || 30,
      output_format: output_format || 'mp4'
    };
    logRequest(requestData);

    // 调用后端服务 (异步处理，立即返回)
    console.log(`[Video Compose API] Calling backend service: ${BACKEND_URL}/api/video/compose`);
    
    const backendResponse = await fetch(`${BACKEND_URL}/api/video/compose`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    console.log(`[Video Compose API] Backend response status: ${backendResponse.status}`);

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error(`[Video Compose API] Backend error: ${backendResponse.status} - ${errorText}`);
      logResponse(false, undefined, undefined, `Backend error: ${backendResponse.status}`);
      
      return NextResponse.json(
        { 
          success: false,
          message: 'Video composition service temporarily unavailable',
          data: null
        },
        { status: 500 }
      );
    }

    const result = await backendResponse.json();
    
    // 记录响应结果
    if (result.success) {
      logResponse(true, result.composition_id, result.status);
    } else {
      logResponse(false, undefined, undefined, result.message);
    }

    return NextResponse.json(result);

  } catch (error) {
    console.error('[Video Compose API] Request processing error:', error);
    logResponse(false, undefined, undefined, String(error));
    
    return NextResponse.json(
      { 
        success: false,
        message: 'Internal server error',
        data: null
      },
      { status: 500 }
    );
  }
} 