import { NextRequest, NextResponse } from 'next/server';
import { ScriptSegment, ScriptGenerationConfig, ChatMessage } from '@/types';
import { truncateChatMessages } from '@/lib/utils/chatMessageUtils';
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

// 凭证解析与 /api/chat、Agent 推理同款：优先取后端 resolve 出的 DB 会话模型，env 兜底。
// 关键是带出 `apiType`，调用处据此选 OpenAI / Anthropic 传输；原先直读 process.env 且
// 硬编码 /chat/completions 的写法对 anthropic 端点（桌面端默认）会 401。
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
    console.warn('[Video Script Generation API] Failed to fetch model settings from backend, falling back to env vars');
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


// 构建脚本生成的提示词
const buildScriptPrompt = (markdownContent: string, chatMessages?: ChatMessage[], scriptConfig?: ScriptGenerationConfig, customPrompt?: string) => {
  // 设置默认配置
  const config = scriptConfig || {
    language: 'chinese',
    consistency: 'moderate',
    segmentCount: 5,
    customRequirements: ''
  };

  // 根据语言选择设置语言要求
  let languageInstruction = '';
  switch (config.language) {
    case 'chinese':
      languageInstruction = 'Generate the script in Chinese. Use natural, conversational Chinese suitable for video narration.';
      break;
    case 'english':
      languageInstruction = 'Generate the script in English. Use natural, conversational English suitable for video narration.';
      break;
    case 'mixed':
      languageInstruction = 'Generate the script in a mix of Chinese and English as appropriate based on the content. Use natural language suitable for video narration.';
      break;
  }

  // 根据保持程度设置一致性要求
  let consistencyInstruction = '';
  switch (config.consistency) {
    case 'high':
      consistencyInstruction = 'Maintain high consistency with the original content. Keep the original meaning, structure, and key phrases as much as possible.';
      break;
    case 'moderate':
      consistencyInstruction = 'Moderate adaptation of the original content. Adjust for better video presentation while preserving the core message.';
      break;
    case 'low':
      consistencyInstruction = 'Significant adaptation for optimal video presentation. Focus on engaging delivery and clear communication, allowing substantial changes from the original text.';
      break;
  }

  // 自定义要求
  const customInstructions = config.customRequirements ? `\nAdditional requirements: ${config.customRequirements}` : '';

  // --- Assemble content sections from all available input sources (not mutually exclusive) ---
  const sections: string[] = [];

  // 1. Markdown content
  if (markdownContent && markdownContent.trim()) {
    sections.push(`Markdown Content:\n${markdownContent}\n\nPlease analyze the markdown content above and generate a professional video script.`);
  }

  // 2. Chat messages (with 8000-char cap to avoid LLM context overflow)
  if (chatMessages && chatMessages.length > 0) {
    let chatContent = chatMessages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
    if (chatContent.length > 8000) {
      chatContent = chatContent.slice(-8000);
    }
    sections.push(`Chat Conversation:\n${chatContent}\n\nPlease analyze the chat conversation above, extract the key points and important information discussed, and generate a professional video script based on these discussion points.`);
  }

  // 3. Custom prompt (always included when present, never dropped)
  if (customPrompt && customPrompt.trim()) {
    sections.push(`User Requirements:\n${customPrompt.trim()}\n\nIncorporate the user requirements above into the generated script.`);
  }

  const contentSection = sections.join('\n\n---\n\n');

  return `You are an expert video script writer. Based on the following content, generate a professional video script.

${contentSection}

Please create a video script with the following requirements:

1. Divide the content into exactly ${config.segmentCount} logical segments
2. Each segment should represent a coherent part of the video (like introduction, main points, conclusion)
3. Each segment should contain 2-6 sentences that flow naturally
4. Estimate appropriate duration for each segment (in seconds)
5. ${languageInstruction}
6. ${consistencyInstruction}${customInstructions}

Return the result as a JSON object with this exact structure:
{
  "segments": [
    {
      "id": "segment-1",
      "title": "Segment Title",
      "duration": 15,
      "sentences": [
        {
          "id": "sentence-1-1",
          "text": "First sentence of the segment.",
          "startTime": 0,
          "endTime": 3
        },
        {
          "id": "sentence-1-2",
          "text": "Second sentence of the segment.",
          "startTime": 3,
          "endTime": 8
        }
      ]
    }
  ]
}

Important:
- Return ONLY the JSON object, no additional text or explanation
- Ensure all IDs are unique
- Make sure sentence timings add up to the segment duration
- Use clear, engaging language suitable for video narration
- Keep segments focused and coherent`;
};

// 日志记录函数
const logRequest = (markdownContent: string, taskId: string, config: any, chatMessages?: ChatMessage[], scriptConfig?: ScriptGenerationConfig) => {
  console.log(`[Video Script Generation API] ${new Date().toISOString()} - Incoming script generation request`);
  console.log(`[Video Script Generation API] Task ID: ${taskId}`);
  console.log(`[Video Script Generation API] Model: ${config.model}`);

  // 记录内容源
  if (chatMessages && chatMessages.length > 0) {
    console.log(`[Video Script Generation API] Content Source: Chat Messages`);
    console.log(`[Video Script Generation API] Chat messages count: ${chatMessages.length}`);
    console.log(`[Video Script Generation API] Chat messages preview:`,
      chatMessages.slice(0, 2).map(msg => `${msg.role}: ${msg.content.slice(0, 100)}...`).join(' | ')
    );
  } else {
    console.log(`[Video Script Generation API] Content Source: Markdown Content`);
    console.log(`[Video Script Generation API] Markdown content length: ${markdownContent?.length || 0} characters`);
    console.log(`[Video Script Generation API] Markdown preview: ${(markdownContent || '').slice(0, 200)}...`);
  }

  if (scriptConfig) {
    console.log(`[Video Script Generation API] Script Configuration:`);
    console.log(`[Video Script Generation API] - Language: ${scriptConfig.language}`);
    console.log(`[Video Script Generation API] - Consistency: ${scriptConfig.consistency}`);
    console.log(`[Video Script Generation API] - Segment Count: ${scriptConfig.segmentCount}`);
    console.log(`[Video Script Generation API] - Custom Requirements: ${scriptConfig.customRequirements || 'None'}`);
  }
};

const logResponse = (success: boolean, taskId: string, segmentCount?: number, error?: string) => {
  if (success) {
    console.log(`[Video Script Generation API] ${new Date().toISOString()} - Script generation completed successfully for task: ${taskId}`);
    console.log(`[Video Script Generation API] Generated ${segmentCount} script segments`);
  } else {
    console.error(`[Video Script Generation API] ${new Date().toISOString()} - Script generation failed for task: ${taskId} - ${error}`);
  }
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      markdownContent: rawMarkdownContent,
      taskId,
      scriptConfig,
      chatMessages: rawChatMessages,
      customPrompt,
    } = body as {
      markdownContent?: string;
      taskId: string;
      scriptConfig?: ScriptGenerationConfig;
      chatMessages?: ChatMessage[];
      customPrompt?: string;
    };

    // Apply truncation to chat messages if present
    const chatMessages = rawChatMessages
      ? truncateChatMessages(rawChatMessages)
      : undefined;

    // 验证请求参数 - 至少需要一个有效输入源
    const hasChatMessages = chatMessages && Array.isArray(chatMessages) && chatMessages.length > 0;
    const hasMarkdownContent = rawMarkdownContent && typeof rawMarkdownContent === 'string' && rawMarkdownContent.trim().length > 0;
    const hasCustomPrompt = typeof customPrompt === 'string' && customPrompt.trim().length > 0;

    if (!hasChatMessages && !hasMarkdownContent && !hasCustomPrompt) {
      console.error('[Video Script Generation API] Invalid request: at least one input source is required (chatMessages, markdownContent, or customPrompt)');
      return NextResponse.json(
        { error: 'At least one input source is required: chatMessages, markdownContent, or customPrompt' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      console.error('[Video Script Generation API] Invalid request: taskId is required');
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    // Pass through raw markdownContent only — buildScriptPrompt now handles
    // all three sources (markdownContent, chatMessages, customPrompt) via the
    // sections[] pattern, so we no longer pre-assemble or duplicate content here.
    const markdownContent: string = hasMarkdownContent ? rawMarkdownContent! : '';

    const config = await getConfig();
    logRequest(markdownContent, taskId, config, chatMessages, scriptConfig);

    // 复用按 api_type 选格式的共享 LLM 客户端（与 /api/chat、Agent 推理同款路径），把流式
    // content 累积成整串，保持下方原有「提取 {…} → JSON.parse → 校验 segments」逻辑不变。
    // 本路由自有的 system prompt、temperature(0.7)、max_tokens(3000) 一并保留。
    const messages = [
      {
        role: 'system',
        content: 'You are an expert video script writer. You always return valid JSON responses exactly as requested.'
      },
      {
        role: 'user',
        content: buildScriptPrompt(markdownContent, chatMessages, scriptConfig, customPrompt)
      }
    ];

    console.log(`[Video Script Generation API] Calling LLM API (api_type=${config.apiType}) base=${config.apiUrl} for task: ${taskId}`);

    // 调用LLM API
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
      temperature: 0.7,
      maxTokens: 3000,
    })) {
      if (event.kind === 'error') {
        upstreamError = { status: event.status, message: event.message };
        break;
      }
      if (event.kind === 'content') content += event.text;
    }

    if (upstreamError) {
      // 如实回传上游状态（401/429/…），不塌缩成 500。
      console.error(`[Video Script Generation API] LLM API error: ${upstreamError.status} - ${upstreamError.message} for task: ${taskId}`);
      logResponse(false, taskId, undefined, `LLM API error: ${upstreamError.status}`);

      const httpStatus = upstreamError.status >= 400 && upstreamError.status <= 599 ? upstreamError.status : 502;
      return NextResponse.json(
        { error: `LLM API error: ${upstreamError.status}` },
        { status: httpStatus }
      );
    }

    if (!content) {
      console.error(`[Video Script Generation API] No content in LLM response for task: ${taskId}`);
      logResponse(false, taskId, undefined, 'No content in LLM response');

      return NextResponse.json(
        { error: 'No content received from LLM' },
        { status: 500 }
      );
    }

    console.log(`[Video Script Generation API] Raw LLM response for task: ${taskId}: ${content.slice(0, 200)}...`);

    // 解析JSON响应
    let scriptData;
    try {
      // 尝试提取JSON部分（处理可能的额外文本）
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      scriptData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error(`[Video Script Generation API] Failed to parse LLM response as JSON for task: ${taskId}:`, parseError);
      console.error(`[Video Script Generation API] Raw content: ${content}`);
      logResponse(false, taskId, undefined, 'Failed to parse JSON response');

      return NextResponse.json(
        { error: 'Failed to parse script data from LLM response' },
        { status: 500 }
      );
    }

    // 验证响应格式
    if (!scriptData.segments || !Array.isArray(scriptData.segments)) {
      console.error(`[Video Script Generation API] Invalid script format for task: ${taskId} - missing segments array`);
      logResponse(false, taskId, undefined, 'Invalid script format');

      return NextResponse.json(
        { error: 'Invalid script format received' },
        { status: 500 }
      );
    }

    // 验证每个segment的格式
    for (let i = 0; i < scriptData.segments.length; i++) {
      const segment = scriptData.segments[i];
      if (!segment.id || !segment.title || !segment.sentences || !Array.isArray(segment.sentences)) {
        console.error(`[Video Script Generation API] Invalid segment format at index ${i} for task: ${taskId}`);
        logResponse(false, taskId, undefined, `Invalid segment format at index ${i}`);

        return NextResponse.json(
          { error: `Invalid segment format at index ${i}` },
          { status: 500 }
        );
      }

      // 验证每个sentence的格式
      for (let j = 0; j < segment.sentences.length; j++) {
        const sentence = segment.sentences[j];
        if (!sentence.id || !sentence.text) {
          console.error(`[Video Script Generation API] Invalid sentence format at segment ${i}, sentence ${j} for task: ${taskId}`);
          logResponse(false, taskId, undefined, `Invalid sentence format at segment ${i}, sentence ${j}`);

          return NextResponse.json(
            { error: `Invalid sentence format at segment ${i}, sentence ${j}` },
            { status: 500 }
          );
        }
      }
    }

    const segmentCount = scriptData.segments.length;
    const totalSentences = scriptData.segments.reduce((sum: number, seg: any) => sum + seg.sentences.length, 0);

    console.log(`[Video Script Generation API] Successfully generated script for task: ${taskId} - ${segmentCount} segments, ${totalSentences} sentences`);
    logResponse(true, taskId, segmentCount);

    return NextResponse.json({
      success: true,
      segments: scriptData.segments as ScriptSegment[],
      metadata: {
        segmentCount,
        totalSentences,
        generatedAt: new Date().toISOString(),
        taskId
      }
    });

  } catch (error) {
    console.error('[Video Script Generation API] Request processing error:', error);
    const taskId = 'unknown';
    logResponse(false, taskId, undefined, String(error));

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
