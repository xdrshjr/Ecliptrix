/**
 * Prompt Polish API Client
 * 提示词润色优化 API 客户端
 *
 * Calls the Next.js API route /api/prompt-polish to polish user prompts
 * using LLM before video script generation.
 */

import { ApiError, TimeoutError, http } from '@/lib/api/http-client';
import { ChatMessage } from '@/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolishPromptParams {
  /** The raw user prompt to polish (required, non-empty) */
  prompt: string;
  /** Optional chat messages for additional context */
  chatMessages?: ChatMessage[];
  /** Optional video analysis summary for context */
  videoAnalysisContext?: string;
  /** Target script type — affects polish direction */
  targetType: 'ai-video' | 'normal';
}

export interface PolishPromptResponse {
  success: boolean;
  polishedPrompt: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// API function
// ---------------------------------------------------------------------------

/**
 * Polish a user prompt via the /api/prompt-polish endpoint.
 *
 * Preserves the legacy "always returns a structured response" contract so
 * existing UI components do not need to add try/catch. Wrapper errors are
 * mapped to a `success: false` envelope here; we explicitly DO NOT
 * string-match against `err.message` (per spec AC #8) — we use the typed
 * errors from S03.
 */
export async function polishPrompt(params: PolishPromptParams): Promise<PolishPromptResponse> {
  const { prompt, chatMessages, videoAnalysisContext, targetType } = params;

  try {
    const data = await http.post<PolishPromptResponse>(
      '/api/prompt-polish',
      { prompt, chatMessages, videoAnalysisContext, targetType },
      // Slightly longer than server-side 30s timeout
      { timeoutMs: 35_000 },
    );

    return {
      success: data.success,
      polishedPrompt: data.polishedPrompt ?? '',
      message: data.message,
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      return {
        success: false,
        polishedPrompt: '',
        message: '请求超时，请重试',
      };
    }

    if (error instanceof ApiError) {
      return {
        success: false,
        polishedPrompt: '',
        message: error.message || `Request failed with status ${error.status}`,
      };
    }

    return {
      success: false,
      polishedPrompt: '',
      message: '网络错误，请检查连接后重试',
    };
  }
}
