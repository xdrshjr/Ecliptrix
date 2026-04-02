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

// 生成多目标润色提示词
const generateMultiTargetPolishPrompt = (originalContent: string, polishStyles: string[], intensity: number, chatContext?: string) => {
  const intensityLabels = ['轻度', '中度', '强度', '深度', '极度'];
  const intensityLabel = intensityLabels[intensity - 1] || '中度';

  // 获取所有选中的润色目标
  const polishGoals = polishStyles.map(styleId => getPolishGoalById(styleId)).filter(Boolean);
  
  if (polishGoals.length === 0) {
    throw new Error('No valid polish goals found');
  }

  console.log(`[Multi-Target Polish API] 使用润色目标:`, polishGoals.map(g => `${g!.name} (${g!.id})`));

  // 合并所有润色目标的要求
  const combinedRequirements = polishGoals.map((goal, index) => 
    `${index + 1}. ${goal!.name}: ${goal!.description}\n   要求: ${goal!.prompt_template.replace(/请.*?：/, '').replace(/{{originalContent}}/g, '').trim()}`
  ).join('\n\n');

  // 根据强度级别设置润色程度
  let intensityDescription = '';
  switch (intensity) {
    case 1:
      intensityDescription = '轻度润色：保持原文的基本结构和表达方式，仅做必要的优化和调整。';
      break;
    case 2:
      intensityDescription = '中度润色：在保持原意的基础上，适度改进表达方式和语言风格。';
      break;
    case 3:
      intensityDescription = '强度润色：在保持核心观点的前提下，大幅优化表达方式，让内容更加出色。';
      break;
    case 4:
      intensityDescription = '深度润色：深度重构内容结构和表达方式，同时保持核心思想不变。';
      break;
    case 5:
      intensityDescription = '极度润色：全面升级内容的表达方式、结构布局和感染力，实现质的飞跃。';
      break;
    default:
      intensityDescription = '中度润色：在保持原意的基础上，适度改进表达方式和语言风格。';
  }

  // 构建对话上下文部分（可选）
  const chatContextSection = chatContext ? `
<对话上下文>
以下是与用户的对话记录，请参考这些对话内容来更好地理解润色需求和背景：

${chatContext}
</对话上下文>
` : '';

  const finalPrompt = `你是一个专业的内容润色专家。请根据以下要求对内容进行润色：

<润色强度: ${intensityLabel}>
${intensityDescription}
</润色强度>

<润色目标>
请同时满足以下所有润色目标：

${combinedRequirements}
</润色目标>
${chatContextSection}
<原始内容>
${originalContent}
</原始内容>

<重要要求>
1. 必须同时满足上述所有润色目标的要求
2. 严格按照"${intensityLabel}"强度进行润色
3. 保持原文的核心观点和主要信息不变
4. 直接返回润色后的内容，不要包含任何解释或格式标记
5. 确保润色后的内容自然流畅，避免生硬拼凑
6. 各个润色目标的要求要有机融合，形成统一的风格${chatContext ? '\n7. 参考对话上下文中的讨论内容，使润色结果与对话主题和用户意图保持一致' : ''}
</重要要求>`;

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
const logRequest = (originalContent: string, polishStyles: string[], intensity: number, taskId: string, config: any) => {
  console.log(`[Multi-Target Polish API] 接收到润色请求`, {
    taskId,
    contentLength: originalContent.length,
    polishStylesCount: polishStyles.length,
    polishStyles,
    intensity,
    model: config.model,
    timestamp: new Date().toISOString(),
    contentPreview: originalContent.substring(0, 100) + (originalContent.length > 100 ? '...' : '')
  });
};

const logResponse = (taskId: string, polishStyles: string[], intensity: number, success: boolean, error?: any) => {
  if (success) {
    console.log(`[Multi-Target Polish API] 润色响应成功 - Task: ${taskId}, Styles: [${polishStyles.join(', ')}], Intensity: ${intensity}`);
  } else {
    console.error(`[Multi-Target Polish API] 润色响应失败 - Task: ${taskId}, Styles: [${polishStyles.join(', ')}], Intensity: ${intensity} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalContent, polishStyles, taskId, intensity = 2, chatContext } = body as {
      originalContent: string;
      polishStyles: string[];
      taskId: string;
      intensity?: number;
      chatContext?: string;
    };

    // 验证请求参数
    if (!originalContent || typeof originalContent !== 'string' || originalContent.trim().length === 0) {
      console.error('[Multi-Target Polish API] Invalid request: originalContent string is required');
      return NextResponse.json(
        { error: 'Original content string is required' },
        { status: 400 }
      );
    }

    if (!polishStyles || !Array.isArray(polishStyles) || polishStyles.length === 0) {
      console.error('[Multi-Target Polish API] Invalid request: polishStyles array is required');
      return NextResponse.json(
        { error: 'Polish styles array is required and cannot be empty' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Multi-Target Polish API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (intensity < 1 || intensity > 5) {
      console.error('[Multi-Target Polish API] Invalid request: intensity must be between 1 and 5');
      return NextResponse.json(
        { error: 'Intensity must be between 1 and 5' },
        { status: 400 }
      );
    }

    // 验证所有润色目标是否存在
    const invalidStyles = polishStyles.filter(styleId => !getPolishGoalById(styleId));
    if (invalidStyles.length > 0) {
      console.error(`[Multi-Target Polish API] Invalid polish styles: ${invalidStyles.join(', ')}`);
      return NextResponse.json(
        { error: `Unsupported polish styles: ${invalidStyles.join(', ')}` },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(originalContent, polishStyles, intensity, taskId, config);

    // 生成润色提示词
    const prompt = generateMultiTargetPolishPrompt(originalContent, polishStyles, intensity, chatContext);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(prompt),
      stream: true,
      temperature: 0.7,
      max_tokens: 2000,
    };

    console.log(`[Multi-Target Polish API] 发送请求到LLM服务`, {
      taskId,
      apiUrl: config.apiUrl,
      model: config.model,
      polishStylesCount: polishStyles.length,
      intensity,
      timestamp: new Date().toISOString()
    });

    // 调用LLM API
    const response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Multi-Target Polish API] LLM API调用失败:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        taskId,
        timestamp: new Date().toISOString()
      });
      
      logResponse(taskId, polishStyles, intensity, false, `HTTP ${response.status}: ${errorText}`);
      return NextResponse.json(
        { error: `LLM service error: ${response.status} ${response.statusText}` },
        { status: 500 }
      );
    }

    logResponse(taskId, polishStyles, intensity, true);

    // 设置SSE响应头
    const headers = new Headers({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });

    // 创建流式响应
    const stream = new ReadableStream({
      start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const pump = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                controller.close();
                break;
              }

              const chunk = new TextDecoder().decode(value);
              const lines = chunk.split('\n').filter(line => line.trim());
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                    continue;
                  }
                  
                  try {
                    const parsed = JSON.parse(data);
                    if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ content: parsed.choices[0].delta.content })}\n\n`));
                    }
                  } catch (e) {
                    console.warn(`[Multi-Target Polish API] 解析SSE数据时出错:`, e);
                  }
                }
              }
            }
          } catch (error) {
            console.error(`[Multi-Target Polish API] 流处理错误:`, error);
            controller.error(error);
          }
        };

        pump();
      }
    });

    return new NextResponse(stream, { headers });

  } catch (error) {
    console.error('[Multi-Target Polish API] 处理请求时发生错误:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 