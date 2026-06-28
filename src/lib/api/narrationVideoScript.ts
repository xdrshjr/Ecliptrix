/**
 * Narration → AI Video Script API Client
 * 「旁白 → 画面脚本」转换客户端
 *
 * Calls the Next.js API route /api/narration-video-script to turn ONE narration
 * sentence into a distinct AI video shot/scene description (NOT a paraphrase of
 * the narration). Mirrors promptPolish's fault-tolerant contract: it ALWAYS
 * resolves to a structured envelope and NEVER throws, so callers do not need
 * try/catch. The route's 422 (IDENTICAL_OUTPUT / EMPTY) and 503
 * (LLM_NOT_CONFIGURED) arrive here as ApiError; we map them to a
 * `success: false` envelope, preserving the structured `code`/`message`.
 */

import { ApiError, TimeoutError, http } from '@/lib/api/http-client';

export interface NarrationVideoScriptResult {
  success: boolean;
  videoScript: string;
  code?: string;
  message?: string;
}

export async function generateNarrationVideoScript(
  narration: string,
  fullScript?: string,
  locale?: 'zh' | 'en',
): Promise<NarrationVideoScriptResult> {
  const raw = (narration || '').trim();
  if (!raw) {
    return { success: false, videoScript: '', code: 'EMPTY', message: 'empty narration' };
  }

  try {
    const data = await http.post<NarrationVideoScriptResult>(
      '/api/narration-video-script',
      { narration: raw, fullScript, locale },
      // Slightly longer than the server-side 30s timeout.
      { timeoutMs: 35_000 },
    );

    return {
      success: !!data.success,
      videoScript: data.videoScript ?? '',
      code: data.code,
      message: data.message,
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      return { success: false, videoScript: '', code: 'TIMEOUT', message: '请求超时，请重试' };
    }

    if (error instanceof ApiError) {
      // http-client parses the route's structured body into `error.code`
      // (error_code / errorCode / code) and `error.message`, so a 422
      // IDENTICAL_OUTPUT / 503 LLM_NOT_CONFIGURED survives the throw boundary.
      return {
        success: false,
        videoScript: '',
        code: error.code,
        message: error.message || `Request failed with status ${error.status}`,
      };
    }

    return { success: false, videoScript: '', code: 'NETWORK_ERROR', message: '网络错误，请检查连接后重试' };
  }
}
