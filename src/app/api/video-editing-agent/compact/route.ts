import { NextRequest } from 'next/server';
import { backendConfig } from '@/lib/config/backend';
import { normalizeApiType } from '@/lib/llm/streamLlmChat';
import { researchOriginAllowed, researchProxyError } from '@/lib/server/researchUiOrigin';
import {
  createCompactionCompleter, type ModelResolver, type ResolvedModelConfig,
} from '@/lib/video-editing-agent/memory/compactionModel';
import {
  summarizeConversation, type SummarizeInput,
} from '@/lib/video-editing-agent/memory/summarizeConversation';
import type { ChatMessage } from '@/types';

/**
 * `POST /api/video-editing-agent/compact` —— 把对话的较早部分折叠成结构化摘要。
 *
 * 设计基线：docs/plans/agent-research-crew-and-context-memory/spec.md §3.4.2 / §5.2。
 * 模型失败一律 HTTP 200 + `{ success: false, error_code }`：客户端据此不写入任何
 * 压缩消息，对话保持现状。日志只记条数与错误码，不记对话正文。
 */

const MAX_BODY_BYTES = 400 * 1024;
const MAX_MESSAGES = 400;
const MAX_PREVIOUS_SUMMARY_CHARS = 8_000;
const FAST_RESOLVE_TIMEOUT_MS = 2_000;
const MAIN_RESOLVE_TIMEOUT_MS = 5_000;
const ROLES: ReadonlySet<string> = new Set(['user', 'assistant', 'system']);

type Tier = Parameters<ModelResolver>[0];

function failure(code: string, status: number) {
  return researchProxyError(code, status);
}

/** 先 Content-Type、再 Origin：`write=true` 会把缺 JSON 头误报成 403（评审 R-05）。 */
function guardRequest(request: NextRequest): Response | null {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.startsWith('application/json')) {
    return failure('json_required', 415);
  }
  if (!request.headers.get('origin') || !researchOriginAllowed(request, false)) {
    return failure('origin_forbidden', 403);
  }
  return null;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const { id, role, content } = value as Record<string, unknown>;
  return typeof id === 'string' && typeof content === 'string'
    && typeof role === 'string' && ROLES.has(role);
}

/** Boundary validation, once: later code trusts the shape. */
function parseInput(parsed: unknown): SummarizeInput | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const { messages, previousSummary, locale } = parsed as Record<string, unknown>;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES) return null;
  if (!messages.every(isChatMessage)) return null;
  if (previousSummary !== undefined && (typeof previousSummary !== 'string'
    || previousSummary.length > MAX_PREVIOUS_SUMMARY_CHARS)) return null;
  if (locale !== undefined && typeof locale !== 'string') return null;
  return { messages, previousSummary, locale };
}

function envFallback(): ResolvedModelConfig | null {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return {
    apiUrl: process.env.LLM_API_URL || process.env.OPENAI_API_URL || 'https://api.openai.com/v1',
    apiKey,
    model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
    apiType: normalizeApiType(process.env.LLM_API_TYPE),
  };
}

function toResolvedConfig(data: Record<string, unknown>): ResolvedModelConfig | null {
  if (!data.success || !data.api_key || !data.api_url || !data.model_name) return null;
  return {
    apiUrl: String(data.api_url),
    apiKey: String(data.api_key),
    model: String(data.model_name),
    providerType: typeof data.provider_type === 'string' ? data.provider_type : undefined,
    apiType: normalizeApiType(typeof data.api_type === 'string' ? data.api_type : null),
  };
}

/**
 * Same source as the chat route's `getConfig`: the settings centre wins, the
 * `.env` model is only the main tier's last resort. A failed fast lookup is not
 * an error — the caller falls back to the main tier.
 */
const resolveFromBackend: ModelResolver = async (tier: Tier) => {
  const timeoutMs = tier === 'fast' ? FAST_RESOLVE_TIMEOUT_MS : MAIN_RESOLVE_TIMEOUT_MS;
  try {
    const response = await fetch(
      backendConfig.joinPath(`/api/model-settings/resolve/${tier === 'fast' ? 'fast' : 'chat'}`),
      { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) },
    );
    if (response.ok) {
      const resolved = toResolvedConfig(await response.json() as Record<string, unknown>);
      if (resolved) return resolved;
    }
  } catch {
    console.warn(`[VideoEditingAgent] compact: resolve/${tier} unavailable`);
  }
  return tier === 'main' ? envFallback() : null;
};

async function readInput(request: NextRequest): Promise<SummarizeInput | 'too_large' | null> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return 'too_large';
  try {
    return parseInput(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const denied = guardRequest(request);
  if (denied) return denied;
  const input = await readInput(request);
  if (input === 'too_large') return failure('payload_too_large', 413);
  if (!input) return failure('invalid_messages', 400);
  try {
    const complete = createCompactionCompleter(resolveFromBackend);
    const result = await summarizeConversation(input, { complete }, { signal: request.signal });
    console.log(`[VideoEditingAgent] compact ${result.success ? 'ok' : result.error_code} `
      + `messages=${input.messages.length}`);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[VideoEditingAgent] compact failed unexpectedly');
    return failure('internal_error', 500);
  }
}
