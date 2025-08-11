import { NextRequest, NextResponse } from 'next/server';
import { getPolishGoalById } from '@/lib/utils/polishConfigLoader';

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

// 生成润色提示词
const generatePolishPrompt = (originalContent: string, polishStyle: string, intensity: number) => {
  const intensityLabels = ['轻度', '中度', '强度'];
  const intensityLabel = intensityLabels[intensity - 1] || '中度';

  // 从配置文件中获取润色目标
  const polishGoal = getPolishGoalById(polishStyle);
  
  if (!polishGoal) {
    console.error(`[Content Polish API] 未找到润色目标: ${polishStyle}`);
    throw new Error(`Unsupported polish style: ${polishStyle}`);
  }

  console.log(`[Content Polish API] 使用润色目标: ${polishGoal.name} (${polishStyle})`);

  // 使用配置中的提示词模板
  let basePrompt = polishGoal.prompt_template.replace(/{{originalContent}}/g, originalContent);
  
  // 如果模板中没有原始内容占位符，则手动添加
  if (!polishGoal.prompt_template.includes('{{originalContent}}') && !polishGoal.prompt_template.includes(originalContent)) {
    basePrompt = `${basePrompt}\n\n<原始内容>\n${originalContent}\n</原始内容>`;
  }

  // 根据强度级别添加额外指令
  let intensityModifier = '';
  if (intensity === 1) {
    intensityModifier = `\n\n<润色强度: ${intensityLabel}>\n请进行轻度润色，保持原文的基本结构和表达方式，仅做必要的优化。\n</润色强度>`;
  } else if (intensity === 2) {
    intensityModifier = `\n\n<润色强度: ${intensityLabel}>\n请进行中度润色，在保持原意的基础上，适度改进表达方式和语言风格。\n</润色强度>`;
  } else if (intensity === 3) {
    intensityModifier = `\n\n<润色强度: ${intensityLabel}>\n请进行强度润色，在保持核心观点的前提下，大幅优化表达方式，让内容更加出色。\n</润色强度>`;
  }

  const finalPrompt = `${basePrompt}${intensityModifier}

<重要提示>
1. 请直接返回润色后的内容，不要包含任何解释或格式标记
2. 保持原文的核心观点和主要信息
3. 确保润色后的内容符合${polishGoal.name}的要求
4. 润色程度为${intensityLabel}，请严格按照此强度进行处理
</重要提示>`;

  return finalPrompt;
};

// 转换消息格式
const formatMessages = (prompt: string) => [
  {
    role: 'user',
    content: prompt
  }
];

// 日志记录函数
const logRequest = (originalContent: string, polishStyle: string, intensity: number, taskId: string, config: any) => {
  const polishGoal = getPolishGoalById(polishStyle);
  
  console.log(`[Content Polish API] ${new Date().toISOString()} - Incoming polish request`);
  console.log(`[Content Polish API] Task ID: ${taskId}`);
  console.log(`[Content Polish API] Model: ${config.model}`);
  console.log(`[Content Polish API] Polish Style: ${polishStyle} (${polishGoal?.name || 'unknown'})`);
  console.log(`[Content Polish API] Polish Category: ${polishGoal?.category || 'unknown'}`);
  console.log(`[Content Polish API] Intensity: ${intensity}`);
  console.log(`[Content Polish API] Original content length: ${originalContent.length} characters`);
  console.log(`[Content Polish API] Content preview: ${originalContent.slice(0, 100)}...`);
  
  if (polishGoal) {
    console.log(`[Content Polish API] Using goal template: ${polishGoal.prompt_template.slice(0, 150)}...`);
  }
};

const logResponse = (success: boolean, taskId: string, polishStyle: string, error?: string) => {
  const polishGoal = getPolishGoalById(polishStyle);
  const goalName = polishGoal?.name || polishStyle;
  
  if (success) {
    console.log(`[Content Polish API] ${new Date().toISOString()} - Response completed successfully for task: ${taskId}, style: ${goalName}`);
  } else {
    console.error(`[Content Polish API] ${new Date().toISOString()} - Response failed for task: ${taskId}, style: ${goalName} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalContent, polishStyle, taskId, intensity = 2 } = body as { 
      originalContent: string; 
      polishStyle: string; 
      taskId: string;
      intensity?: number;
    };

    // 验证请求参数
    if (!originalContent || typeof originalContent !== 'string' || originalContent.trim().length === 0) {
      console.error('[Content Polish API] Invalid request: originalContent string is required');
      return NextResponse.json(
        { error: 'Original content string is required' },
        { status: 400 }
      );
    }

    if (!polishStyle || typeof polishStyle !== 'string') {
      console.error('[Content Polish API] Invalid request: polishStyle is required');
      return NextResponse.json(
        { error: 'Polish style is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Content Polish API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // 验证润色目标是否存在
    const polishGoal = getPolishGoalById(polishStyle);
    if (!polishGoal) {
      console.error(`[Content Polish API] Invalid polish style: ${polishStyle}`);
      return NextResponse.json(
        { error: `Unsupported polish style: ${polishStyle}` },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(originalContent, polishStyle, intensity, taskId, config);

    // 生成润色提示词
    const prompt = generatePolishPrompt(originalContent, polishStyle, intensity);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(prompt),
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log(`[Content Polish API] Calling LLM API: ${config.apiUrl}/chat/completions for task: ${taskId}, style: ${polishGoal.name}`);

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
      console.error(`[Content Polish API] LLM API error: ${response.status} - ${errorText} for task: ${taskId}, style: ${polishGoal.name}`);
      logResponse(false, taskId, polishStyle, `LLM API error: ${response.status}`);
      
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
                console.log(`[Content Polish API] Stream completed for task: ${taskId}, style: ${polishGoal.name}, total content length: ${totalContent.length}`);
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
                    console.log(`[Content Polish API] Streaming progress for task: ${taskId}, style: ${polishGoal.name}, content length: ${totalContent.length}`);
                  }
                }
              } catch (e) {
                console.error(`[Content Polish API] Error parsing SSE data for task: ${taskId}, style: ${polishGoal.name}:`, e);
              }
            }
          }

          logResponse(true, taskId, polishStyle);
          controller.close();
        } catch (error) {
          console.error(`[Content Polish API] Stream error for task: ${taskId}, style: ${polishGoal?.name || polishStyle}:`, error);
          logResponse(false, taskId, polishStyle, String(error));
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
    console.error('[Content Polish API] Request processing error:', error);
    const taskId = 'unknown';
    const polishStyle = 'unknown';
    logResponse(false, taskId, polishStyle, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 