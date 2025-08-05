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

// 转换消息格式
const formatMessages = (content: string) => [
  {
    role: 'system',
    content: 'You are a helpful AI assistant specialized in video editing and content creation. Provide detailed, practical advice and suggestions for video editing tasks, workflows, and creative processes.'
  },
  {
    role: 'user',
    content: content
  }
];

// 日志记录函数
const logRequest = (content: string, config: any) => {
  console.log(`[Video Editing API] ${new Date().toISOString()} - Incoming video editing request`);
  console.log(`[Video Editing API] Model: ${config.model}`);
  console.log(`[Video Editing API] Content length: ${content.length} characters`);
  console.log(`[Video Editing API] Content preview: ${content.slice(0, 150)}...`);
};

const logResponse = (success: boolean, error?: string) => {
  if (success) {
    console.log(`[Video Editing API] ${new Date().toISOString()} - Response completed successfully`);
  } else {
    console.error(`[Video Editing API] ${new Date().toISOString()} - Response failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content } = body as { content: string };

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.error('[Video Editing API] Invalid request: content string is required');
      return NextResponse.json(
        { error: 'Content string is required' },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(content, config);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(content),
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log(`[Video Editing API] Calling LLM API: ${config.apiUrl}/chat/completions`);

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
      console.error(`[Video Editing API] LLM API error: ${response.status} - ${errorText}`);
      logResponse(false, `LLM API error: ${response.status}`);
      
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
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                
                if (content) {
                  const responseData = { content };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`)
                  );
                }
              } catch (e) {
                console.error('[Video Editing API] Error parsing SSE data:', e);
              }
            }
          }

          logResponse(true);
          controller.close();
        } catch (error) {
          console.error('[Video Editing API] Stream error:', error);
          logResponse(false, String(error));
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
    console.error('[Video Editing API] Request processing error:', error);
    logResponse(false, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 