import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (taskId: string, chatContentLength: number, videoCount: number, enableVideoUnderstanding: boolean, analysisMode?: string) => {
  console.log(`[Convert To Script API] ${new Date().toISOString()} - Incoming convert to script request`);
  console.log(`[Convert To Script API] Task ID: ${taskId}`);
  console.log(`[Convert To Script API] Chat content length: ${chatContentLength}`);
  console.log(`[Convert To Script API] Video count: ${videoCount}`);
  console.log(`[Convert To Script API] Enable video understanding: ${enableVideoUnderstanding}`);
  if (analysisMode) {
    console.log(`[Convert To Script API] Analysis mode: ${analysisMode}`);
  }
};

const logResponse = (success: boolean, taskId: string, error?: string, segmentCount?: number) => {
  if (success) {
    console.log(`[Convert To Script API] ${new Date().toISOString()} - Script conversion successful for task: ${taskId}, generated ${segmentCount} segments`);
  } else {
    console.error(`[Convert To Script API] ${new Date().toISOString()} - Script conversion failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, chatContent, selectedVideos, parameters, enableVideoUnderstanding, analysisMode } = body as { 
      taskId: string; 
      chatContent: string;
      selectedVideos: any[];
      parameters: any;
      enableVideoUnderstanding: boolean;
      analysisMode?: 'quick' | 'professional';
    };

    // 验证请求参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[Convert To Script API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!chatContent || typeof chatContent !== 'string') {
      console.error('[Convert To Script API] Invalid request: chatContent is required');
      return NextResponse.json(
        { error: 'Chat content is required' },
        { status: 400 }
      );
    }

    // Python 后端要求 selectedVideos 至少包含1个视频（无论是否启用视频理解）
    if (!selectedVideos || !Array.isArray(selectedVideos) || selectedVideos.length === 0) {
      console.error('[Convert To Script API] Invalid request: selectedVideos array must contain at least one video');
      return NextResponse.json(
        { error: 'At least one video must be selected' },
        { status: 400 }
      );
    }

    if (!parameters || typeof parameters !== 'object') {
      console.error('[Convert To Script API] Invalid request: parameters object is required');
      return NextResponse.json(
        { error: 'Parameters object is required' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    logRequest(taskId, chatContent.length, selectedVideos?.length || 0, enableVideoUnderstanding, analysisMode);

    // 准备发送给Python后端的请求数据
    // 注意：Python 后端使用 VideoUnderstandingScriptRequest 模型
    // - referenceText 对应前端的 chatContent
    // - selectedVideos 必须至少包含1个视频
    // - enableVideoUnderstanding 决定是否使用视频分析数据
    // - analysisMode 决定视频分析模式（快速或专业）
    const requestData = {
      taskId: taskId,
      referenceText: chatContent,  // Python 后端使用 referenceText
      selectedVideos: selectedVideos,  // 始终发送视频列表
      parameters: parameters,
      analysisMode: analysisMode || 'quick'  // 默认快速分析
    };

    // Debug logging: print request body if needed
    if (process.env.NODE_ENV === 'development') {
      console.log('[Convert To Script API] Request data:', JSON.stringify({
        taskId: requestData.taskId,
        referenceTextLength: requestData.referenceText.length,
        referenceTextPreview: requestData.referenceText.substring(0, 100) + '...',
        selectedVideosCount: requestData.selectedVideos.length,
        selectedVideos: requestData.selectedVideos.map((v: any) => ({
          id: v.id,
          name: v.name,
          hasAnalysis: !!v.metadata?.video_analysis || !!v.analysisData
        })),
        parameters: requestData.parameters,
        analysisMode: requestData.analysisMode
      }, null, 2));
    }

    console.log(`[Convert To Script API] Calling Python backend: ${config.backendUrl}/api/convert-to-script for task: ${taskId}`);

    // 调用Python后端API
    const response = await fetch(`${config.backendUrl}/api/convert-to-script`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Convert To Script API] Backend error: ${response.status} - ${errorText}`);
      
      logResponse(false, taskId, `Backend returned ${response.status}: ${errorText}`);
      
      return NextResponse.json(
        { 
          success: false,
          error: `Backend service error: ${response.status}`,
          details: errorText 
        },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.success) {
      const errorMessage = result.error || result.message || 'Unknown error from backend';
      console.error(`[Convert To Script API] Backend returned error: ${errorMessage}`);
      
      logResponse(false, taskId, errorMessage);
      
      return NextResponse.json(
        { 
          success: false,
          error: errorMessage,
          details: result
        },
        { status: 500 }
      );
    }

    logResponse(true, taskId, undefined, result.segments?.length);

    return NextResponse.json({
      success: true,
      segments: result.segments,
      metadata: result.metadata || {}
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Convert To Script API] Request processing error:', error);
    
    return NextResponse.json(
      { 
        success: false,
        error: 'Internal server error',
        details: errorMessage 
      },
      { status: 500 }
    );
  }
}

