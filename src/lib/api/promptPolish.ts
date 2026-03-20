/**
 * Prompt Polish API Client
 * 提示词润色优化 API 客户端
 *
 * Calls the Next.js API route /api/prompt-polish to polish user prompts
 * using LLM before video script generation.
 */

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
 * @param params - The prompt and optional context to send for polishing
 * @returns The polished prompt along with success status
 * @throws Error if the network request fails or returns a non-OK status
 *
 * @example
 * ```ts
 * const result = await polishPrompt({
 *   prompt: '做一个关于猫的视频',
 *   targetType: 'ai-video',
 * });
 * if (result.success) {
 *   console.log(result.polishedPrompt);
 * }
 * ```
 */
export async function polishPrompt(params: PolishPromptParams): Promise<PolishPromptResponse> {
  const { prompt, chatMessages, videoAnalysisContext, targetType } = params;

  console.log('[PromptPolish API Client] Sending polish request', {
    promptLength: prompt.length,
    chatMessagesCount: chatMessages?.length ?? 0,
    hasVideoAnalysis: !!videoAnalysisContext,
    targetType,
  });

  try {
    const response = await fetch('/api/prompt-polish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        chatMessages,
        videoAnalysisContext,
        targetType,
      }),
      signal: AbortSignal.timeout(35000), // Slightly longer than server-side 30s timeout
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[PromptPolish API Client] Server returned error', {
        status: response.status,
        message: data.message,
      });

      // Return structured error rather than throwing, so the UI can display
      // a user-friendly message without needing a try/catch.
      return {
        success: false,
        polishedPrompt: '',
        message: data.message || `Request failed with status ${response.status}`,
      };
    }

    console.log('[PromptPolish API Client] Polish completed successfully', {
      polishedLength: data.polishedPrompt?.length ?? 0,
    });

    return {
      success: data.success,
      polishedPrompt: data.polishedPrompt ?? '',
      message: data.message,
    };

  } catch (error) {
    // Handle timeout specifically
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      console.error('[PromptPolish API Client] Request timed out');
      return {
        success: false,
        polishedPrompt: '',
        message: '请求超时，请重试',
      };
    }

    // Network / fetch failure
    console.error('[PromptPolish API Client] Network error:', error);
    return {
      success: false,
      polishedPrompt: '',
      message: '网络错误，请检查连接后重试',
    };
  }
}
