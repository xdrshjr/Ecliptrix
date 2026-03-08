import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage } from '@/types';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

// 获取模型配置（优先从后端模型设置获取，回退到环境变量）
const getConfig = async () => {
  // Try to get settings from backend model settings
  try {
    const res = await fetch(`${BACKEND_URL}/api/model-settings/resolve/chat`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.api_key) {
        return {
          apiUrl: data.api_url,
          apiKey: data.api_key,
          model: data.model_name,
          temperature: data.temperature ?? 0.7,
          maxTokens: data.max_tokens ?? 2000,
        };
      }
    }
  } catch (e) {
    console.warn('[Chat API] Failed to fetch model settings from backend, falling back to env vars');
  }

  // Fallback to env vars
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  return { apiUrl, apiKey, model, temperature: 0.7, maxTokens: 2000 };
};

// 转换消息格式
const formatMessages = (messages: ChatMessage[]) => {
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));
};

// 日志记录函数
const logRequest = (messages: ChatMessage[], config: any) => {
  console.log(`[Chat API] ${new Date().toISOString()} - Incoming chat request`);
  console.log(`[Chat API] Model: ${config.model}`);
  console.log(`[Chat API] Messages count: ${messages.length}`);
  console.log(`[Chat API] Last message: ${messages[messages.length - 1]?.content?.slice(0, 100)}...`);
};

const logResponse = (success: boolean, error?: string) => {
  if (success) {
    console.log(`[Chat API] ${new Date().toISOString()} - Response completed successfully`);
  } else {
    console.error(`[Chat API] ${new Date().toISOString()} - Response failed: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { messages } = body as { messages: ChatMessage[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error('[Chat API] Invalid request: messages array is required');
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    const config = await getConfig();
    logRequest(messages, config);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(messages),
      stream: true,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };

    console.log(`[Chat API] Calling LLM API: ${config.apiUrl}/chat/completions`);

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
      console.error(`[Chat API] LLM API error: ${response.status} - ${errorText}`);
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
          console.log('[Chat API] 开始初始化流式传输连接');
          
          // 立即发送一个初始注释以建立流连接，防止代理服务器缓冲
          // 这对于生产环境中的 nginx/Apache 等反向代理至关重要
          controller.enqueue(encoder.encode(`: stream-start\n\n`));
          console.log('[Chat API] 已发送流建立信号');
          
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available');
          }

          let buffer = '';
          let totalChunks = 0;
          let lastChunkTime = Date.now();
          const startTime = Date.now();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              const totalTime = Date.now() - startTime;
              console.log(`[Chat API] 流式传输完成，总计 ${totalChunks} 个数据块，耗时 ${totalTime}ms，平均 ${totalChunks > 0 ? Math.round(totalTime / totalChunks) : 0}ms/块`);
              break;
            }

            buffer += new TextDecoder().decode(value);
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

              const data = trimmedLine.slice(6);
              if (data === '[DONE]') {
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                console.log('[Chat API] 收到完成信号 [DONE]');
                continue;
              }

              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                
                if (content) {
                  totalChunks++;
                  const currentTime = Date.now();
                  const timeSinceLastChunk = currentTime - lastChunkTime;
                  lastChunkTime = currentTime;
                  
                  const responseData = { content };
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(responseData)}\n\n`)
                  );
                  
                  // 每10个数据块记录一次详细日志，避免日志过多
                  if (totalChunks % 10 === 0 || totalChunks <= 3) {
                    console.log(`[Chat API] 已发送第 ${totalChunks} 个数据块 (间隔 ${timeSinceLastChunk}ms, 内容长度: ${content.length})`);
                  }
                }
              } catch (e) {
                console.error('[Chat API] Error parsing SSE data:', e);
              }
            }
          }

          logResponse(true);
          controller.close();
        } catch (error) {
          console.error('[Chat API] Stream error:', error);
          logResponse(false, String(error));
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        // SSE 标准头
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        
        // 防止反向代理（如 nginx）缓冲响应 - 这是生产环境流式传输的关键
        'X-Accel-Buffering': 'no',
        
        // 安全头
        'X-Content-Type-Options': 'nosniff',
        
        // CORS 头
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });

  } catch (error) {
    console.error('[Chat API] Unexpected error:', error);
    logResponse(false, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 