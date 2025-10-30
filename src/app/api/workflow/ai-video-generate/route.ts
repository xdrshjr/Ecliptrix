import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (nodeId: string, inputs: any) => {
  console.log(`[AI Video Generate API] ${new Date().toISOString()} - Incoming AI Video Generate request`);
  console.log(`[AI Video Generate API] Node ID: ${nodeId}`);
  console.log(`[AI Video Generate API] Inputs:`, {
    hasText: !!inputs.textInput,
    hasVideo: !!inputs.videoInput,
    hasAudio: !!inputs.audioInput,
    hasImage: !!inputs.imageInput,
  });
};

const logResponse = (success: boolean, nodeId: string, error?: string, timelineData?: any) => {
  if (success) {
    console.log(`[AI Video Generate API] ${new Date().toISOString()} - AI Video Generate completed successfully for node: ${nodeId}`);
    if (timelineData) {
      console.log(`[AI Video Generate API] Generated timeline tracks: ${timelineData.tracks?.length || 0}`);
    }
  } else {
    console.error(`[AI Video Generate API] ${new Date().toISOString()} - AI Video Generate failed for node: ${nodeId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      nodeId, 
      taskId,
      inputs,
      config 
    } = body as { 
      nodeId: string;
      taskId: string;
      inputs: {
        textInput?: string;
        videoInput?: string;
        audioInput?: string;
        imageInput?: string;
        textInputFormat?: string;
        videoInputFormat?: string;
        audioInputFormat?: string;
        imageInputFormat?: string;
      };
      config?: {
        systemPrompt?: string;
        temperature?: number;
        maxTokens?: number;
      };
    };

    // 验证请求参数
    if (!nodeId || typeof nodeId !== 'string') {
      console.error('[AI Video Generate API] Invalid request: nodeId is required');
      return NextResponse.json(
        { error: 'Node ID is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[AI Video Generate API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // 验证至少有一个输入
    if (!inputs || (!inputs.textInput && !inputs.videoInput && !inputs.audioInput && !inputs.imageInput)) {
      console.error('[AI Video Generate API] Invalid request: at least one input is required');
      return NextResponse.json(
        { error: 'At least one input (text, video, audio, or image) is required' },
        { status: 400 }
      );
    }

    const backendConfig = getBackendConfig();
    logRequest(nodeId, inputs);

    // 准备发送给Python后端的请求数据
    const requestData = {
      nodeId,
      taskId,
      inputs,
      config: config || {}
    };

    console.log(`[AI Video Generate API] Calling Python backend: ${backendConfig.backendUrl}/api/workflow/ai-video-generate for node: ${nodeId}`);

    // 调用Python后端API
    const response = await fetch(`${backendConfig.backendUrl}/api/workflow/ai-video-generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Video Generate API] Backend error: ${response.status} - ${errorText} for node: ${nodeId}`);
      logResponse(false, nodeId, `Backend error: ${response.status}`);
      
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
      console.error('[AI Video Generate API] Backend returned failure:', result.message);
      logResponse(false, nodeId, result.message);
      
      return NextResponse.json(
        { 
          error: result.message || 'AI video generate failed',
          details: result.details 
        },
        { status: 400 }
      );
    }

    logResponse(true, nodeId, undefined, result.timelineData);

    // 返回成功响应
    return NextResponse.json({
      success: true,
      message: result.message || 'AI video generate completed successfully',
      timelineData: result.timelineData
    });

  } catch (error) {
    console.error('[AI Video Generate API] Request processing error:', error);
    
    // 检查是否是JSON解析错误
    if (error instanceof SyntaxError && error.message.includes('JSON')) {
      return NextResponse.json(
        { error: 'Invalid JSON format in request body' },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

