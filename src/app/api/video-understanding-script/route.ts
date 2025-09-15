import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (taskId: string, videoCount: number, referenceTextLength: number) => {
  console.log(`[Video Understanding Script API] ${new Date().toISOString()} - Incoming video understanding script request`);
  console.log(`[Video Understanding Script API] Task ID: ${taskId}`);
  console.log(`[Video Understanding Script API] Video count: ${videoCount}`);
  console.log(`[Video Understanding Script API] Reference text length: ${referenceTextLength}`);
};

const logResponse = (success: boolean, taskId: string, error?: string, segmentCount?: number) => {
  if (success) {
    console.log(`[Video Understanding Script API] ${new Date().toISOString()} - Video understanding script successful for task: ${taskId}, generated ${segmentCount} segments`);
  } else {
    console.error(`[Video Understanding Script API] ${new Date().toISOString()} - Video understanding script failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, selectedVideos, referenceText, parameters } = body as { 
      taskId: string; 
      selectedVideos: any[];
      referenceText: string;
      parameters: any;
    };

    // 验证请求参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[Video Understanding Script API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!selectedVideos || !Array.isArray(selectedVideos) || selectedVideos.length === 0) {
      console.error('[Video Understanding Script API] Invalid request: selectedVideos array is required and must not be empty');
      return NextResponse.json(
        { error: 'Selected videos array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!parameters || typeof parameters !== 'object') {
      console.error('[Video Understanding Script API] Invalid request: parameters object is required');
      return NextResponse.json(
        { error: 'Parameters object is required' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    logRequest(taskId, selectedVideos.length, referenceText?.length || 0);

    // 准备发送给Python后端的请求数据
    const requestData = {
      taskId: taskId,
      selectedVideos: selectedVideos,
      referenceText: referenceText || '',
      parameters: parameters
    };

    // Debug logging: print request body if needed
    if (process.env.NODE_ENV === 'development') {
      console.log('[Video Understanding Script API] Request data:', JSON.stringify(requestData, null, 2));
    }

    console.log(`[Video Understanding Script API] Calling Python backend: ${config.backendUrl}/api/video-understanding-script for task: ${taskId}`);

    // 调用Python后端API
    const response = await fetch(`${config.backendUrl}/api/video-understanding-script`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Video Understanding Script API] Backend error: ${response.status} - ${errorText} for task: ${taskId}`);
      logResponse(false, taskId, `Backend error: ${response.status}`);
      
      // 尝试解析错误响应
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        errorData = { message: errorText };
      }
      
      return NextResponse.json(
        { 
          error: `Backend service error: ${response.status}`,
          details: errorData 
        },
        { status: response.status }
      );
    }

    const result = await response.json();

    // Debug logging: print response body if needed
    if (process.env.NODE_ENV === 'development') {
      console.log('[Video Understanding Script API] Response data:', JSON.stringify(result, null, 2));
    }

    // 验证后端响应
    if (!result.success) {
      console.error('[Video Understanding Script API] Backend returned failure:', result.error || result.message);
      logResponse(false, taskId, result.error || result.message);
      
      return NextResponse.json(
        { 
          error: result.error || result.message || 'Video understanding script generation failed',
          details: result.details 
        },
        { status: 400 }
      );
    }

    logResponse(true, taskId, undefined, result.segments?.length);

    // 返回成功响应
    return NextResponse.json({
      success: true,
      segments: result.segments || [],
      metadata: result.metadata || {},
      message: result.message || 'Video understanding script generated successfully'
    });

  } catch (error) {
    console.error('[Video Understanding Script API] Request processing error:', error);
    
    // 检查是否是JSON解析错误
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return NextResponse.json(
        { error: 'Invalid JSON format in request body' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 