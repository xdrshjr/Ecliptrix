import { NextRequest, NextResponse } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { normalizeApiType, streamLlmChat, type LlmApiType } from '@/lib/llm/streamLlmChat';

type ResolvedConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
  apiType: LlmApiType;
};

// Actionable copy surfaced verbatim to the user when no model is configured.
const LLM_NOT_CONFIGURED_MESSAGE =
  '尚未配置 AI 模型凭证,请前往 设置 → 模型设置 完成配置 (AI model not configured — open Settings → Model Settings)';

// Distinguishable error so the outer catch can return a structured 503 instead
// of a generic 500. Identified by a stable `code`, never by message matching.
class LlmNotConfiguredError extends Error {
  readonly code = 'LLM_NOT_CONFIGURED';
  constructor(message: string = LLM_NOT_CONFIGURED_MESSAGE) {
    super(message);
    this.name = 'LlmNotConfiguredError';
  }
}

// Resolve LLM credentials the same way /api/chat and the twin
// /api/ai-video-script-generation route do: the DB-configured chat model first
// (via the FastAPI resolve endpoint), env vars as fallback. Crucially this
// returns `apiType`, so the call site can pick the correct OpenAI vs Anthropic
// transport. The previous direct `process.env` read here was api_type-blind and
// 401'd against Anthropic-compatible endpoints (e.g. the desktop default),
// because it always hit `/chat/completions` + Bearer.
const getConfig = async (): Promise<ResolvedConfig> => {
  let backendNotConfiguredMessage: string | null = null;
  try {
    const res = await fetch(
      backendConfig.joinPath('/api/model-settings/resolve/chat'),
      { method: 'GET', headers: { 'Content-Type': 'application/json' } },
    );
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.api_key) {
        return {
          apiUrl: data.api_url,
          apiKey: data.api_key,
          model: data.model_name,
          apiType: normalizeApiType(data.api_type),
        };
      }
    } else if (res.status === 503) {
      const data = await res.json().catch(() => null);
      if (data?.error_code === 'MODEL_NOT_CONFIGURED' && typeof data.message === 'string') {
        backendNotConfiguredMessage = data.message;
      }
    }
  } catch {
    console.warn('[Script Keywords Generation API] Failed to fetch model settings from backend, falling back to env vars');
  }

  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';
  const apiType = normalizeApiType(process.env.LLM_API_TYPE);

  if (!apiKey) {
    throw new LlmNotConfiguredError(backendNotConfiguredMessage ?? undefined);
  }

  return { apiUrl, apiKey, model, apiType };
};

// 关键词语言：默认中文；解说直接生成链路传 'english' 以输出英文素材检索词。
type KeywordLanguage = 'chinese' | 'english';

// 非法 / 缺省的 language 一律回退中文，绝不返回 400 阻断上游富化（评审 R-4）。
const normalizeLanguage = (value: unknown): KeywordLanguage =>
  value === 'english' ? 'english' : 'chinese';

// 构建关键词生成的提示词（中文分支，语义不变）
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

// 构建关键词生成的提示词（英文分支）。
// 取材为 AI 视频脚本，通常为中文 → 必须显式声明「源文可能为中文、一律输出英文」（评审 R-1）。
// 数量为目标 3、上限 3（best-effort ≤3，评审 R-2）。
const buildKeywordsPromptEnglish = (segmentTitle: string, segmentContent: string) => {
  return `You are a professional video production assistant. Based on the following video script segment, produce up to 3 concise ENGLISH keywords for searching matching stock-video footage.

CRITICAL: The source script may be written in Chinese (or another language). Regardless of the source language, you MUST output the keywords in ENGLISH only.

Segment title: ${segmentTitle}

Segment content:
${segmentContent}

Requirements:
1. Produce up to 3 keywords (3 is the target; fewer is acceptable). Each keyword should be a concise noun or short noun phrase.
2. Keywords should help find stock-video footage matching the script content.
3. Prefer concrete, visual concepts (e.g. natural scenery, business office, portrait).
4. Avoid abstract concepts and verbs.
5. Keywords must be suitable for stock-video search engines such as Pexels.
6. Output the keywords in ENGLISH only, even if the source script is in Chinese.

Output format:
Return the keyword list directly, one keyword per line. No numbering, no bullets, no quotes.

Example:
mountain landscape
city skyline at night
team meeting

Now produce the ENGLISH keywords for the segment above:`;
};

// 格式化消息（按语言切换 system message）
const formatMessages = (prompt: string, language: KeywordLanguage) => [
  {
    role: 'system',
    content: language === 'english'
      ? 'You are a professional video production assistant who excels at generating concise ENGLISH search keywords for video scripts, even when the source script is written in another language such as Chinese.'
      : '你是一个专业的视频制作助手，擅长为视频脚本生成相关的搜索关键词。'
  },
  {
    role: 'user',
    content: prompt
  }
];

// 健壮解析关键词（中/英分支统一，评审 R-3）：
// 逐行剥离行首编号(1. / 2) / 3、)、项目符号(- / * / •)与包裹引号后再保留该行，
// 而非整行丢弃编号行（旧逻辑 !line.match(/^\d+\./) 会把「1. mountain landscape」误删致 0 关键词）。
const parseKeywords = (content: string): string[] =>
  content
    .split('\n')
    .map((line: string) =>
      line
        .trim()
        .replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, '') // 剥离行首编号 / 项目符号前缀
        .trim()
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') // 剥离包裹引号
        .trim(),
    )
    .filter((line: string) => line.length > 0)
    .slice(0, 3); // 目标 3、上限 3（best-effort ≤3）

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
    // language 可选，缺省 / 非法值一律回退中文（评审 R-4），不阻断富化。
    const language = normalizeLanguage((body as { language?: unknown }).language);

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

    const config = await getConfig();
    logRequest(segmentTitle, segmentContent, taskId, config);

    // 构建提示词（按语言切换中/英分支）
    const prompt = language === 'english'
      ? buildKeywordsPromptEnglish(segmentTitle, segmentContent)
      : buildKeywordsPrompt(segmentTitle, segmentContent);

    // 准备消息（按语言切换中/英 system + user 提示）
    const messages = formatMessages(prompt, language);

    console.log(`[Script Keywords Generation API] Calling LLM API (api_type=${config.apiType}) base=${config.apiUrl} for task: ${taskId}`);

    // 复用 api_type 感知的共享客户端（与 /api/chat、generate_video_script 同一路径），
    // 把流式内容累积成整串，再交给现有 parseKeywords。原先硬编码
    // fetch(`${apiUrl}/chat/completions`)+Bearer 对 anthropic 端点（桌面端默认）会 401。
    let content = '';
    let upstreamError: { status: number; message: string } | null = null;
    for await (const event of streamLlmChat({
      config: {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        model: config.model,
        apiType: config.apiType,
      },
      messages,
      temperature: 0.3, // 较低的温度以获得更一致的结果
      maxTokens: 200, // 关键词不需要太多 token
    })) {
      if (event.kind === 'error') {
        upstreamError = { status: event.status, message: event.message };
        break;
      }
      if (event.kind === 'content') content += event.text;
    }

    if (upstreamError) {
      // 保留上游状态码（401/429/…），不塌缩成 500（评审强制护栏 §三-1）。
      console.error(`[Script Keywords Generation API] LLM API error: ${upstreamError.status} - ${upstreamError.message}`);
      logResponse(false, taskId, undefined, `LLM API error: ${upstreamError.status}`);
      const httpStatus = upstreamError.status >= 400 && upstreamError.status <= 599 ? upstreamError.status : 502;
      return NextResponse.json(
        { error: `LLM API error: ${upstreamError.status}` },
        { status: httpStatus }
      );
    }

    content = content.trim();

    // 解析关键词（健壮：剥离编号 / 项目符号 / 引号前缀后保留该行，评审 R-3）
    const keywords = parseKeywords(content);

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

    // 「未配置 AI 模型凭证」是设计内的可操作失败，返回可识别的结构化 503（与 /api/chat 一致），
    // 而非塌缩成无信息量的 500；其余未知错误维持原有 500 契约不变。
    if (error instanceof LlmNotConfiguredError) {
      return NextResponse.json(
        { success: false, error_code: error.code, message: error.message },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}