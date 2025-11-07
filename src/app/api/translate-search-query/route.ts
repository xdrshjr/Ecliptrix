import { NextRequest, NextResponse } from 'next/server';

// 获取环境变量配置 - 优先使用快速LLM配置
const getConfig = () => {
  // 优先使用快速LLM配置，用于搜索查询翻译等快速响应场景
  const apiUrl = process.env.FAST_LLM_API_URL || process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = ***REMOVED*** || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.FAST_LLM_MODEL || process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set FAST_LLM_API_KEY, LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  // 判断使用的是哪个配置
  const configType = ***REMOVED*** ? 'FAST_LLM' : 
                     process.env.LLM_API_KEY ? 'LLM' : 'OPENAI';

  return { apiUrl, apiKey, model, configType };
};

// 检测是否为英语查询
const isEnglishQuery = (query: string): boolean => {
  const trimmedQuery = query.trim().toLowerCase();
  
  // 检查是否主要包含ASCII字符
  const asciiRatio = (query.match(/[\x00-\x7F]/g) || []).length / query.length;
  
  // 检查常见英语单词
  const commonEnglishWords = [
    'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
    'this', 'that', 'these', 'those', 'here', 'there', 'where', 'when', 'how', 'why',
    'what', 'who', 'which', 'video', 'music', 'song', 'movie', 'film', 'show'
  ];
  
  const words = trimmedQuery.split(/\s+/);
  const englishWordCount = words.filter(word => 
    commonEnglishWords.includes(word.replace(/[^\w]/g, ''))
  ).length;
  
  const englishWordRatio = englishWordCount / words.length;
  
  // 如果ASCII比例高且包含英语单词，认为是英语
  return asciiRatio > 0.8 && (englishWordRatio > 0.3 || words.length <= 2);
};

// 生成翻译提示词
const generateTranslationPrompt = (originalQuery: string) => {
  return `You are a professional translator. Please translate the following search query to English for video search purposes.

Requirements:
1. Translate the query to natural, searchable English keywords
2. Keep the core meaning and intent of the original query
3. Make it suitable for video search engines
4. If the query is already in English, return it as-is
5. Only return the translated query, no explanations or additional text

Original query: "${originalQuery}"

Translated query:`;
};

// 转换消息格式
const formatMessages = (prompt: string) => [
  {
    role: 'user',
    content: prompt
  }
];

// 日志记录函数
const logRequest = (originalQuery: string, isEnglish: boolean, taskId: string, config: any) => {
  console.log(`[Translate Search Query API] ${new Date().toISOString()} - Incoming translation request`);
  console.log(`[Translate Search Query API] Task ID: ${taskId}`);
  console.log(`[Translate Search Query API] LLM Configuration Type: ${config.configType}`);
  console.log(`[Translate Search Query API] API URL: ${config.apiUrl}`);
  console.log(`[Translate Search Query API] Model: ${config.model}`);
  console.log(`[Translate Search Query API] Original query: "${originalQuery}"`);
  console.log(`[Translate Search Query API] Query length: ${originalQuery.length} characters`);
  console.log(`[Translate Search Query API] Detected as English: ${isEnglish}`);
  console.log(`[Translate Search Query API] Translation needed: ${!isEnglish}`);
};

const logResponse = (success: boolean, taskId: string, originalQuery: string, translatedQuery?: string, error?: string) => {
  if (success) {
    console.log(`[Translate Search Query API] ${new Date().toISOString()} - Translation completed successfully`);
    console.log(`[Translate Search Query API] Task ID: ${taskId}`);
    console.log(`[Translate Search Query API] Original: "${originalQuery}"`);
    console.log(`[Translate Search Query API] Translated: "${translatedQuery}"`);
    console.log(`[Translate Search Query API] Translation changed: ${originalQuery !== translatedQuery}`);
  } else {
    console.error(`[Translate Search Query API] ${new Date().toISOString()} - Translation failed`);
    console.error(`[Translate Search Query API] Task ID: ${taskId}`);
    console.error(`[Translate Search Query API] Original query: "${originalQuery}"`);
    console.error(`[Translate Search Query API] Error: ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, taskId } = body as { 
      query: string; 
      taskId: string;
    };

    // 验证请求参数
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      console.error('[Translate Search Query API] Invalid request: query string is required');
      return NextResponse.json(
        { error: 'Search query string is required' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Translate Search Query API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    const trimmedQuery = query.trim();
    const isEnglish = isEnglishQuery(trimmedQuery);
    const config = getConfig();
    
    logRequest(trimmedQuery, isEnglish, taskId, config);

    // 如果已经是英语，直接返回原查询
    if (isEnglish) {
      console.log(`[Translate Search Query API] Query detected as English, returning original query for task: ${taskId}`);
      logResponse(true, taskId, trimmedQuery, trimmedQuery);
      
      return NextResponse.json({
        success: true,
        originalQuery: trimmedQuery,
        translatedQuery: trimmedQuery,
        isEnglish: true,
        translationNeeded: false
      });
    }

    // 需要翻译，调用LLM
    console.log(`[Translate Search Query API] Non-English query detected, calling ${config.configType} for translation. Task: ${taskId}`);
    
    const prompt = generateTranslationPrompt(trimmedQuery);
    const requestData = {
      model: config.model,
      messages: formatMessages(prompt),
      stream: false,
      temperature: 0.3,
      max_tokens: 200,
    };

    console.log(`[Translate Search Query API] Calling ${config.configType} API: ${config.apiUrl}/chat/completions for task: ${taskId}`);
    console.log(`[Translate Search Query API] Request model: ${config.model}, temperature: 0.3, max_tokens: 200`);

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
      console.error(`[Translate Search Query API] ${config.configType} API error: ${response.status} - ${errorText} for task: ${taskId}`);
      logResponse(false, taskId, trimmedQuery, undefined, `${config.configType} API error: ${response.status}`);
      
      return NextResponse.json(
        { error: `Translation service error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const translatedQuery = data.choices?.[0]?.message?.content?.trim() || trimmedQuery;

    console.log(`[Translate Search Query API] ${config.configType} translation completed for task: ${taskId}`);
    console.log(`[Translate Search Query API] Original: "${trimmedQuery}" -> Translated: "${translatedQuery}"`);
    console.log(`[Translate Search Query API] Translation quality check - Length ratio: ${(translatedQuery.length / trimmedQuery.length).toFixed(2)}`);
    
    logResponse(true, taskId, trimmedQuery, translatedQuery);

    return NextResponse.json({
      success: true,
      originalQuery: trimmedQuery,
      translatedQuery: translatedQuery,
      isEnglish: false,
      translationNeeded: true
    });

  } catch (error) {
    console.error('[Translate Search Query API] Request processing error:', error);
    const taskId = 'unknown';
    const query = 'unknown';
    logResponse(false, taskId, query, undefined, String(error));
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 