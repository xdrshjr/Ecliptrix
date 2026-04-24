import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentEvent } from '@mariozechner/pi-agent-core';
import type { Model, KnownApi } from '@mariozechner/pi-ai';
import type { TimelineState } from '@/types';
import type { ToolContext, TimelineOperation, AgentOperation, SSEEvent, VideoEditingAgentConfig } from './types';
import { buildSystemPrompt } from './systemPrompt';
import { convertToAgentMessages } from './messageConverter';
import { createToolRegistry, buildAllAgentTools } from './tools';
import type { ToolRegistry } from './registry';
import { reconcileOverlapsAfterAgentOp } from './reconcile';

/** Map provider_type from backend to pi-ai api/provider values. */
function resolveModelFormat(providerType?: string): { api: KnownApi; provider: string } {
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
  // 1. Construct Model — select API format based on provider type
  const { api, provider } = resolveModelFormat(config.providerType);
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
    authToken: config.authToken,
    operations: new Map(),
    updateTimeline: (toolCallId: string, operation: TimelineOperation) => {
      toolContext.operations.set(toolCallId, operation);
      applyOperationLocally(toolContext.timelineState, operation);
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
  const initialMessages = convertToAgentMessages(history);

  // 6. Create Agent
  const categorySummaries = registry.getCategorySummaries();
  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt(config.timelineState, config.materials, categorySummaries),
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
  let textDeltaSent = false;
  let toolCallMade = false;

  // Consecutive failure counter for the circuit breaker.
  let consecutiveFailures = 0;
  let circuitBreakerTripped = false;

  return agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case 'agent_start':
        send({ type: 'agent_start' });
        break;

      case 'agent_end':
        send({ type: 'agent_end' });
        break;

      case 'turn_start':
        send({ type: 'turn_start' });
        break;

      case 'turn_end':
        send({ type: 'turn_end' });
        break;

      case 'message_start':
        textDeltaSent = false;
        toolCallMade = false;
        send({ type: 'message_start' });
        break;

      case 'message_end': {
        // Fallback for non-streaming models (e.g., Kimi): if no text_delta
        // events were emitted during streaming, extract text content from
        // the final message and send it as a text_delta before message_end.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = event.message as any;
        if (
          !textDeltaSent &&
          msg &&
          msg.role === 'assistant' &&
          Array.isArray(msg.content)
        ) {
          const fullText = msg.content
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((c: any) => c.type === 'text')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => c.text)
            .join('');
          if (fullText) {
            send({ type: 'text_delta', content: fullText });
            textDeltaSent = true;
          }

          // Detect toolCall blocks in message content — pi-agent-core normalizes
          // tool calls to type "toolCall" (not Anthropic's "tool_use").
          // This runs BEFORE the error check because tool_execution_start fires
          // AFTER message_end in pi-agent-core's event ordering.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hasToolCall = msg.content.some((c: any) => c.type === 'toolCall' || c.type === 'tool_use');
          if (hasToolCall) {
            toolCallMade = true;
          }
        }

        // Only emit error if the assistant message had neither text nor tool calls.
        // Tool-only messages (no text) are normal during multi-turn agent loops.
        if (!textDeltaSent && !toolCallMade && msg && msg.role === 'assistant') {
          send({
            type: 'error',
            message: 'The model returned an empty response. It may not support tool-use required by the editing agent. Please try a model that supports function calling (e.g., GPT-4, Claude, Qwen).',
          });
        }

        send({ type: 'message_end' });
        break;
      }

      case 'message_update': {
        const evt = event.assistantMessageEvent;
        if (evt.type === 'text_delta') {
          textDeltaSent = true;
          send({ type: 'text_delta', content: evt.delta });
        }
        break;
      }

      case 'tool_execution_start':
        toolCallMade = true;
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

/**
 * Apply an operation to the local timeline state copy so subsequent tools see consistent state.
 */
function applyOperationLocally(state: TimelineState, operation: TimelineOperation): void {
  switch (operation.type) {
    case 'add_clip': {
      const track = state.tracks.find(t => t.id === operation.clip.trackId);
      if (track) {
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
          originalDuration: operation.clip.originalDuration,
          volume: operation.clip.volume,
        });
      }
      break;
    }

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

    case 'move_clip': {
      const fromTrack = state.tracks.find(t => t.id === operation.fromTrackId);
      const toTrack = state.tracks.find(t => t.id === operation.toTrackId);
      if (fromTrack && toTrack) {
        const idx = fromTrack.items.findIndex(i => i.id === operation.clipId);
        if (idx !== -1) {
          const [clip] = fromTrack.items.splice(idx, 1);
          clip.startTime = operation.newStartTime;
          clip.trackId = operation.toTrackId;
          toTrack.items.push(clip);
        }
      } else if (fromTrack) {
        // toTrack not found — update position in place without moving
        const clip = fromTrack.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.startTime = operation.newStartTime;
        }
      }
      break;
    }

    case 'resize_clip': {
      for (const track of state.tracks) {
        const clip = track.items.find(i => i.id === operation.clipId);
        if (clip) {
          clip.duration = operation.newDuration;
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
}
