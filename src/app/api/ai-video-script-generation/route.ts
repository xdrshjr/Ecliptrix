import { NextRequest, NextResponse } from 'next/server';
import { ScriptGenerationConfig, ChatMessage } from '@/types';
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

// Resolve LLM credentials the same way /api/chat and Agent inference do: the
// DB-configured chat model first (via the FastAPI resolve endpoint), env vars
// as fallback. Crucially this returns `apiType`, so the call site can pick the
// correct OpenAI vs Anthropic transport. The previous direct `process.env`
// read here was api_type-blind and 401'd against Anthropic-compatible endpoints
// (e.g. the desktop default), because it always hit `/chat/completions`.
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
    console.warn('[AI Video Script Generation API] Failed to fetch model settings from backend, falling back to env vars');
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

/**
 * VideoInfo type for selected videos passed from the frontend.
 * Kept lightweight — only the fields the prompt needs.
 */
interface VideoInfo {
  id?: string;
  title?: string;
  url?: string;
  duration?: number;
}

/**
 * Build the user prompt for AI video script generation.
 *
 * Input sources (all optional, but at least one must be present — validated
 * before this function is called):
 *   - chatMessages: conversation history
 *   - customPrompt: user-supplied free-text requirements
 *   - videoAnalysisContext: pre-computed video analysis result text
 *   - scriptConfig: generation parameters (language, consistency, segment count)
 */
const buildAIVideoScriptPrompt = (
  chatMessages?: ChatMessage[],
  scriptConfig?: ScriptGenerationConfig,
  customPrompt?: string,
  videoAnalysisContext?: string,
  durationTarget?: number,
) => {
  const config = scriptConfig || {
    language: 'chinese',
    consistency: 'moderate',
    segmentCount: 5,
    customRequirements: ''
  };

  let languageInstruction = '';
  switch (config.language) {
    case 'chinese':
      languageInstruction = 'Generate the script in Chinese. Use vivid, descriptive Chinese suitable for AI video generation prompts.';
      break;
    case 'english':
      languageInstruction = 'Generate the script in English. Use vivid, descriptive English suitable for AI video generation prompts.';
      break;
    case 'mixed':
      languageInstruction = 'Generate the script in a mix of Chinese and English as appropriate. Use vivid, descriptive language suitable for AI video generation prompts.';
      break;
  }

  let consistencyInstruction = '';
  switch (config.consistency) {
    case 'high':
      consistencyInstruction = 'Stay very close to the original conversation content. Preserve the exact topics and details discussed.';
      break;
    case 'moderate':
      consistencyInstruction = 'Adapt the conversation content for visual storytelling while keeping the core message and themes.';
      break;
    case 'low':
      consistencyInstruction = 'Freely reinterpret the conversation for maximum visual impact. Focus on creating compelling video scenes.';
      break;
  }

  const customInstructions = config.customRequirements ? `\nAdditional requirements: ${config.customRequirements}` : '';

  // --- Assemble content sections from all available input sources ---

  const sections: string[] = [];

  // 1. Video analysis context (highest priority context)
  if (videoAnalysisContext && videoAnalysisContext.trim()) {
    // Truncate to 3000 chars per spec
    const trimmed = videoAnalysisContext.trim().length > 3000
      ? videoAnalysisContext.trim().slice(0, 3000) + '…'
      : videoAnalysisContext.trim();
    sections.push(`Video Analysis Context:\n${trimmed}\n\nUse the video analysis above as reference material for creating the scenes.`);
  }

  // 2. Chat messages
  if (chatMessages && chatMessages.length > 0) {
    // Cap total serialized content at 8000 chars to stay within LLM context.
    // Note: messages are already truncated to 50 by truncateChatMessages() before reaching here.
    let chatContent = chatMessages
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');
    if (chatContent.length > 8000) {
      chatContent = chatContent.slice(-8000);
    }
    sections.push(`Chat Conversation:\n${chatContent}\n\nAnalyze the chat conversation above and create AI video generation scenes based on the key points discussed.`);
  }

  // 3. Custom prompt (appended as explicit user requirements)
  if (customPrompt && customPrompt.trim()) {
    sections.push(`User Requirements:\n${customPrompt.trim()}\n\nIncorporate the user requirements above into the generated scenes.`);
  }

  const contentSection = sections.join('\n\n---\n\n');

  const durationConstraint = durationTarget
    ? `\n6. CRITICAL: The total narration duration must be approximately ${durationTarget} seconds. ` +
      `Each scene's scriptText should be about ${Math.round(durationTarget / config.segmentCount)} seconds when read aloud. ` +
      `For Chinese text, 1 second ≈ 4 characters. For English, 1 second ≈ 2.5 words. ` +
      `Keep each scene's scriptText within ${Math.round((durationTarget / config.segmentCount) * 4)} Chinese characters or ${Math.round((durationTarget / config.segmentCount) * 2.5)} English words.`
    : '';

  return `You are an expert AI video script writer. Based on the following content, create a series of video scene descriptions optimized for AI video generation, along with narration scripts for voiceover.

${contentSection}

Requirements:
1. Create exactly ${config.segmentCount} scenes
2. Each scene needs:
   - A short descriptive title
   - A scriptText: vivid visual description suitable as a prompt for AI video generation (describe what should appear in the video: characters, actions, environments, lighting, camera angles, mood)
   - A narrationText: voiceover narration script that will be converted to speech via TTS. This should be conversational, narrative text suitable for spoken delivery — NOT visual descriptions. Write it as if a narrator is telling a story or explaining to the audience.
3. ${languageInstruction}
4. ${consistencyInstruction}${customInstructions}${durationConstraint}

Return the result as a JSON object with this exact structure:
{
  "segments": [
    {
      "title": "Scene title describing the scene",
      "scriptText": "Detailed visual description for AI video generation. Describe the scene, characters, actions, environment, lighting, and mood.",
      "narrationText": "Voiceover narration script for this scene. Written in a conversational, narrative tone suitable for TTS speech synthesis."
    }
  ]
}

Important:
- Return ONLY the JSON object, no additional text
- Each scriptText should be 2-4 sentences of vivid visual description
- Each narrationText should be 2-4 sentences of engaging spoken narration
- scriptText focuses on VISUAL elements (what the viewer sees)
- narrationText focuses on SPOKEN content (what the viewer hears as voiceover)
- Titles should be concise (under 20 characters)`;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      taskId,
      scriptConfig,
      chatMessages: rawChatMessages,
      customPrompt,
      videoAnalysisContext,
      selectedVideos,
      durationTarget,
    } = body as {
      taskId: string;
      scriptConfig?: ScriptGenerationConfig;
      chatMessages?: ChatMessage[];
      customPrompt?: string;
      videoAnalysisContext?: string;
      selectedVideos?: VideoInfo[];
      durationTarget?: number;
    };

    // --- Input validation ---

    // Apply truncation to chat messages if present
    const chatMessages = rawChatMessages
      ? truncateChatMessages(rawChatMessages)
      : undefined;

    const hasChatMessages = chatMessages && Array.isArray(chatMessages) && chatMessages.length > 0;
    const hasCustomPrompt = typeof customPrompt === 'string' && customPrompt.trim().length > 0;
    const hasVideoAnalysis = typeof videoAnalysisContext === 'string' && videoAnalysisContext.trim().length > 0;

    // At least one input source must be non-empty
    if (!hasChatMessages && !hasCustomPrompt && !hasVideoAnalysis) {
      return NextResponse.json(
        { error: 'At least one input source is required: chatMessages, customPrompt, or videoAnalysisContext' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { error: 'Task ID is required' },
        { status: 400 }
      );
    }

    const config = await getConfig();

    const inputSources: string[] = [];
    if (hasChatMessages) inputSources.push(`chatMessages(${chatMessages!.length})`);
    if (hasCustomPrompt) inputSources.push('customPrompt');
    if (hasVideoAnalysis) inputSources.push('videoAnalysisContext');
    if (selectedVideos && selectedVideos.length > 0) inputSources.push(`selectedVideos(${selectedVideos.length})`);

    console.log(`[AI Video Script Generation API] ${new Date().toISOString()} - Request for task: ${taskId}, sources: [${inputSources.join(', ')}]`);

    // Reuse the shared, api_type-aware LLM client (same path as /api/chat and
    // Agent inference) and accumulate the streamed content into one string, so
    // the existing non-streaming "extract {…} → JSON.parse → validate segments"
    // logic below stays unchanged. This route's own system prompt, temperature
    // (0.7) and max_tokens (3000) are preserved.
    const messages = [
      {
        role: 'system',
        content: 'You are an expert AI video script writer. You create vivid scene descriptions for AI video generation. You always return valid JSON responses exactly as requested.'
      },
      {
        role: 'user',
        content: buildAIVideoScriptPrompt(chatMessages, scriptConfig, customPrompt, videoAnalysisContext, durationTarget)
      }
    ];

    console.log(`[AI Video Script Generation API] Calling LLM API (api_type=${config.apiType}) base=${config.apiUrl} for task: ${taskId}`);

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
      // Preserve the upstream status (401/429/…) instead of collapsing to 500.
      console.error(`[AI Video Script Generation API] LLM API error: ${upstreamError.status} - ${upstreamError.message}`);
      const httpStatus = upstreamError.status >= 400 && upstreamError.status <= 599 ? upstreamError.status : 502;
      return NextResponse.json(
        { error: `LLM API error: ${upstreamError.status}` },
        { status: httpStatus }
      );
    }

    if (!content) {
      return NextResponse.json(
        { error: 'No content received from LLM' },
        { status: 500 }
      );
    }

    let scriptData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;
      scriptData = JSON.parse(jsonString);
    } catch {
      console.error(`[AI Video Script Generation API] Failed to parse JSON for task: ${taskId}`);
      return NextResponse.json(
        { error: 'Failed to parse script data from LLM response' },
        { status: 500 }
      );
    }

    if (!scriptData.segments || !Array.isArray(scriptData.segments)) {
      return NextResponse.json(
        { error: 'Invalid script format received' },
        { status: 500 }
      );
    }

    // Validate and normalize segments
    const segments = scriptData.segments.map((seg: { title?: string; scriptText?: string; narrationText?: string }, index: number) => ({
      title: seg.title || `Scene ${index + 1}`,
      scriptText: seg.scriptText || '',
      narrationText: seg.narrationText || seg.scriptText || '', // fallback to scriptText if narrationText missing
    }));

    console.log(`[AI Video Script Generation API] Generated ${segments.length} scenes for task: ${taskId}`);

    return NextResponse.json({
      success: true,
      segments,
      metadata: {
        segmentCount: segments.length,
        generatedAt: new Date().toISOString(),
        taskId
      }
    });

  } catch (error) {
    console.error('[AI Video Script Generation API] Request processing error:', error);

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
