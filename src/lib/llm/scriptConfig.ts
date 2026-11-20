import { backendConfig } from '@/lib/config/backend';
import { normalizeApiType, type StreamLlmConfig } from './streamLlmChat';

export class ScriptLlmError extends Error {
  constructor(readonly code: string, readonly status = 503) { super(code); }
}

function assertScriptNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const isTimeout = signal.reason?.name === 'TimeoutError';
  throw new ScriptLlmError(
    isTimeout ? 'LLM_TIMEOUT' : 'LLM_CANCELLED', isTimeout ? 504 : 499,
  );
}

/** 后端已负责 DB/SkillRouter/旧手动环境的选择；拒绝与不可达都不能改用另一把 Key。 */
export async function resolveScriptConfig(signal: AbortSignal): Promise<StreamLlmConfig> {
  let response: Response;
  try {
    response = await fetch(backendConfig.joinPath('/api/model-settings/resolve/chat'), {
      cache: 'no-store', signal,
    });
  } catch {
    assertScriptNotAborted(signal);
    throw new ScriptLlmError('MODEL_RESOLUTION_UNAVAILABLE');
  }
  const data = await response.json().catch(() => null);
  assertScriptNotAborted(signal);
  if (!response.ok || !data?.success) {
    const code = typeof data?.error_code === 'string' && /^[a-zA-Z][\w]{0,79}$/.test(data.error_code)
      ? data.error_code : 'MODEL_RESOLUTION_FAILED';
    throw new ScriptLlmError(code, response.status >= 400 ? response.status : 502);
  }
  if (![data.api_url, data.api_key, data.model_name].every(v => typeof v === 'string' && v.trim())
    || !['openai', 'anthropic', undefined, null, ''].includes(data.api_type)) throw new ScriptLlmError('MODEL_RESOLUTION_INVALID', 502);
  return { apiUrl: data.api_url, apiKey: data.api_key, model: data.model_name, apiType: normalizeApiType(data.api_type) };
}

export function scriptFailure(error: unknown) {
  const code = error instanceof ScriptLlmError ? error.code : 'LLM_REQUEST_FAILED';
  return { success: false, error: code, error_code: code, message: code,
    error_details: { retryable: false, failure_class: code === 'LLM_CANCELLED' ? 'cancelled'
      : /AUTHENTICATION|MODEL_|models_|credential/.test(code) ? 'configuration' : 'transient' } };
}
