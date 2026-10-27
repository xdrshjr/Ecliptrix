/**
 * summarizeConversation.ts — fold part of a conversation into a verified digest.
 *
 * Design baseline: docs/plans/agent-research-crew-and-context-memory/spec.md
 * §3.4.2. The model call is injected (`deps.complete`) so the pipeline —
 * transcript → prompt → strict parse → identifier check → render — is testable
 * without a network; the route supplies the real `completeSimple` caller.
 *
 * Failure never throws to the caller: every path returns
 * `{ success: false, error_code }` and the client writes nothing, leaving the
 * lossy `budgetModelContext` fallback in charge (spec §3.4.2 step 6).
 *
 * Server-side: reaches `modelContextBudget`, which imports the pi-ai root.
 */

import type { ChatMessage } from '@/types';
import { buildTranscriptRows, fitTranscript } from './buildTranscript';
import { estimateConversationTokens, estimateTextTokens } from './estimateTokens';
import {
  buildSummaryPrompt, normalizeLocale, renderSummaryMarkdown, type ConversationSummary,
} from './summaryTemplate';
import { InvalidSummaryError, parseSummaryJson, verifyIdentifiers } from './summaryValidation';

/** Error codes are API (spec §5.2): renaming one is a breaking change. */
export type CompactErrorCode =
  | 'compact_model_unavailable'
  | 'compact_timeout'
  | 'compact_invalid_summary'
  | 'compact_input_too_large';

export class CompactionError extends Error {
  constructor(readonly code: CompactErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CompactionError';
  }
}

export const TRANSCRIPT_MAX_CHARS = 60_000;
export const SUMMARY_MAX_OUTPUT_TOKENS = 1_800;
export const SUMMARY_TEMPERATURE = 0.2;
export const SUMMARY_TIMEOUT_MS = 45_000;

export type ModelTier = 'fast' | 'main';

export interface CompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  /** Fires on the total timeout and on the caller's own cancellation. */
  signal: AbortSignal;
}

export interface CompletionResult {
  text: string;
  modelTier: ModelTier;
}

export interface SummarizeDeps {
  /** @throws CompactionError (`compact_model_unavailable`) when no model answers. */
  complete: (request: CompletionRequest) => Promise<CompletionResult>;
}

export interface SummarizeInput {
  /** The folded segment, already cut by the client. */
  messages: ChatMessage[];
  /** Digest of an earlier fold; merged into the new one (rolling compaction). */
  previousSummary?: string;
  locale?: string;
}

export interface SummarizeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type SummarizeResult =
  | {
    success: true;
    summary: ConversationSummary;
    text: string;
    tokensBefore: number;
    tokensAfter: number;
    droppedIds: number;
    modelTier: ModelTier;
  }
  | { success: false; error_code: CompactErrorCode };

/** Race the model against the total deadline and the caller's cancellation. */
async function completeWithDeadline(
  deps: SummarizeDeps,
  request: Omit<CompletionRequest, 'signal'>,
  options: SummarizeOptions,
): Promise<CompletionResult> {
  const { signal, timeoutMs = SUMMARY_TIMEOUT_MS } = options;
  if (signal?.aborted) throw new CompactionError('compact_model_unavailable', 'cancelled');
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CompactionError('compact_timeout', `${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deps.complete({ ...request, signal: controller.signal }), deadline,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}

function toFailureCode(error: unknown): CompactErrorCode {
  if (error instanceof CompactionError) return error.code;
  if (error instanceof InvalidSummaryError) return 'compact_invalid_summary';
  return 'compact_model_unavailable';
}

/**
 * Summarize `input.messages` into a verified, rendered digest.
 *
 * @param input The folded segment, an optional previous digest and the locale.
 * @param deps Injected model call.
 * @param options Cancellation signal and total timeout (default 45 s).
 * @returns The digest and its token accounting, or `{ success: false, error_code }`.
 */
export async function summarizeConversation(
  input: SummarizeInput,
  deps: SummarizeDeps,
  options: SummarizeOptions = {},
): Promise<SummarizeResult> {
  const locale = normalizeLocale(input.locale);
  const transcript = fitTranscript(buildTranscriptRows(input.messages), TRANSCRIPT_MAX_CHARS);
  if (transcript === null) return { success: false, error_code: 'compact_input_too_large' };
  const previousSummary = input.previousSummary?.trim() || undefined;
  try {
    const prompt = buildSummaryPrompt({ transcript, previousSummary, locale });
    const reply = await completeWithDeadline(deps, {
      ...prompt, maxTokens: SUMMARY_MAX_OUTPUT_TOKENS, temperature: SUMMARY_TEMPERATURE,
    }, options);
    const verified = verifyIdentifiers(
      parseSummaryJson(reply.text), `${transcript}\n${previousSummary ?? ''}`);
    if (!verified.summary.goal) throw new InvalidSummaryError('goal is empty');
    const text = renderSummaryMarkdown(verified.summary, locale);
    return {
      success: true,
      summary: verified.summary,
      text,
      tokensBefore: estimateConversationTokens(input.messages),
      tokensAfter: estimateTextTokens(text),
      droppedIds: verified.droppedIds,
      modelTier: reply.modelTier,
    };
  } catch (error) {
    const code = toFailureCode(error);
    console.warn(`[VideoEditingAgent] compaction failed code=${code} `
      + `messages=${input.messages.length}`);
    return { success: false, error_code: code };
  }
}
