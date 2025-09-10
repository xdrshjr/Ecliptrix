import { NextRequest, NextResponse } from 'next/server';

// 获取后端服务配置
const getBackendConfig = () => {
  const backendUrl = process.env.BACKEND_SERVICE_URL || 'http://localhost:8000';
  return { backendUrl };
};

// 日志记录函数
const logRequest = (message: string, currentContent: string, taskId: string) => {
  console.log(`[Video Editing Chat API] ${new Date().toISOString()} - Incoming chat request`);
  console.log(`[Video Editing Chat API] Task ID: ${taskId}`);
  console.log(`[Video Editing Chat API] Message length: ${message.length} characters`);
  console.log(`[Video Editing Chat API] Message preview: ${message.slice(0, 100)}...`);
  console.log(`[Video Editing Chat API] Current content length: ${currentContent.length} characters`);
  console.log(`[Video Editing Chat API] Current content preview: ${currentContent.slice(0, 100)}...`);
};

const logResponse = (success: boolean, taskId: string, error?: string) => {
  if (success) {
    console.log(`[Video Editing Chat API] ${new Date().toISOString()} - Response completed successfully for task: ${taskId}`);
  } else {
    console.error(`[Video Editing Chat API] ${new Date().toISOString()} - Response failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, currentContent, taskId } = body as { 
      message: string; 
      currentContent: string; 
      taskId: string; 
    };

    // 验证请求参数
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      console.error('[Video Editing Chat API] Invalid request: message string is required');
      return NextResponse.json(
        { error: 'Message string is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Video Editing Chat API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    const config = getBackendConfig();
    logRequest(message, currentContent || '', taskId);

    // 准备发送给Python后端的请求数据
    const requestData = {
      message: message.trim(),
      currentContent: currentContent || '',
      taskId: taskId
    };

    console.log(`[Video Editing Chat API] Calling Python backend: ${config.backendUrl}/api/video-editing-chat for task: ${taskId}`);

    // 调用Python后端API
    const response = await fetch(`${config.backendUrl}/api/video-editing-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Video Editing Chat API] Backend error: ${response.status} - ${errorText} for task: ${taskId}`);
      logResponse(false, taskId, `Backend error: ${response.status}`);
      
      return NextResponse.json(
        { error: `Backend service error: ${response.status}` },
        { status: response.status }
      );
    }

    // 检查响应是否为流式响应
    if (!response.body) {
      const errorMsg = 'No response body from backend';
      console.error(`[Video Editing Chat API] ${errorMsg} for task: ${taskId}`);
      logResponse(false, taskId, errorMsg);
      
      return NextResponse.json(
        { error: 'Backend service error' },
        { status: 500 }
      );
    }

    // 创建流式响应，直接转发Python后端的流
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No response body reader available');
          }

          const decoder = new TextDecoder();

          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              logResponse(true, taskId);
              controller.close();
              break;
            }

            // 直接转发从Python后端接收到的数据
            const chunk = decoder.decode(value, { stream: true });
            controller.enqueue(new TextEncoder().encode(chunk));
          }

        } catch (streamError) {
          console.error(`[Video Editing Chat API] Stream processing error for task ${taskId}:`, streamError);
          logResponse(false, taskId, String(streamError));
          controller.error(streamError);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'  // Disable nginx buffering
      },
    });

  } catch (error) {
    console.error('[Video Editing Chat API] Request processing error:', error);
    const taskId = 'unknown';
    logResponse(false, taskId, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}