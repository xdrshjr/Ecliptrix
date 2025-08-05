import { NextRequest, NextResponse } from 'next/server';

// 获取环境变量配置
const getConfig = () => {
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  return { apiUrl, apiKey, model };
};

// 转换消息格式，包含当前MD内容作为上下文
const formatMessages = (message: string, currentContent: string) => [
  {
    role: 'system',
    content: `You are an AI assistant specialized in video editing and content creation. You help users with their video editing projects by providing suggestions, improvements, and content generation.

Current project context:
${currentContent ? `The user is currently working on a video editing project with the following content:\n\n${currentContent}` : 'The user is starting a new video editing project.'}

Please provide helpful, practical advice and suggestions related to video editing, content creation, project planning, and workflow optimization. When appropriate, you can suggest additions or improvements to their project documentation.`
  },
  {
    role: 'user',
    content: message
  }
];

// 日志记录函数
const logRequest = (message: string, currentContent: string, taskId: string, config: any) => {
  console.log(`[Video Editing Chat API] ${new Date().toISOString()} - Incoming chat request`);
  console.log(`[Video Editing Chat API] Task ID: ${taskId}`);
  console.log(`[Video Editing Chat API] Model: ${config.model}`);
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

    const config = getConfig();
    logRequest(message, currentContent || '', taskId, config);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(message, currentContent || ''),
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log(`[Video Editing Chat API] Calling LLM API: ${config.apiUrl}/chat/completions for task: ${taskId}`);

    // 调用LLM API
    const response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Video Editing Chat API] LLM API error: ${response.status} - ${errorText} for task: ${taskId}`);
      logResponse(false, taskId, `LLM API error: ${response.status}`);
      
      return NextResponse.json(
        { error: `LLM API error: ${response.status}` },
        { status: response.status }
      );
    }

    // 创建流式响应
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available');
          }

          let buffer = '';
          let totalContent = '';
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += new TextDecoder().decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

              const data = trimmedLine.slice(6);
              if (data === '[DONE]') {
                console.log(`[Video Editing Chat API] Stream completed for task: ${taskId}, total content length: ${totalContent.length}`);
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                
                if (content) {
                  totalContent += content;
                  const responseData = { content };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`)
                  );
                  
                  // 定期记录流式传输进度
                  if (totalContent.length % 100 === 0) {
                    console.log(`[Video Editing Chat API] Streaming progress for task: ${taskId}, content length: ${totalContent.length}`);
                  }
                }
              } catch (e) {
                console.error(`[Video Editing Chat API] Error parsing SSE data for task: ${taskId}:`, e);
              }
            }
          }

          logResponse(true, taskId);
          controller.close();
        } catch (error) {
          console.error(`[Video Editing Chat API] Stream error for task: ${taskId}:`, error);
          logResponse(false, taskId, String(error));
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
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