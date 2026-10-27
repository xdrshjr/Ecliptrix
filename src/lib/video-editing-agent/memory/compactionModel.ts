/**
 * compactionModel.ts — the real model call behind `summarizeConversation`.
 *
 * Tier policy (spec §3.4.2 step 2, D-8): the fast model summarizes when one is
 * configured, otherwise the main chat model does. Resolution is injected
 * (`ModelResolver`) so this file holds no network code of its own: the route is
 * the only place that talks to `/api/model-settings/resolve/*`.
 *
 * Server-side only: imports the pi-ai root and the agent module.
 */

import { completeSimple } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';
import { resolveModelFormat } from '../modelFormat';
import {
  CompactionError, SUMMARY_MAX_OUTPUT_TOKENS,
  type CompletionRequest, type CompletionResult, type ModelTier, type SummarizeDeps,
} from './summarizeConversation';

const DEFAULT_CONTEXT_WINDOW = 128_000;
const ERROR_DETAIL_CHARS = 120;

/** Credentials and routing for one model, as `resolve/<function>` returns them. */
export interface ResolvedModelConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  providerType?: string;
  apiType: 'openai' | 'anthropic';
}

/** Resolves the model for a tier; `null` when none is configured or reachable. */
export type ModelResolver = (tier: ModelTier) => Promise<ResolvedModelConfig | null>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildModel(config: ResolvedModelConfig): Model<any> {
  const { api, provider } = resolveModelFormat(config.providerType, config.apiType);
  return {
    id: config.model, name: config.model, api, provider, baseUrl: config.apiUrl,
    reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
  };
}

async function runCompletion(
  config: ResolvedModelConfig,
  request: CompletionRequest,
): Promise<string> {
  const reply = await completeSimple(buildModel(config), {
    systemPrompt: request.systemPrompt,
    messages: [{ role: 'user', content: request.userPrompt, timestamp: Date.now() }],
  }, {
    apiKey: config.apiKey,
    signal: request.signal,
    maxTokens: request.maxTokens,
    temperature: request.temperature,
  });
  if (reply.stopReason === 'error' || reply.stopReason === 'aborted') {
    const detail = (reply.errorMessage ?? reply.stopReason).slice(0, ERROR_DETAIL_CHARS);
    throw new CompactionError('compact_model_unavailable', detail);
  }
  return reply.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('');
}

/**
 * Build the `complete` dependency: fast tier first, main tier as the fallback.
 *
 * @throws CompactionError (`compact_model_unavailable`) from the returned
 *   function when no tier resolves or the provider answers with an error.
 */
export function createCompactionCompleter(resolve: ModelResolver): SummarizeDeps['complete'] {
  return async (request): Promise<CompletionResult> => {
    const fast = await resolve('fast');
    const config = fast ?? await resolve('main');
    if (!config) throw new CompactionError('compact_model_unavailable', 'no model configured');
    return { text: await runCompletion(config, request), modelTier: fast ? 'fast' : 'main' };
  };
}
