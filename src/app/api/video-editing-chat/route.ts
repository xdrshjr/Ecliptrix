import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage } from '@/types';
import { buildEditingChatSystemPrompt } from '@/lib/video-editing-chat/buildEditingChatSystemPrompt';

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

// 转换消息格式，添加视频编辑系统提示
//
// 系统提示由 buildEditingChatSystemPrompt() 统一生成（见
// `src/lib/video-editing-chat/buildEditingChatSystemPrompt.ts`），保证不论
// 用户是第几轮提问，AI 都能按统一的六大职责给出一致建议。Spec：
// docs/plans/video-agent-prompt-persistence/spec.md §2.6。
const formatMessages = (messages: ChatMessage[]) => {
  const systemMessage = {
    role: 'system',
    content: buildEditingChatSystemPrompt(),
  };

  return [
    systemMessage,
    ...messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))
  ];
};

// 日志记录函数
const logRequest = (taskId: string, messages: ChatMessage[], config: any) => {
  console.log(`[Video Editing Chat API] ${new Date().toISOString()} - 收到视频编辑聊天请求`);
  console.log(`[Video Editing Chat API] Task ID: ${taskId}`);
  console.log(`[Video Editing Chat API] Model: ${config.model}`);
  console.log(`[Video Editing Chat API] Messages count: ${messages.length}`);
  if (messages.length > 0) {
    const lastMessage = messages[messages.length - 1];
    console.log(`[Video Editing Chat API] Last message role: ${lastMessage.role}`);
    console.log(`[Video Editing Chat API] Last message preview: ${lastMessage.content.slice(0, 100)}${lastMessage.content.length > 100 ? '...' : ''}`);
  }
};

const logResponse = (taskId: string, success: boolean, error?: string) => {
  if (success) {
    console.log(`[Video Editing Chat API] ${new Date().toISOString()} - Task ${taskId} 响应成功完成`);
  } else {
    console.error(`[Video Editing Chat API] ${new Date().toISOString()} - Task ${taskId} 响应失败: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  let taskId = 'unknown';

  try {
    const body = await request.json();
    const {
      taskId: reqTaskId,
      messages,
    } = body as {
      taskId: string;
      messages: ChatMessage[];
    };
    taskId = reqTaskId || 'unknown';

    // 验证请求参数
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error(`[Video Editing Chat API] Task ${taskId} - 无效请求：需要 messages 数组`);
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(taskId, messages, config);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(messages),
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log(`[Video Editing Chat API] Task ${taskId} - 调用 LLM API: ${config.apiUrl}/chat/completions`);

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
      console.error(`[Video Editing Chat API] Task ${taskId} - LLM API 错误: ${response.status} - ${errorText}`);
      logResponse(taskId, false, `LLM API error: ${response.status}`);

      return NextResponse.json(
        { error: `LLM API error: ${response.status}`, details: errorText },
        { status: response.status }
      );
    }

    // 创建流式响应（普通对话模式）
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log(`[Video Editing Chat API] Task ${taskId} - 开始初始化流式传输连接`);

          // 立即发送一个初始注释以建立流连接，防止代理服务器缓冲
          // 这对于生产环境中的 nginx/Apache 等反向代理至关重要
          controller.enqueue(encoder.encode(`: stream-start\n\n`));
          console.log(`[Video Editing Chat API] Task ${taskId} - 已发送流建立信号`);

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('No reader available from LLM API');
          }

          let buffer = '';
          let totalChunks = 0;
          let lastChunkTime = Date.now();
          const startTime = Date.now();

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              const totalTime = Date.now() - startTime;
              console.log(`[Video Editing Chat API] Task ${taskId} - 流式传输完成，总计 ${totalChunks} 个数据块，耗时 ${totalTime}ms，平均 ${totalChunks > 0 ? Math.round(totalTime / totalChunks) : 0}ms/块`);
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
                console.log(`[Video Editing Chat API] Task ${taskId} - 收到完成信号 [DONE]`);
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
                    console.log(`[Video Editing Chat API] Task ${taskId} - 已发送第 ${totalChunks} 个数据块 (间隔 ${timeSinceLastChunk}ms, 内容长度: ${content.length})`);
                  }
                }
              } catch (e) {
                console.error(`[Video Editing Chat API] Task ${taskId} - SSE 数据解析错误:`, e);
              }
            }
          }

          logResponse(taskId, true);
          controller.close();
        } catch (error) {
          console.error(`[Video Editing Chat API] Task ${taskId} - 流式传输错误:`, error);
          logResponse(taskId, false, String(error));
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
    console.error(`[Video Editing Chat API] Task ${taskId} - 意外错误:`, error);
    logResponse(taskId, false, String(error));

    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
