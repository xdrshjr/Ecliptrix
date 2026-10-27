import { createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { AssistantMessage, AssistantMessageEventStream, Context, Message }
  from '@mariozechner/pi-ai';
import { collectResearchArtifactIds, groupToolBatches } from './historyBudget';
import type { ResearchCoverage } from '@/types/webResearch';

const EVIDENCE_KINDS = ['page_text', 'search_snippet', 'unavailable'];
const MODEL_STATUSES = ['disabled', 'skipped', 'succeeded', 'failed'];

/** Wire data and old projects must not invent coverage from absent counts. */
export function validResearchCoverage(value: unknown): ResearchCoverage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const counts = value as ResearchCoverage;
  if (![counts.selected, counts.page_text, counts.search_snippet, counts.unavailable]
    .every(count => Number.isSafeInteger(count) && count >= 0 && count <= 5)) return;
  if (counts.selected !== counts.page_text + counts.search_snippet + counts.unavailable) return;
  return { selected: counts.selected, page_text: counts.page_text,
    search_snippet: counts.search_snippet, unavailable: counts.unavailable };
}

function researchMetadata(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  if (typeof value.quality === 'string' &&
    ['full_text', 'mixed', 'snippets_only', 'none'].includes(value.quality)) {
    result.quality = value.quality;
  }
  if (value.degraded === null || (typeof value.degraded === 'string' &&
    ['no_sources', 'sources_unavailable', 'research_model_unavailable',
      'excerpts_only', 'partial_sources'].includes(value.degraded))) {
    result.degraded = value.degraded;
  }
  const coverage = validResearchCoverage(value.coverage);
  if (coverage) result.coverage = coverage;
  const sources = Array.isArray(value.sources) ? value.sources : value.source_refs;
  if (Array.isArray(sources)) {
    const ids = new Set<string>();
    result.source_refs = sources.flatMap(source => {
      if (!source || typeof source !== 'object') return [];
      const { id, evidence_kind: kind } = source;
      if (typeof id !== 'string' || !id.trim() ||
        new TextEncoder().encode(id).length > 128 || ids.has(id)) return [];
      ids.add(id);
      return [{ id, ...(EVIDENCE_KINDS.includes(kind) ? { evidence_kind: kind } : {}) }];
    }).slice(0, 5);
  }
  const usage = value.model_usage as { synthesis?: { status?: unknown } } | undefined;
  const status = usage ? usage.synthesis?.status : value.model_status;
  result.model_status = typeof status === 'string' && MODEL_STATUSES.includes(status)
    ? status : 'unknown';
  result.evidence_note = '压缩摘要不等于完整证据；使用 artifact_id 读取';
  return result;
}

export function utf8Slice(text: string, maxBytes: number): string {
  let bytes = 0;
  let result = '';
  for (const character of text) {
    bytes += new TextEncoder().encode(character).length;
    if (bytes > maxBytes) break;
    result += character;
  }
  return result;
}

const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * The single conversion shared by every budget in this module (spec §3.3):
 * a conservative floor of 2 bytes per token. Mixing a byte count into a token
 * quota made the schema allowance collapse near the window floor and reject
 * every `explore_tools` call (spec §12.3 D-07 / AC-38), so both directions
 * live here and nowhere else.
 */
export const BYTES_PER_TOKEN = 2;

/** Bytes → token estimate (ceiling: the estimate is never under-reported). */
export function bytesToTokens(bytes: number): number {
  return Math.ceil(bytes / BYTES_PER_TOKEN);
}

/** Token quota → byte allowance (floor: the allowance is never overstated). */
export function tokensToBytes(tokens: number): number {
  return Math.max(0, Math.floor(tokens * BYTES_PER_TOKEN));
}

/** Keep the handles required to continue reading or using a browser snapshot. */
export function compactResearchReference(value: Record<string, unknown>, summaryBytes = 512) {
  const reference: Record<string, unknown> = researchMetadata(value);
  for (const key of ['artifact_id', 'snapshot_artifact_id', 'screenshot_artifact_id',
    'session_id', 'title', 'error_code']) {
    if (typeof value[key] === 'string') reference[key] = utf8Slice(value[key], 256);
  }
  for (const key of ['success', 'snapshot_version', 'next_offset', 'has_more']) {
    if (typeof value[key] === 'number' || typeof value[key] === 'boolean') reference[key] = value[key];
  }
  if (!Array.isArray(reference.source_refs) && Array.isArray(value.source_ids)) reference.source_ids = value.source_ids
    .filter((id): id is string => typeof id === 'string').slice(0, 8).map(id => utf8Slice(id, 128));
  const summary = value.summary ?? value.brief ?? value.text ?? value.content;
  reference.summary = utf8Slice(typeof summary === 'string' ? summary : '', summaryBytes);
  return reference;
}

/** The preliminary planning call uses the same conservative input accounting. */
export function budgetThinkingMessages(input: { role: string; content: string }[], windowTokens: number) {
  const messages = [...input];
  const maxTokens = 800;
  const limit = windowTokens - maxTokens - 2048;
  const latestUser = [...messages].reverse().find(message => message.role === 'user');
  const estimate = () =>
    bytesToTokens(byteLength({ messages }) + 16 * messages.length + 1024);
  while (estimate() > limit) {
    const index = messages.findIndex(message => message.role !== 'system' && message !== latestUser);
    if (index < 0) throw new Error('context_budget_exceeded');
    messages.splice(index, 1);
  }
  return { messages, maxTokens };
}

export function compactResult(message: Message, summaryBytes = 512): Message {
  if (message.role !== 'toolResult') return message;
  const content = message.content.filter(block => block.type !== 'image');
  if (summaryBytes === 512 && byteLength(content) < 1800) return { ...message, content };
  let reference: Record<string, unknown> = {};
  const text = content.filter(b => b.type === 'text').map(b => b.text).join('');
  try {
    const raw = JSON.parse(text);
    const parsed = raw.data ?? raw;
    reference = compactResearchReference(parsed, summaryBytes);
  } catch { reference = { summary: utf8Slice(text, summaryBytes) }; }
  return { ...message, content: [{ type: 'text', text: JSON.stringify({
    ...reference, omitted: 'Read the artifact or query current editor state for more.',
  }) }] };
}

/** Only the provider view is compacted; stored messages and undo stay intact. */
export function budgetModelContext(
  input: Context,
  // v2 R-V2-04：默认 128000 与 agent.ts 历史硬编码持平。
  windowTokens = 128000,
) {
  const maxTokens = Math.min(4096, Math.floor(windowTokens / 8));
  const limit = windowTokens - maxTokens - 2048;
  if (byteLength(input.tools ?? []) > 48 * 1024) {
    throw new Error('tool_schema_budget');
  }
  let messages: Message[] = input.messages.map(message => {
    if (message.role === 'toolResult') {
      // pi-agent-core retains renderer details on live results. Providers only
      // consume content; counting full details would defeat artifact compaction.
      const { details, ...view } = message;
      void details;
      return { ...view, content: message.content.filter(block => block.type !== 'image') };
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      return { ...message, content: message.content.filter(b => b.type !== 'image') };
    }
    return message;
  });
  // Tokens, not bytes: limit/maxTokens/contextWindow are all token quotas.
  // Tool schemas are excluded on purpose — they are governed by the separate
  // 48 KiB byte cap below and by ToolActivationState, so counting them here
  // would charge the same bytes twice and starve small windows (D-07).
  const estimate = () => bytesToTokens(byteLength({ ...input, tools: [], messages }) +
    16 * messages.length + 1024);
  if (estimate() > limit) messages = messages.map(message => compactResult(message));
  // Preserve quality and handles before spending scarce space on prose.
  for (const summaryBytes of [256, 128, 0]) {
    if (estimate() <= limit) break;
    messages = messages.map(message => compactResult(message, summaryBytes));
  }
  const batches = groupToolBatches(messages);
  const latestUser = [...messages].reverse().find(message => message.role === 'user');
  const artifactIds = collectResearchArtifactIds(messages);
  const historyNote: Message = { role: 'user', timestamp: 0,
    content: '[System note] Earlier context omitted. Read research artifacts by ID before judging source quality; query the current timeline before editing. Artifacts: ' +
      artifactIds.join(',') };
  let dropped = false;
  const noteTokens = () => bytesToTokens(byteLength(historyNote) + 17);
  while (estimate() + (dropped ? noteTokens() : 0) > limit &&
    batches.length > 1) {
    const index = batches.findIndex((batch, i) => i < batches.length - 1 &&
      !batch.includes(latestUser!));
    if (index < 0) break;
    batches.splice(index, 1);
    messages = batches.flat();
    dropped = true;
  }
  if (dropped) messages = [historyNote, ...messages];
  if (estimate() > limit) throw new Error('context_budget_exceeded');
  // `estimatedTokens` is a token count, in the same unit as `maxTokens`.
  return { context: { ...input, messages }, maxTokens, estimatedTokens: estimate(), dropped };
}

/** The subset of `Model` an error message has to echo back to the SDK. */
export interface ModelIdentity {
  id: string;
  api: AssistantMessage['api'];
  provider: string;
}

/** A terminal assistant error message in the shape the SDK expects. */
export function assistantErrorMessage(
  model: ModelIdentity,
  code: string,
): AssistantMessage {
  return {
    role: 'assistant', content: [],
    api: model.api, provider: model.provider, model: model.id,
    stopReason: 'error', errorMessage: code, timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

/**
 * One conservative retry after a provider context-length rejection
 * (spec §12.3 D-04). An `error` event arrives before any content, so nothing
 * has reached the user and the first attempt can be discarded silently.
 * The retry rebuilds the request with a smaller window and output cap.
 *
 * Every exit closes the stream: a retry that throws (the tighter budget can
 * refuse the smaller window) used to leave the stream open forever, so
 * `result()` and the iterator hung until the turn watchdog fired (R-01).
 */
export function retryOnContextOverflow(
  first: AssistantMessageEventStream,
  retry: (() => AssistantMessageEventStream) | null,
  matches: (message: string) => boolean,
  model?: ModelIdentity,
): AssistantMessageEventStream {
  if (!retry) return first;
  const out = createAssistantMessageEventStream();
  void (async () => {
    let final: AssistantMessage | undefined;
    let streamed = false;
    try {
      for await (const event of first) {
        if (event.type === 'error') {
          const next = !streamed && matches(event.error.errorMessage ?? '')
            ? retry() : null;
          if (next) {
            for await (const retried of next) {
              if (retried.type === 'done') final = retried.message;
              if (retried.type === 'error') final = retried.error;
              out.push(retried);
            }
            out.end(final);
            return;
          }
          out.push(event);
          out.end(event.error);
          return;
        }
        streamed = true;
        if (event.type === 'done') final = event.message;
        out.push(event);
      }
      out.end(final);
    } catch (failure) {
      const code = failure instanceof Error
        ? failure.message : 'context_budget_exceeded';
      if (!model) {
        out.end();
        return;
      }
      const error = assistantErrorMessage(model, code);
      out.push({ type: 'error', reason: 'error', error });
      out.end(error);
    }
  })();
  return out;
}

/** The SDK awaits result() even on errors; both completion channels must close. */
export function localErrorStream(code: string, model: ModelIdentity) {
  const stream = createAssistantMessageEventStream();
  const error = assistantErrorMessage(model, code);
  stream.push({ type: 'error', reason: 'error', error });
  stream.end(error);
  return stream;
}
