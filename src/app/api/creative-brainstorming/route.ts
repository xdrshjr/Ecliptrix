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

// 专家人格定义
const expertPersonalities = {
  'creative-director': {
    name: '李创意',
    role: '创意总监',
    personality: '充满想象力，善于从不同角度思考问题，注重创意的独特性和执行可行性。我会提供创新的创意方向，确保内容既有吸引力又能有效传达核心信息。'
  },
  'marketing-strategist': {
    name: '王策略',
    role: '营销策略师',
    personality: '数据驱动，善于分析市场趋势和用户行为，注重策略的商业价值。我会从市场角度分析创意的可行性，提供基于用户洞察的建议。'
  },
  'content-writer': {
    name: '张文案',
    role: '内容编剧',
    personality: '富有文采，擅长用文字打动人心，注重内容的情感共鸣和传播力。我会专注于故事叙述和文案创作，确保内容能够引起观众的情感共鸣。'
  },
  'visual-designer': {
    name: '陈视觉',
    role: '视觉设计师',
    personality: '追求美感和功能的平衡，善于用视觉语言传达信息，注重设计的实用性。我会从视觉呈现角度提供建议，确保内容在视觉上具有吸引力。'
  },
  'ux-expert': {
    name: '刘体验',
    role: '用户体验专家',
    personality: '以用户为中心，善于发现和解决用户痛点，注重产品的易用性和满意度。我会从用户体验角度分析内容，确保观众能够获得良好的观看体验。'
  }
};

// 构建系统提示词
const buildSystemPrompt = (config: any, phase: string, expertId: string, currentRound: number) => {
  // 处理总结阶段的特殊情况
  if (phase === 'summary' && expertId === 'moderator') {
    return `你是创意构思会议的主持人，负责总结所有专家的讨论内容并生成最终的创意方案。

当前创意构思项目配置：
- 创作类型：${config.creationType?.join('、') || '未指定'}
- 创作领域：${config.creationDomain?.join('、') || '未指定'}
- 创作目标：${config.creationGoal?.join('、') || '未指定'}
- 内容策略：${config.contentStrategy?.join('、') || '未指定'}
- 参与专家：${config.creativeExperts?.join('、') || '未指定'}

现在需要你作为项目主持人，综合所有专家的讨论内容，生成一份完整的创意构思总结报告。

要求：
1. 总结各专家的核心观点
2. 整合形成完整的创意方案
3. 包含具体的执行建议
4. 格式清晰，结构完整
5. 控制在800-1200字
6. 使用Markdown格式

请生成一份专业的创意构思报告。`;
  }

  const expert = expertPersonalities[expertId as keyof typeof expertPersonalities];
  if (!expert) {
    throw new Error(`Unknown expert ID: ${expertId}`);
  }

  const baseContext = `
你是${expert.name}，担任${expert.role}。${expert.personality}

当前创意构思项目配置：
- 创作类型：${config.creationType?.join('、') || '未指定'}
- 创作领域：${config.creationDomain?.join('、') || '未指定'}
- 创作目标：${config.creationGoal?.join('、') || '未指定'}
- 内容策略：${config.contentStrategy?.join('、') || '未指定'}
- 参与专家：${config.creativeExperts?.join('、') || '未指定'}
`;

  if (phase === 'discussion') {
    return `${baseContext}

现在是第${currentRound}轮专家讨论。请以${expert.role}的身份，根据你的专业知识和经验，对这个创意项目提供具体的建议和想法。

要求：
1. 保持你的专业角色和人格特点
2. 提供具体、可操作的建议
3. 考虑其他专家可能提到的观点
4. 回答控制在200字以内
5. 语言要专业但易懂
6. 可以提出问题或挑战其他观点

请直接给出你的专业建议，不需要自我介绍。`;
  }

  return baseContext;
};

// 转换消息格式
const formatMessages = (
  config: any,
  messages: any[],
  currentContent: string,
  phase: string,
  expertId: string,
  currentRound: number,
  userMessage?: string
) => {
  const systemPrompt = buildSystemPrompt(config, phase, expertId, currentRound);
  
  const formattedMessages = [
    {
      role: 'system',
      content: systemPrompt
    }
  ];

  // 添加当前项目内容作为上下文
  if (currentContent) {
    formattedMessages.push({
      role: 'user',
      content: `当前项目文档内容：\n${currentContent}`
    });
  }

  // 添加历史对话
  if (messages.length > 0) {
    formattedMessages.push({
      role: 'user',
      content: `以下是之前的讨论内容：\n${messages.map((msg: any) => 
        `[${msg.type === 'expert' ? '专家' : msg.type === 'user' ? '用户' : '主持人'}] ${msg.content}`
      ).join('\n\n')}`
    });
  }

  // 添加用户消息
  if (userMessage) {
    formattedMessages.push({
      role: 'user',
      content: `用户补充：${userMessage}`
    });
  }

  // 添加当前请求
  if (phase === 'discussion') {
    formattedMessages.push({
      role: 'user',
      content: '请提供你的专业建议。'
    });
  } else if (phase === 'summary') {
    formattedMessages.push({
      role: 'user',
      content: '请生成完整的创意构思总结报告。'
    });
  }

  return formattedMessages;
};

// 日志记录函数
const logRequest = (phase: string, expertId: string, taskId: string, config: any) => {
  console.log(`[Creative Brainstorming API] ${new Date().toISOString()} - ${phase} request`);
  console.log(`[Creative Brainstorming API] Task ID: ${taskId}`);
  console.log(`[Creative Brainstorming API] Expert ID: ${expertId}`);
  console.log(`[Creative Brainstorming API] Phase: ${phase}`);
  console.log(`[Creative Brainstorming API] Config: ${JSON.stringify(config, null, 2)}`);
};

const logResponse = (success: boolean, taskId: string, error?: string) => {
  if (success) {
    console.log(`[Creative Brainstorming API] ${new Date().toISOString()} - Response completed for task: ${taskId}`);
  } else {
    console.error(`[Creative Brainstorming API] ${new Date().toISOString()} - Response failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      taskId, 
      config, 
      currentContent, 
      messages, 
      phase, 
      currentRound, 
      userMessage 
    } = body;

    // 验证请求参数
    if (!taskId || typeof taskId !== 'string') {
      console.error('[Creative Brainstorming API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    if (!config || !config.creativeExperts || config.creativeExperts.length === 0) {
      console.error('[Creative Brainstorming API] Invalid request: creativeExperts is required');
      return NextResponse.json(
        { error: 'Creative experts configuration is required' },
        { status: 400 }
      );
    }

    if (!phase || !['discussion', 'summary'].includes(phase)) {
      console.error('[Creative Brainstorming API] Invalid request: valid phase is required');
      return NextResponse.json(
        { error: 'Valid phase (discussion/summary) is required' },
        { status: 400 }
      );
    }

    // 确定当前发言的专家
    let currentExpertId: string;
    if (phase === 'summary') {
      currentExpertId = 'moderator';
    } else {
      // 讨论阶段，轮流让专家发言
             const expertIndex = (messages.filter((m: any) => m.type === 'expert').length) % config.creativeExperts.length;
      currentExpertId = config.creativeExperts[expertIndex];
    }

    const apiConfig = getConfig();
    logRequest(phase, currentExpertId, taskId, config);

    // 准备请求数据
    const requestData = {
      model: apiConfig.model,
      messages: formatMessages(config, messages, currentContent, phase, currentExpertId, currentRound, userMessage),
      stream: true,
      temperature: 0.8,
      max_tokens: phase === 'summary' ? 2000 : 500,
    };

    console.log(`[Creative Brainstorming API] Calling LLM API: ${apiConfig.apiUrl}/chat/completions for task: ${taskId}`);

    // 调用LLM API
    const response = await fetch(`${apiConfig.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiConfig.apiKey}`,
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Creative Brainstorming API] LLM API error: ${response.status} - ${errorText} for task: ${taskId}`);
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
            throw new Error('Failed to get response reader');
          }

          let totalContent = '';
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = new TextDecoder().decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                
                if (data === '[DONE]') {
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
                      console.log(`[Creative Brainstorming API] Streaming progress for task: ${taskId}, content length: ${totalContent.length}`);
                    }
                  }
                } catch (e) {
                  console.error(`[Creative Brainstorming API] Error parsing SSE data for task: ${taskId}:`, e);
                }
              }
            }
          }

          logResponse(true, taskId);
          controller.close();
        } catch (error) {
          console.error(`[Creative Brainstorming API] Stream error for task: ${taskId}:`, error);
          logResponse(false, taskId, String(error));
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('[Creative Brainstorming API] Request processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 