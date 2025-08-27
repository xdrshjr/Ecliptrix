import { NextRequest, NextResponse } from 'next/server';

interface PromptOptimizationRequest {
  positivePrompt: string;
  negativePrompt?: string;
}

interface OptimizedPrompts {
  positivePrompt: string;
  negativePrompt: string;
}

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

// 日志记录函数
const logRequest = (positivePrompt: string, negativePrompt: string, config: any) => {
  console.log(`[Prompt Optimization API] ${new Date().toISOString()} - Incoming prompt optimization request`);
  console.log(`[Prompt Optimization API] Model: ${config.model}`);
  console.log(`[Prompt Optimization API] Positive prompt length: ${positivePrompt.length}`);
  console.log(`[Prompt Optimization API] Negative prompt length: ${negativePrompt.length}`);
  console.log(`[Prompt Optimization API] Positive prompt preview: ${positivePrompt.slice(0, 100)}...`);
};

const logResponse = (success: boolean, error?: string, optimizedPrompts?: OptimizedPrompts) => {
  if (success && optimizedPrompts) {
    console.log(`[Prompt Optimization API] ${new Date().toISOString()} - Optimization completed successfully`);
    console.log(`[Prompt Optimization API] Optimized positive prompt length: ${optimizedPrompts.positivePrompt.length}`);
    console.log(`[Prompt Optimization API] Optimized negative prompt length: ${optimizedPrompts.negativePrompt.length}`);
  } else {
    console.error(`[Prompt Optimization API] ${new Date().toISOString()} - Optimization failed: ${error}`);
  }
};

// 构建优化提示词的系统消息
const buildSystemPrompt = () => {
  return `你是一个专业的AI图像生成提示词优化专家。你的任务是帮助用户优化他们的图像生成提示词，以获得更好的AI生成图像效果。

请遵循以下原则：
1. 保持用户原始意图，不要完全改变图像主题
2. 增加具体的描述词来提升图像质量，如：高质量、4K、数字艺术、摄影风格等
3. 添加构图、光照、颜色方面的描述
4. 优化正向提示词，使其更加详细和专业
5. 优化反向提示词，添加常见的负面词汇来避免低质量图像
6. 使用英文输出优化后的提示词
7. 保持提示词简洁且有效

请以JSON格式返回优化结果，包含positivePrompt和negativePrompt两个字段。`;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PromptOptimizationRequest;
    const { positivePrompt, negativePrompt = '' } = body;

    if (!positivePrompt || positivePrompt.trim().length === 0) {
      console.error('[Prompt Optimization API] Invalid request: positive prompt is required');
      return NextResponse.json(
        { error: 'Positive prompt is required' },
        { status: 400 }
      );
    }

    const config = getConfig();
    logRequest(positivePrompt, negativePrompt, config);

    // 构建优化请求的消息
    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt()
      },
      {
        role: 'user',
        content: `请优化以下图像生成提示词：

正向提示词：${positivePrompt}
反向提示词：${negativePrompt}

请返回优化后的提示词，格式为JSON：
{
  "positivePrompt": "优化后的正向提示词",
  "negativePrompt": "优化后的反向提示词"
}`
      }
    ];

    // 准备请求数据
    const requestData = {
      model: config.model,
      messages,
      temperature: 0.3, // 降低随机性，确保一致性
      max_tokens: 1000,
    };

    console.log(`[Prompt Optimization API] Calling LLM API: ${config.apiUrl}/chat/completions`);

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
      console.error(`[Prompt Optimization API] LLM API error: ${response.status} - ${errorText}`);
      logResponse(false, `LLM API error: ${response.status}`);
      
      return NextResponse.json(
        { error: `LLM API error: ${response.status}` },
        { status: response.status }
      );
    }

    const responseData = await response.json();
    const content = responseData.choices?.[0]?.message?.content;

    if (!content) {
      console.error('[Prompt Optimization API] No content in LLM response');
      logResponse(false, 'No content in LLM response');
      return NextResponse.json(
        { error: 'No optimization result received' },
        { status: 500 }
      );
    }

    console.log(`[Prompt Optimization API] LLM response content: ${content.slice(0, 200)}...`);

    // 尝试解析JSON响应
    try {
      // 提取JSON部分（如果响应包含额外的文本）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : content;
      
      const optimizedPrompts: OptimizedPrompts = JSON.parse(jsonStr);
      
      // 验证响应格式
      if (!optimizedPrompts.positivePrompt || typeof optimizedPrompts.positivePrompt !== 'string') {
        throw new Error('Invalid response format: positivePrompt is required and must be a string');
      }
      
      if (!optimizedPrompts.negativePrompt || typeof optimizedPrompts.negativePrompt !== 'string') {
        // 如果没有负向提示词，设置默认值
        optimizedPrompts.negativePrompt = 'low quality, blurry, distorted, deformed, bad anatomy, poor composition';
      }

      logResponse(true, undefined, optimizedPrompts);

      return NextResponse.json({
        success: true,
        data: optimizedPrompts
      });

    } catch (parseError) {
      console.error('[Prompt Optimization API] Error parsing LLM response as JSON:', parseError);
      console.error('[Prompt Optimization API] Raw LLM response:', content);
      
      // 如果JSON解析失败，尝试提取关键信息作为fallback
      const fallbackOptimization: OptimizedPrompts = {
        positivePrompt: positivePrompt + ', high quality, detailed, professional, 4k resolution',
        negativePrompt: negativePrompt + (negativePrompt ? ', ' : '') + 'low quality, blurry, distorted, deformed, bad anatomy'
      };
      
      logResponse(true, undefined, fallbackOptimization);
      
      return NextResponse.json({
        success: true,
        data: fallbackOptimization,
        warning: 'Used fallback optimization due to response parsing error'
      });
    }

  } catch (error) {
    console.error('[Prompt Optimization API] Unexpected error:', error);
    logResponse(false, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}