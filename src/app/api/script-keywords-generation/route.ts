import { NextRequest, NextResponse } from 'next/server';

// 获取环境变量配置
const getConfig = () => {
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('LLM API key is not configured');
  }

  return { apiUrl, apiKey, model };
};

// 构建关键词生成的提示词
const buildKeywordsPrompt = (segmentTitle: string, segmentContent: string) => {
  return `你是一个专业的视频制作助手。基于以下视频脚本片段，生成2-3个最相关的关键词，用于搜索匹配的视频素材。

脚本片段标题：${segmentTitle}

脚本片段内容：
${segmentContent}

要求：
1. 生成2-3个关键词，每个关键词应该是简洁的名词或名词短语
2. 关键词应该能够帮助找到与脚本内容相关的视频素材
3. 优先考虑具体的、可视化的概念（如：自然风景、商务办公、人物肖像等）
4. 避免抽象概念和动词
5. 关键词应该适合用于视频搜索引擎

返回格式：
直接返回关键词列表，每个关键词占一行，不需要编号或其他格式。

示例：
商务办公
团队合作
现代办公室

现在请为上述脚本片段生成关键词：`;
};

// 格式化消息
const formatMessages = (prompt: string) => [
  {
    role: 'system',
    content: '你是一个专业的视频制作助手，擅长为视频脚本生成相关的搜索关键词。'
  },
  {
    role: 'user',
    content: prompt
  }
];

// 日志记录函数
const logRequest = (segmentTitle: string, segmentContent: string, taskId: string, config: any) => {
  console.log(`[Script Keywords Generation API] 请求开始 - 任务: ${taskId}`);
  console.log(`[Script Keywords Generation API] 片段标题: ${segmentTitle}`);
  console.log(`[Script Keywords Generation API] 片段内容长度: ${segmentContent.length} 字符`);
  console.log(`[Script Keywords Generation API] 配置: ${JSON.stringify({
    apiUrl: config.apiUrl,
    model: config.model,
    hasApiKey: !!config.apiKey
  })}`);
};

const logResponse = (success: boolean, taskId: string, keywords?: string[], error?: string) => {
  if (success && keywords) {
    console.log(`[Script Keywords Generation API] 请求成功 - 任务: ${taskId}`);
    console.log(`[Script Keywords Generation API] 生成关键词数量: ${keywords.length}`);
    console.log(`[Script Keywords Generation API] 关键词列表: ${JSON.stringify(keywords)}`);
  } else {
    console.error(`[Script Keywords Generation API] 请求失败 - 任务: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { segmentTitle, segmentContent, taskId } = body as { 
      segmentTitle: string; 
      segmentContent: string; 
      taskId: string;
    };

    // 验证请求参数
    if (!segmentTitle || typeof segmentTitle !== 'string' || segmentTitle.trim().length === 0) {
      console.error('[Script Keywords Generation API] Invalid request: segmentTitle string is required');
      return NextResponse.json(
        { error: 'Segment title string is required' },
        { status: 400 }
      );
    }

    if (!segmentContent || typeof segmentContent !== 'string' || segmentContent.trim().length === 0) {
      console.error('[Script Keywords Generation API] Invalid request: segmentContent string is required');
      return NextResponse.json(
        { error: 'Segment content string is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Script Keywords Generation API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(segmentTitle, segmentContent, taskId, config);

    // 构建提示词
    const prompt = buildKeywordsPrompt(segmentTitle, segmentContent);

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages: formatMessages(prompt),
      temperature: 0.3, // 较低的温度以获得更一致的结果
      max_tokens: 200, // 关键词不需要太多token
    };

    console.log(`[Script Keywords Generation API] Calling LLM API: ${config.apiUrl}/chat/completions for task: ${taskId}`);

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
      console.error(`[Script Keywords Generation API] LLM API error: ${response.status} - ${errorText}`);
      logResponse(false, taskId, undefined, `LLM API error: ${response.status}`);
      
      return NextResponse.json(
        { error: `LLM API error: ${response.status}` },
        { status: response.status }
      );
    }

    const result = await response.json();

    if (!result.choices || !result.choices[0] || !result.choices[0].message) {
      const error = 'Invalid response format from LLM API';
      console.error(`[Script Keywords Generation API] ${error}`);
      logResponse(false, taskId, undefined, error);
      
      return NextResponse.json(
        { error },
        { status: 500 }
      );
    }

    const content = result.choices[0].message.content.trim();
    
    // 解析关键词（每行一个关键词）
    const keywords = content
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0 && !line.match(/^\d+\./)) // 过滤空行和编号
      .slice(0, 3); // 最多取3个关键词

    // 验证关键词数量
    if (keywords.length === 0) {
      const error = 'No valid keywords generated';
      console.error(`[Script Keywords Generation API] ${error}, raw content: ${content}`);
      logResponse(false, taskId, undefined, error);
      
      return NextResponse.json(
        { error },
        { status: 500 }
      );
    }

    logResponse(true, taskId, keywords);

    return NextResponse.json({
      success: true,
      keywords,
      segmentTitle,
      taskId
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Script Keywords Generation API] Unexpected error: ${errorMessage}`);
    logResponse(false, 'unknown', undefined, errorMessage);
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 