import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import { streamSimple } from '@mariozechner/pi-ai';
import { ToolActivationState } from './registry/ToolActivationState';
import { assertCanMutateEffectsTimeline } from './tools/effectsApplyTool';
import { restoreEffectsRecovery } from './tools/effectsCatalogTools';
import {
  CORE_TOOLKIT_TOOL_NAMES,
  GENERAL_RESIDENT_TOOL_NAMES,
} from './promptParts';
import {
  budgetModelContext, compactResult, localErrorStream, retryOnContextOverflow,
  tokensToBytes,
} from './modelContextBudget';
import { isResearchTool, sanitizeResearchValue } from './researchEventSanitizer';
import type { MaterialType, TimelineState } from '@/types';
import type {
  ToolContext,
  TimelineOperation,
  TimelineApplyReceipt,
  AgentOperation,
  AgentStreamErrorCode,
  SSEEvent,
  VideoEditingAgentConfig,
} from './types';
import { DEFAULT_CREW_SETTINGS } from './types';
import { resolveModelFormat } from './modelFormat';

export { resolveModelFormat };
import { buildSystemPrompt, L0_PROMPT_CHAR_CEILING } from './systemPrompt';
import { readScriptSegments, formatScriptSegments } from './editorContextPrompt';
import { skillAvailability } from './skillContext';
import { convertToAgentMessages } from './messageConverter';
import { HISTORY_CHAR_BUDGET, compactHistoryForModel } from './historyBudget';
import { createToolRegistry, buildAllAgentTools } from './tools';
import type { ToolRegistry } from './registry';
import { extractAgentToolCalls, scanExploredCategories } from './historyScan';
import { readExplicitRecoveryRetry, resolveEditingGoal, resolveTaskMessageId, scanLatestPlan } from './planScan';
import { GENERATION_CAPABILITIES, restoreCapabilityFailures } from './tools/apiHelper';
import { restoreEgressFailures } from './tools/hostToolAdapter';
import { reconcileOverlapsAfterAgentOp } from './reconcile';
import { computeTimelineEnd } from './trackPatch';
import { findLockedTrackId, validateOperationTargets } from './operationGuards';
import { getTtsFailure } from '@/lib/ttsErrors';
import type { TtsFailure } from '@/lib/ttsErrors';
import { isStillGuardRejection } from './tools/stillGuard';
import { isSubtitleGuardRejection } from './tools/subtitleGuard';
import { applySubtitleClipsToState } from './subtitleClips';

export type { AgentStreamErrorCode } from './types';

/**
 * Optional debug switch — when set, dumps the full final system prompt to
 * stdout once per agent creation. Off by default in production.
 *
 * Spec: docs/plans/video-agent-prompt-persistence/spec.md §2.8.
 */
const PROMPT_DEBUG = process.env.VIDEO_AGENT_PROMPT_DEBUG === '1';

/**
 * Create a video editing agent instance with all tools and configuration.
 * Returns the agent, the shared tool context, and the ToolRegistry.
 *
 * Keeps all executors registered, while each provider request receives only
 * core and explicitly loaded schemas. History never restores authorization.
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
    // v2 R-V2-04：默认 128000 与历史硬编码持平，不静默减半。
contextWindow: config.contextWindowTokens ?? 128000,
    maxTokens: 4096,
  };

  // 2. Deep-clone timelineState so tool mutations don't affect caller
  const localTimelineState: TimelineState = JSON.parse(JSON.stringify(config.timelineState));
  localTimelineState.totalDuration = computeTimelineEnd(localTimelineState);
  const editingGoal = resolveEditingGoal(config.conversationHistory, {
    projectId: config.projectId, conversationId: config.conversationId,
  });

  // 3. Create shared tool context
  const toolContext: ToolContext = {
    effectsRunId: crypto.randomUUID(),
    effectsTargets: { drafts: new Map(), outputs: new Map() },
    effectsApplyUncertain: false,
    researchRun: config.researchRun,
    timelineState: localTimelineState,
    materials: config.materials,
    apiBaseUrl: config.apiBaseUrl,
    projectId: config.projectId,
    lastCompositionId: config.lastCompositionId,
    // 请求即快照：本回合的工程默认音色，TTS 工具的缺省值来源（不再硬编码）。
    defaultVoiceId: config.defaultVoiceId,
    scriptSegments: config.scriptSegments === undefined ? undefined : readScriptSegments(config.scriptSegments),
    operations: new Map(),
    updateTimeline: (toolCallId: string, operation: TimelineOperation) => {
      if (toolContext.abortSignal?.aborted) {
        return { applied: false as const, reason: 'cancelled' };
      }
      assertCanMutateEffectsTimeline(toolContext);
      // An operation the local copy refuses is never forwarded: the client
      // would refuse it too, after the tool already reported success. The
      // receipt (agent-subtitles spec D-4 / P0-2) is how the tool learns that —
      // a `void` return used to make "silently dropped" indistinguishable from
      // "written", which is the F-AIEDIT-RV02 failure shape.
      const local = applyOperationLocally(toolContext.timelineState, operation);
      if (!local.applied) return local;
      toolContext.operations.set(toolCallId, operation);
      return { applied: true as const };
    },
    recordOperation: (toolCallId: string, operation: AgentOperation) => {
      if (toolContext.abortSignal?.aborted) return;
      if (['add_clip', 'trim_clip', 'delete_clip', 'move_clip', 'resize_clip',
        'add_subtitle_clips', 'cover_action'].includes(operation.type)
        || (operation.type === 'effects_action' && operation.action === 'apply_asset')) {
        assertCanMutateEffectsTimeline(toolContext);
      }
      toolContext.operations.set(toolCallId, operation);
    },
    // Fresh per request: `ask_user`'s one-per-turn rule and the live plan must
    // never leak across an SSE retry (spec §3.5.2 / R-15).
    turnState: {
      plan: scanLatestPlan(config.conversationHistory, editingGoal) ?? undefined,
      editingGoal,
    },
    conversationId: config.conversationId,
    generationConfigRevision: config.generationConfigRevision,
    recoveryReset: config.recoveryReset,
    callBudget: { used: 0 },
    crewRuntime: {
      settings: config.crewSettings ?? DEFAULT_CREW_SETTINGS,
      mainModel: {
        apiUrl: config.llmApiUrl, apiKey: config.llmApiKey, model: config.llmModel,
        providerType: config.providerType, apiType: config.apiType,
        contextWindowTokens: config.contextWindowTokens,
      },
      globalConcurrency: config.webCapabilities?.limits?.global_concurrency,
    },
    skillAvailability: skillAvailability(config.webCapabilities, config.crewSettings?.enabled),
    // 请求即快照：本回合的自主模式不会中途改变（D-08）。缺省 undefined =
    // 互动模式，工具与提示词两处都按旧行为渲染。
    autonomy: config.autonomy,
    // 与 webCapabilities 同源注入（spec §7.2）：可用性自证与每回合出口预算都
    // 读这一份快照；缺席时工具按缺省限值工作，旧构造点不需要改动。
    hostCapabilities: config.hostCapabilities ?? undefined,
  };

  const goal = toolContext.turnState.editingGoal;
  toolContext.recoveryScope = config.recoveryScope ?? JSON.stringify([
    config.projectId ?? '', config.conversationId ?? '',
    goal?.taskId ?? resolveTaskMessageId(config.conversationHistory) ?? '',
  ]);
  const explicitRetry = readExplicitRecoveryRetry(config.conversationHistory);
  const recoveryFacts = config.conversationHistory.flatMap(message => extractAgentToolCalls(message)
      .filter(call => call.status === 'completed' || call.status === 'error')
      .map(call => call.result)).map(value => {
    if (!value || typeof value !== 'object') return value;
    const fact = { ...value } as Record<string, unknown>;
    const capability = (fact.capability_failure as { capability?: string } | undefined)?.capability;
    if ((explicitRetry.video && capability === GENERATION_CAPABILITIES.video)
      || (explicitRetry.image && capability === GENERATION_CAPABILITIES.image)) delete fact.capability_failure;
    if (explicitRetry.egress) delete fact.egress_failure;
    return fact;
  });
  restoreCapabilityFailures(toolContext, recoveryFacts);
  restoreEgressFailures(toolContext, recoveryFacts);
  for (const message of config.conversationHistory) {
    for (const call of extractAgentToolCalls(message)) {
      if (['completed', 'error', 'cancelled'].includes(call.status)) {
        restoreEffectsRecovery(toolContext, call);
      }
    }
  }

  // 4. Create ToolRegistry and build tools
  const registry = createToolRegistry(toolContext);
  // YOLO：`ask_user` 整类移除。coreNames 必须同步剔除，否则会出现
  // `canExecute('ask_user') === true` 却无工具可调用的自相矛盾（§4.4）。
  const isYolo = config.autonomy === 'yolo';
  const activation = new ToolActivationState(registry, [
    ...registry.getAlwaysAvailableTools().map(tool => tool.name),
    ...CORE_TOOLKIT_TOOL_NAMES.filter(name => !isYolo || name !== 'ask_user'),
    // 通用层常驻工具（spec §4.7）：与上一行同构——常驻即授予执行权。它们的
    // schema 只走单行清单预算，不进 formatCoreToolkit 的富格式块。这份名单里
    // 没有 `ask_user`，所以不需要再按自主模式过滤一次。
    ...GENERAL_RESIDENT_TOOL_NAMES,
    'explore_tools',
  ]);
  // `use_skill` preloads the tools a skill names through this narrow window;
  // the activation object itself never reaches a tool.
  toolContext.loadTools = (category, names) => activation.load(category, names);
  const tools = buildAllAgentTools(registry, activation);

  // 5. Convert conversation history (exclude last user message — it goes to agent.prompt())
  const history = config.conversationHistory.slice(0, -1);
  // Older turns are compacted to a size budget so long conversations stay
  // inside the model's context window.
  const initialMessages = compactHistoryForModel(convertToAgentMessages(history),
    HISTORY_CHAR_BUDGET, compactResult);

  // 6. Build the L0 system prompt.
  //    - exploredCategories: replays any advanced categories the user already
  //      drilled into via explore_tools so the LLM never re-loses that
  //      guidance on later turns (spec v2 §2.3 Layer B).
  //    - registry: lets buildSystemPrompt pull live tool descriptions and
  //      parameter schemas for the Core Workflow Toolkit (Layer A).
  const exploredCategories = scanExploredCategories(config.conversationHistory);
  const systemPrompt = buildSystemPrompt({
    timelineState: localTimelineState,
    materials: config.materials,
    registry,
    exploredCategories: [],
    capabilities: config.webCapabilities,
    hostCapabilities: config.hostCapabilities,
    plan: toolContext.turnState.plan ?? null,
    memoryDigest: config.memoryDigest ?? null,
    skillIndex: config.skillIndex,
    crewEnabled: config.crewSettings?.enabled,
    autonomy: config.autonomy,
  }) + formatScriptSegments(toolContext.scriptSegments ?? []) + (exploredCategories.length
    ? '\n## 已加载的高级工具（历史提示）\n' +
      exploredCategories.slice(-2).join(', ') +
      '：仅供回顾。历史不恢复工具授权；非核心工具须先 explore_tools 再在下一响应调用。'
    : '') + (goal ? `\n## 本任务验收目标\n用户消息 ${goal.sourceMessageId}：` +
      `${goal.targetDurationSeconds} 秒；${goal.fps}fps，容差一帧。` +
      `承诺：${goal.commitments.join(', ')}。仅用户新要求可修改，未兑现项保留 blocked。` : '');

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
  // 上限是**总**提示词（含 web 研究引导与历史类别回顾行），所以在这里量而不是
  // 在 `buildSystemPrompt` 里量。超出只是告警：prompt 不可裁剪，静默超限才是 bug。
  if (systemPrompt.length > L0_PROMPT_CHAR_CEILING) {
    console.warn(
      `[VideoEditingAgent] systemPrompt ${systemPrompt.length} chars exceeds L0 ceiling ${L0_PROMPT_CHAR_CEILING}`
    );
  }

  // 7. Create Agent
  let modelCalls = 0;
  const agent = new Agent({
    streamFn: (currentModel, context, options) => {
      if (++modelCalls > 40) return localErrorStream('model_call_limit', currentModel);
      // A conservative retry is only safe before any tool ran this turn.
      const firstRequest = modelCalls === 1;
      const request = (window: number, outputCap?: number) => {
        const names = new Set(activation.offer().map(tool => tool.name));
        names.add('explore_tools');
        const selected = { ...context, tools: context.tools?.filter(tool => names.has(tool.name)) };
        const budget = budgetModelContext(selected, window);
        const maxTokens = outputCap === undefined ? budget.maxTokens
          : Math.min(outputCap, budget.maxTokens);
        // 回调缺省或抛错都不能影响本次模型请求（评审 R-10：事件由 route 接到 SSE）。
        try {
          config.onContextUsage?.({ type: 'context_usage', usedTokens: budget.estimatedTokens,
            windowTokens: currentModel.contextWindow, maxOutputTokens: budget.maxTokens,
            dropped: budget.dropped });
        } catch { /* a broken observer must not fail the turn */ }
        // Same unit as budgetModelContext (tokens), converted once to the
        // schema bytes ToolActivationState enforces (spec §12.3 D-07).
        activation.setSchemaBudget(tokensToBytes(window - maxTokens -
          2048 - budget.estimatedTokens));
        return streamSimple(currentModel, budget.context, { ...options, maxTokens });
      };
      // The retry runs inside the stream wrapper, so a local refusal of the
      // tighter window has to become a terminal error stream there — a throw
      // would never reach the catch below and would hang the turn (R-01).
      const retryWithSmallerWindow = () => {
        try {
          return request(Math.floor(currentModel.contextWindow * 0.7), 2048);
        } catch (error) {
          return localErrorStream(
            error instanceof Error ? error.message : 'context_budget_exceeded',
            currentModel,
          );
        }
      };
      try {
        return retryOnContextOverflow(request(currentModel.contextWindow),
          firstRequest ? retryWithSmallerWindow : null,
          text => !LOCAL_BUDGET_PATTERN.test(text) && CONTEXT_OVERFLOW_PATTERN.test(text),
          currentModel);
      } catch (error) {
        return localErrorStream(error instanceof Error ? error.message : 'context_budget_exceeded', currentModel);
      }
    },
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
const LOCAL_BUDGET_PATTERN = /context_budget_exceeded|tool_schema_budget/i;
const CONTEXT_OVERFLOW_PATTERN = new RegExp(
  [
    'context.?length',
    'maximum context',
    'context window',
    'too many tokens',
    'context_length_exceeded',
    'context_budget_exceeded',
    'tool_schema_budget',
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
  // Local terminal states stay distinct: budget refusals are fixable in
  // Settings, the call ceilings mean the turn looped, while a provider
  // overflow means the conversation itself is too long (D-05).
  if (/context_budget_exceeded/i.test(text)) return 'context_budget_exceeded';
  if (/tool_schema_budget/i.test(text)) return 'tool_schema_budget';
  if (/model_call_limit/i.test(text)) return 'model_call_limit';
  if (/tool_call_limit/i.test(text)) return 'tool_call_limit';
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
  let latestTtsFailure: TtsFailure | undefined;
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
        if (circuitBreakerTripped) {
          send({ type: 'message_end' });
          break;
        }
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
          params: isResearchTool(event.toolName) ? sanitizeResearchValue(event.args ?? {}) : event.args ?? {},
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
        const expectedClassifiedFailure = softFailure && event.isError !== true &&
          details?.error_code !== 'subtitle_apply_refused' &&
          ['configuration', 'blocked', 'cancelled', 'policy', 'validation', 'user_input']
            .includes(details?.error_details?.failure_class);
        // A still-image refusal is a one-step self-correction, not a failing
        // tool: it neither counts toward the breaker nor resets it. Subtitle
        // validation refusals are the same shape (agent-subtitles spec D-8):
        // two wrong cues in a row must not abort the whole run.
        const expectedGuardRejection = softFailure
          && (isStillGuardRejection(details) || isSubtitleGuardRejection(details));
        const failed = (event.isError === true || softFailure)
          && !expectedClassifiedFailure && !expectedGuardRejection;

        if (failed) {
          consecutiveFailures++;
          latestTtsFailure = ['generate_tts', 'batch_generate_tts']
            .includes(event.toolName) ? getTtsFailure(details) : undefined;
        } else if (!expectedClassifiedFailure && !expectedGuardRejection) {
          consecutiveFailures = 0;
          latestTtsFailure = undefined;
        }

        send({
          type: 'tool_result',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          result: isResearchTool(event.toolName) ? sanitizeResearchValue(details) : details,
          operation: toolContext.abortSignal?.aborted ||
            (isResearchTool(event.toolName) && toolContext.researchRun?.controller.signal.aborted) ? null :
            isResearchTool(event.toolName) ? sanitizeResearchValue(operation) : operation,
        });

        if (
          !circuitBreakerTripped &&
          consecutiveFailures >= MAX_CONSECUTIVE_TOOL_FAILURES
        ) {
          circuitBreakerTripped = true;
          runErrorSent = true;
          console.error(
            `[VideoEditingAgent] Circuit breaker tripped after ${consecutiveFailures} consecutive tool failures — aborting agent.`
          );
          send({
            type: 'error',
            // 保留错误类别和根因，交由渲染器按当前语言展示。
            code: 'tool_failures',
            message: latestTtsFailure
              ? `连续 5 次工具调用失败，已停止。最近一次失败：${latestTtsFailure.error}`
              : '连续 5 次工具调用失败，已停止。请查看失败步骤的具体原因。',
            ...(latestTtsFailure ? { cause: latestTtsFailure } : {}),
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
    ...(material.metadata || operation.clip.metadata
      ? { metadata: { ...material.metadata, ...operation.clip.metadata } } : {}),
    ...(material.sentenceSegments ? { sentenceSegments: structuredClone(material.sentenceSegments) } : {}),
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
 * see consistent state. Returns the same receipt the browser applier would
 * produce (`{ applied: false, reason }` when the operation fails the shared
 * validation), so a tool can tell "written" from "silently dropped".
 */
function applyOperationLocally(
  state: TimelineState,
  operation: TimelineOperation,
): TimelineApplyReceipt {
  const validation = validateOperationTargets(state, operation);
  if (!validation.ok) {
    console.warn('[VideoEditingAgent] refused invalid timeline operation', {
      type: operation.type,
      reason: validation.reason,
      trackId: validation.trackId,
      clipId: validation.clipId,
    });
    return { applied: false, reason: validation.reason };
  }

  if (findLockedTrackId(state, operation) !== null) {
    return { applied: false, reason: 'locked-track' };
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

    case 'add_subtitle_clips':
      // 与浏览器 OperationApplier 同一份纯函数（含建轨、upsert、
      // totalDuration），见 spec §6.3 / D-4。
      applySubtitleClipsToState(state, operation);
      break;
  }

  // Mirror the frontend OperationApplier reconcile so the next tool
  // (e.g. check_timeline_overlaps, get_timeline) sees the same packed
  // layout the UI will end up with. Pure function — safe on the server.
  reconcileOverlapsAfterAgentOp(state, operation);
  return { applied: true };
}
