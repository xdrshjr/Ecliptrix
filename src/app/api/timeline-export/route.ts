import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (taskId: string, trackCount: number, materialCount: number) => {
  console.log(`[Timeline Export API] ${new Date().toISOString()} - Incoming timeline export request`);
  console.log(`[Timeline Export API] Task ID: ${taskId}`);
  console.log(`[Timeline Export API] Track count: ${trackCount}`);
  console.log(`[Timeline Export API] Material count: ${materialCount}`);
};

const logResponse = (success: boolean, error?: string, fileName?: string) => {
  if (success) {
    console.log(`[Timeline Export API] ${new Date().toISOString()} - Export completed successfully`);
    if (fileName) {
      console.log(`[Timeline Export API] Generated file: ${fileName}`);
    }
  } else {
    console.error(`[Timeline Export API] ${new Date().toISOString()} - Export failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, timelineState, materials, exportData } = body;

    // 验证必需参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[Timeline Export API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!timelineState || !timelineState.tracks) {
      console.error('[Timeline Export API] Invalid request: timelineState with tracks is required');
      return NextResponse.json(
        { error: 'Timeline state with tracks is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(materials)) {
      console.error('[Timeline Export API] Invalid request: materials array is required');
      return NextResponse.json(
        { error: 'Materials array is required' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    logRequest(taskId, timelineState.tracks.length, materials.length);

    // 准备发送给后端的请求数据（保持camelCase，让Pydantic处理转换）
    const requestData = {
      taskId: taskId,
      timelineState: timelineState,
      materials: materials,
      exportData: exportData
    };

    console.log(`[Timeline Export API] Calling backend: ${config.backendUrl}/api/timeline/export`);

    // 调用后端API
    const response = await fetch(`${config.backendUrl}/api/timeline/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Timeline Export API] Backend error: ${response.status} - ${errorText}`);
      logResponse(false, `Backend error: ${response.status}`);
      
      return NextResponse.json(
        { error: `Backend service error: ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();

    // 验证后端响应
    if (!result.success) {
      console.error('[Timeline Export API] Backend returned failure:', result.message);
      logResponse(false, result.message);
      
      return NextResponse.json(
        { 
          error: result.message || 'Export failed',
          details: result.details 
        },
        { status: 400 }
      );
    }

    logResponse(true, undefined, result.file_name);

    // 返回成功响应
    return NextResponse.json({
      success: true,
      message: result.message || 'Timeline exported successfully',
      fileName: result.fileName || result.file_name, // 支持两种命名方式
      downloadUrl: result.downloadUrl || result.download_url, // 支持两种命名方式
      data: result.data
    });

  } catch (error) {
    console.error('[Timeline Export API] Request processing error:', error);
    logResponse(false, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}