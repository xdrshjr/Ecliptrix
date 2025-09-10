import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (taskId: string, materialsCount: number) => {
  console.log(`[AI Mixed Editing API] ${new Date().toISOString()} - Incoming AI mixed editing request`);
  console.log(`[AI Mixed Editing API] Task ID: ${taskId}`);
  console.log(`[AI Mixed Editing API] Materials count: ${materialsCount}`);
};

const logResponse = (success: boolean, taskId: string, error?: string, timelineData?: any) => {
  if (success) {
    console.log(`[AI Mixed Editing API] ${new Date().toISOString()} - AI mixed editing completed successfully for task: ${taskId}`);
    if (timelineData) {
      console.log(`[AI Mixed Editing API] Generated timeline tracks: ${timelineData.tracks?.length || 0}`);
      console.log(`[AI Mixed Editing API] Generated timeline items: ${timelineData.tracks?.reduce((sum: number, track: any) => sum + (track.items?.length || 0), 0) || 0}`);
    }
  } else {
    console.error(`[AI Mixed Editing API] ${new Date().toISOString()} - AI mixed editing failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, materials } = body as { 
      taskId: string; 
      materials: any[]; 
    };

    // 验证请求参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[AI Mixed Editing API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!materials || !Array.isArray(materials) || materials.length === 0) {
      console.error('[AI Mixed Editing API] Invalid request: materials array is required and must not be empty');
      return NextResponse.json(
        { error: 'Materials array is required and must not be empty' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    logRequest(taskId, materials.length);

    // 准备发送给Python后端的请求数据
    const requestData = {
      taskId: taskId,
      materials: materials
    };

    console.log(`[AI Mixed Editing API] Calling Python backend: ${config.backendUrl}/api/ai-mixed-editing for task: ${taskId}`);

    // 调用Python后端API
    const response = await fetch(`${config.backendUrl}/api/ai-mixed-editing`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Mixed Editing API] Backend error: ${response.status} - ${errorText} for task: ${taskId}`);
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

    // 验证后端响应
    if (!result.success) {
      console.error('[AI Mixed Editing API] Backend returned failure:', result.message);
      logResponse(false, taskId, result.message);
      
      return NextResponse.json(
        { 
          error: result.message || 'AI mixed editing failed',
          details: result.details 
        },
        { status: 400 }
      );
    }

    logResponse(true, taskId, undefined, result.timelineData);

    // 返回成功响应
    return NextResponse.json({
      success: true,
      message: result.message || 'AI mixed editing completed successfully',
      timelineData: result.timelineData
    });

  } catch (error) {
    console.error('[AI Mixed Editing API] Request processing error:', error);
    
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