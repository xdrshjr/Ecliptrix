import type { KnownApi } from '@mariozechner/pi-ai';

/**
 * Map provider_type + api_type from backend to pi-ai api/provider values.
 *
 * Precedence: explicit `apiType` wins when present. Without it we fall back to
 * `providerType`, which keeps backward compatibility for legacy providers
 * (kimi_coding / claude_coding / anthropic) whose protocol was historically
 * inferred from the brand name. Custom providers MUST send `apiType` —
 * without it, an Anthropic-compatible custom endpoint silently downgrades to
 * OpenAI-format requests, the Agent SDK fails to parse the response, and
 * users see the "model returned an empty response" tool-use error.
 */
export function resolveModelFormat(
  providerType?: string,
  apiType?: 'openai' | 'anthropic',
): { api: KnownApi; provider: string } {
  if (apiType === 'anthropic') {
    const provider = providerType === 'kimi_coding' ? 'kimi-coding' : 'anthropic';
    return { api: 'anthropic-messages', provider };
  }
  if (apiType === 'openai') {
    return { api: 'openai-completions', provider: providerType || 'openai' };
  }
  switch (providerType) {
    case 'kimi_coding':
      return { api: 'anthropic-messages', provider: 'kimi-coding' };
    case 'claude_coding':
    case 'anthropic':
      return { api: 'anthropic-messages', provider: 'anthropic' };
    default:
      return { api: 'openai-completions', provider: 'openai' };
  }
}
