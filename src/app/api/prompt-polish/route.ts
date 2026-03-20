import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage } from '@/types';

// ============================================================================
// Prompt Polish API Route
// POST /api/prompt-polish
//
// Accepts a user-authored prompt and returns an LLM-polished version.
// Uses the same LLM_API_URL / LLM_API_KEY configuration as the chat route.
// ============================================================================

const LOG_PREFIX = '[Prompt Polish API]';

// ---------------------------------------------------------------------------
// LLM configuration — mirrors the pattern in video-script-generation/route.ts
// ---------------------------------------------------------------------------
const getConfig = () => {
  const apiUrl = process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1';
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-3.5-turbo';

  if (!apiKey) {
    throw new Error('API key not configured. Please set LLM_API_KEY or OPENAI_API_KEY in environment variables.');
  }

  return { apiUrl, apiKey, model };
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PromptPolishRequest {
  prompt: string;
  chatMessages?: ChatMessage[];
  videoAnalysisContext?: string;
  targetType: 'ai-video' | 'normal';
}

// ---------------------------------------------------------------------------
// Chat message truncation strategy
// - Max 20 most-recent messages
// - Each message content capped at 500 characters
// - Total chat context capped at 5000 characters
// ---------------------------------------------------------------------------
const truncateChatMessages = (messages: ChatMessage[]): string => {
  // Take the most recent 20 messages
  const recent = messages.slice(-20);

  // Iterate from newest to oldest so that the most recent messages are
  // prioritised when the 5000-char budget is exhausted (per spec).
  const lines: string[] = [];
  let totalLength = 0;

  for (let i = recent.length - 1; i >= 0; i--) {
    const msg = recent[i];
    const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
    const truncatedContent = msg.content.length > 500 ? msg.content.slice(0, 500) + '...' : msg.content;
    const line = `${role}: ${truncatedContent}`;

    if (totalLength + line.length > 5000) {
      // Remaining budget
      const remaining = 5000 - totalLength;
      if (remaining > 20) {
        lines.unshift(line.slice(0, remaining) + '...');
      }
      break;
    }

    lines.unshift(line);
    totalLength += line.length;
  }

  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// System prompt construction
// ---------------------------------------------------------------------------
const buildSystemPrompt = (targetType: 'ai-video' | 'normal'): string => {
  const targetGuidance = targetType === 'ai-video'
    ? `由于目标是 AI 视频生成，请特别注重：
- 画面描述的具体化（场景布置、光影效果、色彩基调）
- 镜头语言的运用（远景/近景/特写、推拉摇移、运镜节奏）
- 视觉风格的定义（写实/动画/赛博朋克/水墨等）
- 场景转换的流畅性（转场方式、视觉衔接）
- 人物/物体的动作描写（姿态、表情、运动轨迹）`
    : `由于目标是普通视频脚本，请特别注重：
- 叙事结构的清晰性（开头引入、主体展开、结尾收束）
- 语言节奏的把控（长短句交替、停顿设计、语气变化）
- 信息层次的分明（主要信息、辅助信息、背景铺垫）
- 观众引导的有效性（悬念设置、情绪调动、行动号召）
- 内容的可读性和口播适配（口语化表达、避免书面用语）`;

  return `你是一个视频脚本生成提示词优化专家。你的任务是优化用户输入的视频脚本生成需求描述，使其更加清晰、具体、有效。

优化原则：
1. 保留用户的核心意图和关键需求
2. 补充具体化的细节描述（场景、风格、节奏、情绪等）
3. 使表述更加专业和结构化
4. 适当扩展模糊的描述，但不偏离原意
5. 保持合理长度，不过度冗余

${targetGuidance}

如果提供了视频分析上下文，参考视频内容来使提示词更贴合实际素材。
如果提供了对话上下文，理解对话中讨论的方向和需求来优化提示词。

直接返回优化后的提示词文本，不要添加任何解释、标注、引号包裹或前缀说明。`;
};

// ---------------------------------------------------------------------------
// User prompt assembly
// ---------------------------------------------------------------------------
const buildUserPrompt = (
  prompt: string,
  chatMessages?: ChatMessage[],
  videoAnalysisContext?: string,
): string => {
  const sections: string[] = [];

  if (videoAnalysisContext && videoAnalysisContext.trim()) {
    sections.push(`【参考视频内容】\n${videoAnalysisContext.trim()}`);
  }

  if (chatMessages && chatMessages.length > 0) {
    const truncated = truncateChatMessages(chatMessages);
    if (truncated.length > 0) {
      sections.push(`【对话背景】\n${truncated}`);
    }
  }

  sections.push(`【待优化的提示词】\n${prompt}`);

  return sections.join('\n\n');
};

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
const logRequest = (body: PromptPolishRequest, model: string) => {
  console.log(`${LOG_PREFIX} ${new Date().toISOString()} - Incoming prompt polish request`);
  console.log(`${LOG_PREFIX} Model: ${model}`);
  console.log(`${LOG_PREFIX} Target type: ${body.targetType}`);
  console.log(`${LOG_PREFIX} Prompt length: ${body.prompt.length} chars`);
  console.log(`${LOG_PREFIX} Chat messages: ${body.chatMessages?.length ?? 0}`);
  console.log(`${LOG_PREFIX} Video analysis context: ${body.videoAnalysisContext ? `${body.videoAnalysisContext.length} chars` : 'none'}`);
};

const logResponse = (success: boolean, error?: string) => {
  if (success) {
    console.log(`${LOG_PREFIX} ${new Date().toISOString()} - Prompt polishing completed successfully`);
  } else {
    console.error(`${LOG_PREFIX} ${new Date().toISOString()} - Prompt polishing failed: ${error}`);
  }
};

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as PromptPolishRequest;

    // ------ Validation ------
    if (!body.prompt || typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
      console.error(`${LOG_PREFIX} Invalid request: prompt is required and must be non-empty`);
      return NextResponse.json(
        { success: false, polishedPrompt: '', message: 'Prompt is required and must be non-empty' },
        { status: 400 },
      );
    }

    if (!body.targetType || !['ai-video', 'normal'].includes(body.targetType)) {
      console.error(`${LOG_PREFIX} Invalid request: targetType must be "ai-video" or "normal"`);
      return NextResponse.json(
        { success: false, polishedPrompt: '', message: 'targetType must be "ai-video" or "normal"' },
        { status: 400 },
      );
    }

    // Optional chatMessages validation
    if (body.chatMessages !== undefined && !Array.isArray(body.chatMessages)) {
      console.error(`${LOG_PREFIX} Invalid request: chatMessages must be an array`);
      return NextResponse.json(
        { success: false, polishedPrompt: '', message: 'chatMessages must be an array if provided' },
        { status: 400 },
      );
    }

    // ------ Config ------
    const config = getConfig();
    logRequest(body, config.model);

    // ------ Build LLM messages ------
    const systemPrompt = buildSystemPrompt(body.targetType);
    const userPrompt = buildUserPrompt(body.prompt, body.chatMessages, body.videoAnalysisContext);

    const requestData = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    };

    console.log(`${LOG_PREFIX} Calling LLM API: ${config.apiUrl}/chat/completions`);

    // ------ LLM call ------
    const response = await fetch(`${config.apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestData),
      signal: AbortSignal.timeout(30000), // 30s timeout for polish requests
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${LOG_PREFIX} LLM API error: ${response.status} - ${errorText}`);
      logResponse(false, `LLM API error: ${response.status}`);

      return NextResponse.json(
        { success: false, polishedPrompt: '', message: `LLM API error: ${response.status}` },
        { status: 500 },
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      console.error(`${LOG_PREFIX} LLM returned empty or invalid content`);
      logResponse(false, 'Empty LLM response');

      return NextResponse.json(
        { success: false, polishedPrompt: '', message: 'LLM returned an empty result. Please modify your prompt and try again.' },
        { status: 500 },
      );
    }

    // Strip leading/trailing whitespace and any wrapping quotes the LLM may add
    const polishedPrompt = content.trim().replace(/^["']|["']$/g, '');

    console.log(`${LOG_PREFIX} Polished prompt length: ${polishedPrompt.length} chars (original: ${body.prompt.length} chars)`);
    logResponse(true);

    return NextResponse.json({
      success: true,
      polishedPrompt,
    });

  } catch (error) {
    // Differentiate timeout errors from other errors
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      console.error(`${LOG_PREFIX} LLM API call timed out`);
      logResponse(false, 'LLM API call timed out');
      return NextResponse.json(
        { success: false, polishedPrompt: '', message: 'LLM API call timed out. Please try again.' },
        { status: 500 },
      );
    }

    console.error(`${LOG_PREFIX} Unexpected error:`, error);
    logResponse(false, String(error));

    return NextResponse.json(
      { success: false, polishedPrompt: '', message: 'Internal server error' },
      { status: 500 },
    );
  }
}
