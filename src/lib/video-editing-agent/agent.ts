import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model, KnownApi } from '@mariozechner/pi-ai';
import type { MaterialType, TimelineState } from '@/types';
import type {
  ToolContext,
  TimelineOperation,
  AgentOperation,
  AgentStreamErrorCode,
  SSEEvent,
  VideoEditingAgentConfig,
} from './types';
import { buildSystemPrompt } from './systemPrompt';
import { convertToAgentMessages } from './messageConverter';
import { compactHistoryForModel } from './historyBudget';
import { createToolRegistry, buildAllAgentTools } from './tools';
import type { ToolRegistry } from './registry';
import { scanExploredCategories } from './historyScan';
import { reconcileOverlapsAfterAgentOp } from './reconcile';
import { validateOperationTargets } from './operationGuards';

export type { AgentStreamErrorCode } from './types';

/**
 * Optional debug switch — when set, dumps the full final system prompt to
 * stdout once per agent creation. Off by default in production.
 *
 * Spec: docs/plans/video-agent-prompt-persistence/spec.md §2.8.
 */
const PROMPT_DEBUG = process.env.VIDEO_AGENT_PROMPT_DEBUG === '1';

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
function resolveModelFormat(
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

/**
 * Create a video editing agent instance with all tools and configuration.
 * Returns the agent, the shared tool context, and the ToolRegistry.
 *
 * Uses ToolRegistry (Method C): all tools from all categories are registered
 * in the Agent's function-calling schema at init. The system prompt shows
 * only category summaries; explore_tools provides detailed guidance on demand.
 */
export function createVideoEditingAgent(config: VideoEditingAgentConfig): {
  agent: Agent;
  toolContext: ToolContext;
  registry: ToolRegistry;
} {
  // 1. Construct Model — select API format based on provider type + api type
  const { api, provider } = resolveModelFormat(config.providerType, config.apiType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model: Model<any> = {
    id: config.llmModel,
    name: config.llmModel,
    api,
    provider,
    baseUrl: config.llmApiUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };

  // 2. Deep-clone timelineState so tool mutations don't affect caller
  const localTimelineState: TimelineState = JSON.parse(JSON.stringify(config.timelineState));

  // 3. Create shared tool context
  const toolContext: ToolContext = {
    timelineState: localTimelineState,
    materials: config.materials,
    apiBaseUrl: config.apiBaseUrl,
    projectId: config.projectId,
    operations: new Map(),
    updateTimeline: (toolCallId: string, operation: TimelineOperation) => {
      // An operation the local copy refuses is never forwarded: the client
      // would refuse it too, after the tool already reported success.
      if (!applyOperationLocally(toolContext.timelineState, operation)) return;
      toolContext.operations.set(toolCallId, operation);
    },
    recordOperation: (toolCallId: string, operation: AgentOperation) => {
      toolContext.operations.set(toolCallId, operation);
    },
  };

  // 4. Create ToolRegistry and build tools
  const registry = createToolRegistry(toolContext);
  const tools = buildAllAgentTools(registry);

  // 5. Convert conversation history (exclude last user message — it goes to agent.prompt())
  const history = config.conversationHistory.slice(0, -1);
  // Older turns are compacted to a size budget so long conversations stay
  // inside the model's context window.
  const initialMessages = compactHistoryForModel(convertToAgentMessages(history));

  // 6. Build the L0 system prompt.
  //    - exploredCategories: replays any advanced categories the user already
  //      drilled into via explore_tools so the LLM never re-loses that
  //      guidance on later turns (spec v2 §2.3 Layer B).
  //    - registry: lets buildSystemPrompt pull live tool descriptions and
  //      parameter schemas for the Core Workflow Toolkit (Layer A).
  const exploredCategories = scanExploredCategories(config.conversationHistory);
  const systemPrompt = buildSystemPrompt({
    timelineState: config.timelineState,
    materials: config.materials,
    registry,
    exploredCategories,
  });

  // Observability: log the prompt size and explored categories on every
  // agent creation so we can verify the persistence fix is active and spot
  // regressions where the prompt unexpectedly shrinks. The char-based
  // estimate is a Chinese-aware floor (≈ 2 chars/token worst case) — see
  // spec §2.8 / R8.
  const tokenEstimate = Math.round(systemPrompt.length / 2);
  console.log(
    `[VideoEditingAgent] systemPrompt tokens≈${tokenEstimate} chars=${systemPrompt.length} exploredCategories=[${exploredCategories.join(',')}]`
  );
  if (PROMPT_DEBUG) {
    console.log('[VideoEditingAgent] PROMPT_DEBUG dump:\n' + systemPrompt);
  }

  // 7. Create Agent
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: 'off',
      tools,
      messages: initialMessages,
    },
    getApiKey: () => config.llmApiKey,
  });

  return { agent, toolContext, registry };
}

/**
 * Maximum number of consecutive tool failures before the agent loop is
 * force-aborted. The 2026-04-07 production incident showed the LLM burning
 * 28+ `add_to_track` calls after the first 5 generation tools all failed
 * with `fetch failed` — this circuit breaker cuts that feedback loop off
 * at the source.
 *
 * A "failure" is either:
 *   - a hard exception (pi-agent-core sets `event.isError = true`), OR
 *   - a soft failure where the tool returned a `{ success: false, ... }`
 *     detail envelope (our tools do not throw for HTTP/network errors;
 *     they wrap them into structured results).
 *
 * Any successful tool call resets the counter to 0.
 */
const MAX_CONSECUTIVE_TOOL_FAILURES = 5;

const EMPTY_RESPONSE_MESSAGE =
  'The model returned an empty response. It may not support tool-use required by the editing agent. Please try a model that supports function calling (e.g., GPT-4, Claude, Qwen).';

/** Error text shown to the user is cut to this many characters. */
const ERROR_DETAIL_MAX_CHARS = 300;

// Checked in this order: a context-length message can mention "401 more
// tokens", which must not read as an authentication failure. Providers word
// an overflow differently (OpenAI, Anthropic, Gemini, Kimi, DashScope,
// Zhipu); an unmatched one only gets the generic "request failed" hint.
const CONTEXT_OVERFLOW_PATTERN = new RegExp(
  [
    'context.?length',
    'maximum context',
    'context window',
    'too many tokens',
    'context_length_exceeded',
    'prompt is too long',
    'prompt exceeds max length',
    'input token count',
    'model token limit',
    'range of input length',
  ].join('|'),
  'i',
);
const RATE_LIMIT_PATTERN = /\b429\b|rate.?limit/i;
const AUTH_FAILURE_PATTERN = /\b401\b|invalid[_ ]api[_ ]key|unauthorized/i;

/** Credential shapes an error may echo back; never forwarded to the UI. */
const SECRET_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{4,}/g, 'sk-[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]'],
  [/((?:api[_-]?key|access[_-]?token|secret|password)["'\s:=]+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  // A scheme-less or Basic credential: `Authorization: <token>`.
  [/(authorization["'\s:=]+(?:basic\s+)?)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[redacted]'],
  // A key carried in a URL, e.g. Google's `?key=`.
  [/([?&](?:key|token)=)[^&\s"']{8,}/gi, '$1[redacted]'],
];

function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), text);
}

function truncateDetail(text: string): string {
  return text.length > ERROR_DETAIL_MAX_CHARS ? `${text.slice(0, ERROR_DETAIL_MAX_CHARS)}…` : text;
}

/** Error text safe to show the user: credentials removed, cut to a readable length. */
export function formatErrorDetail(raw: string): string {
  return truncateDetail(redactSecrets(raw).trim());
}

function classifyProviderError(text: string): AgentStreamErrorCode {
  if (CONTEXT_OVERFLOW_PATTERN.test(text)) return 'context_overflow';
  if (RATE_LIMIT_PATTERN.test(text)) return 'provider_rate_limit';
  if (AUTH_FAILURE_PATTERN.test(text)) return 'provider_auth';
  return 'provider_error';
}

/**
 * Turn a model provider's error message (pi-ai `errorMessage`) into an SSE
 * error: a code the UI localises, plus the provider text with credentials
 * removed and cut to a readable length.
 */
export function formatProviderError(raw?: string): { code: AgentStreamErrorCode; message: string } {
  // Classified before truncation: the telling phrase can sit past the cut.
  const text = redactSecrets(raw ?? '').trim();
  return {
    code: classifyProviderError(text),
    message: truncateDetail(text) || 'The model request failed without an error message.',
  };
}

/** Per-message flags `subscribeAgentEvents` resets on every message_start. */
interface AssistantMessageFlags {
  textDeltaSent: boolean;
  toolCallMade: boolean;
}

/** The fields of a pi-ai message that event forwarding reads. */
interface AssistantMessageLike {
  role?: string;
  content?: Array<{ type: string; text?: string }>;
  stopReason?: string;
  errorMessage?: string;
}

/**
 * Forward an assistant message_end; returns true when an error event was sent.
 *
 * - `stopReason: 'error'` is a provider failure (401, 429, context overflow)
 *   and is reported with its cause.
 * - Non-streaming models (e.g., Kimi) skip text_delta and only provide the
 *   final content here, so it is sent as one text_delta.
 * - Only a message with neither text nor tool calls is an empty response. An
 *   `aborted` message was stopped on purpose (user, watchdog, circuit
 *   breaker) and that reason was already reported.
 */
function forwardMessageEnd(
  message: AssistantMessageLike | undefined,
  flags: AssistantMessageFlags,
  send: (data: SSEEvent) => void,
): boolean {
  let errorSent = false;
  if (message?.role === 'assistant' && message.stopReason === 'error') {
    send({ type: 'error', ...formatProviderError(message.errorMessage) });
    errorSent = true;
  } else if (message?.role === 'assistant') {
    if (!flags.textDeltaSent && Array.isArray(message.content)) {
      const fullText = message.content
        .filter(block => block.type === 'text')
        .map(block => block.text ?? '')
        .join('');
      if (fullText) {
        send({ type: 'text_delta', content: fullText });
        flags.textDeltaSent = true;
      }
      // pi-agent-core normalizes tool calls to "toolCall" (not Anthropic's
      // "tool_use"), and tool_execution_start fires AFTER message_end.
      if (message.content.some(block => block.type === 'toolCall' || block.type === 'tool_use')) {
        flags.toolCallMade = true;
      }
    }
    if (!flags.textDeltaSent && !flags.toolCallMade && message.stopReason !== 'aborted') {
      send({ type: 'error', code: 'empty_response', message: EMPTY_RESPONSE_MESSAGE });
      errorSent = true;
    }
  }
  send({ type: 'message_end' });
  return errorSent;
}

/**
 * Subscribe to agent events and forward them as SSE events.
 */
export function subscribeAgentEvents(
  agent: Agent,
  toolContext: ToolContext,
  send: (data: SSEEvent) => void,
  onToolActivity?: () => void,
  onToolExecutionStart?: () => void,
  onToolExecutionEnd?: () => void,
): () => void {
  // Track whether text_delta events or tool calls were sent for the current
  // assistant message. Non-streaming models (e.g., Kimi) skip text_delta and
  // only provide final content in the message_end event. Tool-only messages
  // (no text, only tool_use) are normal in multi-turn agent loops.
  const messageFlags: AssistantMessageFlags = { textDeltaSent: false, toolCallMade: false };
  let runErrorSent = false;

  // Consecutive failure counter for the circuit breaker.
  let consecutiveFailures = 0;
  let circuitBreakerTripped = false;

  return agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'agent_start':
        send({ type: 'agent_start' });
        break;

      case 'agent_end': {
        // A request that throws before streaming ends the run with an error
        // message but no message_end, so its cause is reported here.
        const last = event.messages[event.messages.length - 1] as AssistantMessageLike | undefined;
        if (!runErrorSent && last?.role === 'assistant' && last.stopReason === 'error') {
          send({ type: 'error', ...formatProviderError(last.errorMessage) });
        }
        send({ type: 'agent_end' });
        break;
      }

      case 'turn_start':
        send({ type: 'turn_start' });
        break;

      case 'turn_end':
        send({ type: 'turn_end' });
        break;

      case 'message_start':
        messageFlags.textDeltaSent = false;
        messageFlags.toolCallMade = false;
        send({ type: 'message_start' });
        break;

      case 'message_end':
        if (forwardMessageEnd(event.message as AssistantMessageLike, messageFlags, send)) {
          runErrorSent = true;
        }
        break;

      case 'message_update': {
        const evt = event.assistantMessageEvent;
        if (evt.type === 'text_delta') {
          messageFlags.textDeltaSent = true;
          send({ type: 'text_delta', content: evt.delta });
        }
        break;
      }

      case 'tool_execution_start':
        messageFlags.toolCallMade = true;
        onToolActivity?.();
        onToolExecutionStart?.();
        send({
          type: 'tool_call',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          params: event.args ?? {},
        });
        break;

      case 'tool_execution_end': {
        onToolActivity?.();
        onToolExecutionEnd?.();
        // Don't send operation if the tool errored
        const operation = event.isError
          ? null
          : (toolContext.operations.get(event.toolCallId) ?? null);
        // event.result is AgentToolResult = { content, details }
        const details = event.result?.details ?? event.result;

        // Circuit breaker: a tool counts as "failed" if pi-agent-core marked
        // it as a hard error OR the returned details explicitly say
        // `success: false`. Successful calls reset the counter.
        const softFailure =
          typeof details === 'object' &&
          details !== null &&
          'success' in details &&
          (details as { success: unknown }).success === false;
        const failed = event.isError === true || softFailure;

        if (failed) {
          consecutiveFailures++;
        } else {
          consecutiveFailures = 0;
        }

        send({
          type: 'tool_result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: details,
          operation,
        });

        if (
          !circuitBreakerTripped &&
          consecutiveFailures >= MAX_CONSECUTIVE_TOOL_FAILURES
        ) {
          circuitBreakerTripped = true;
          console.error(
            `[VideoEditingAgent] Circuit breaker tripped after ${consecutiveFailures} consecutive tool failures — aborting agent.`
          );
          send({
            type: 'error',
            // Coded: the raw English sentence below reached zh-CN users as is.
            code: 'tool_failures',
            message: `Agent aborted: ${consecutiveFailures} consecutive tool calls failed. This usually indicates a network/auth problem with internal APIs — please retry, and if the problem persists, check server logs for '[VideoEditingAgent]'.`,
          });
          // Fire-and-forget: abort() is synchronous in pi-agent-core, but
          // wrap in try/catch just in case the controller is already gone.
          try {
            agent.abort();
          } catch {
            // Already aborted or controller disposed — nothing to do.
          }
        }
        break;
      }
    }
  });
}

type AddClipOperation = Extract<TimelineOperation, { type: 'add_clip' }>;
type MoveClipOperation = Extract<TimelineOperation, { type: 'move_clip' }>;

/** Mirrors OperationApplier's add_clip so both timelines hold the same clip fields. */
function addClipLocally(state: TimelineState, operation: AddClipOperation): void {
  const track = state.tracks.find(t => t.id === operation.clip.trackId);
  if (!track) return;
  // Editing tools send `toAgentClipMaterial`, which carries the playback fields.
  const { material } = operation;
  track.items.push({
    id: operation.clip.id,
    name: operation.material.name,
    type: track.type,
    startTime: operation.clip.startTime,
    duration: operation.clip.duration,
    trackId: operation.clip.trackId,
    color: '',
    materialId: operation.clip.materialId,
    clipStart: operation.clip.clipStart,
    clipEnd: operation.clip.clipEnd,
    // Stills carry no source length (tools send 0).
    ...(operation.clip.originalDuration > 0 ? { originalDuration: operation.clip.originalDuration } : {}),
    volume: operation.clip.volume,
    // Mirrors OperationApplier so get_timeline tells images apart.
    originalMaterialType: (operation.material.type as MaterialType) || undefined,
    ...(material.url ? { url: material.url } : {}),
    ...(material.serverUrl ? { serverUrl: material.serverUrl } : {}),
    ...(material.cacheUrl ? { cacheUrl: material.cacheUrl } : {}),
    ...(material.storageKey ? { storageKey: material.storageKey } : {}),
    ...(material.metadata ? { metadata: { ...material.metadata } } : {}),
  });
}

/** Validated by the caller, so both tracks exist and hold / receive the clip. */
function moveClipLocally(state: TimelineState, operation: MoveClipOperation): void {
  const fromTrack = state.tracks.find(t => t.id === operation.fromTrackId);
  const toTrack = state.tracks.find(t => t.id === operation.toTrackId);
  const idx = fromTrack ? fromTrack.items.findIndex(i => i.id === operation.clipId) : -1;
  if (!fromTrack || !toTrack || idx === -1) return;
  const [clip] = fromTrack.items.splice(idx, 1);
  clip.startTime = operation.newStartTime;
  clip.trackId = operation.toTrackId;
  toTrack.items.push(clip);
}

/**
 * Apply an operation to the local timeline state copy so subsequent tools
 * see consistent state. Returns false, changing nothing, when the operation
 * fails the same validation the client applies.
 */
function applyOperationLocally(state: TimelineState, operation: TimelineOperation): boolean {
  const validation = validateOperationTargets(state, operation);
  if (!validation.ok) {
    console.warn('[VideoEditingAgent] refused invalid timeline operation', {
      type: operation.type,
      reason: validation.reason,
      trackId: validation.trackId,
      clipId: validation.clipId,
    });
    return false;
  }

  switch (operation.type) {
    case 'add_clip':
      addClipLocally(state, operation);
      break;

    case 'trim_clip': {
      for (const track of state.tracks) {
        const clip = track.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.clipStart = operation.clipStart;
          clip.clipEnd = operation.clipEnd;
          clip.duration = operation.duration;
          break;
        }
      }
      break;
    }

    case 'delete_clip': {
      const track = state.tracks.find(t => t.id === operation.trackId);
      if (track) {
        track.items = track.items.filter(i => i.id !== operation.clipId);
      }
      break;
    }

    case 'move_clip':
      moveClipLocally(state, operation);
      break;

    case 'resize_clip': {
      for (const track of state.tracks) {
        const clip = track.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.duration = operation.newDuration;
          if (operation.clipEnd !== undefined) clip.clipEnd = operation.clipEnd;
          break;
        }
      }
      break;
    }
  }

  // Mirror the frontend OperationApplier reconcile so the next tool
  // (e.g. check_timeline_overlaps, get_timeline) sees the same packed
  // layout the UI will end up with. Pure function — safe on the server.
  reconcileOverlapsAfterAgentOp(state, operation);
  return true;
}
