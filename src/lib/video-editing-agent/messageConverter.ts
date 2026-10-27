import type { Message, UserMessage, AssistantMessage, ToolResultMessage, TextContent, ToolCall } from '@mariozechner/pi-ai';
import type { ChatMessage } from '@/types';
import type { AgentToolCallRecord } from './types';
import { compactToolResult } from './compactToolResult';
import { STEER_WRAPPER } from './promptParts';

/**
 * Options for `convertToAgentMessages`.
 *
 * @beta — flag is wired but unused in v1; reserved for the optional
 * compaction described in spec v2 §2.5 / §3 row 5.
 */
export interface ConvertToAgentMessagesOptions {
  /**
   * @beta When `true`, replace any prior `explore_tools` tool-result content
   * with a 1-line stub (since the same expanded block now lives inside the
   * system prompt's "Previously explored advanced categories" appendix).
   * Off by default — only flip on after profiling shows the duplicated
   * payload is causing measurable token bloat.
   */
  compactExploreToolsResults?: boolean;
}

/**
 * Convert app ChatMessage[] to pi-ai Message[] for agent history injection.
 * The LAST user message should be excluded — it's passed to agent.prompt() separately.
 */
export function convertToAgentMessages(
  chatMessages: ChatMessage[],
  options: ConvertToAgentMessagesOptions = {}
): Message[] {
  const { compactExploreToolsResults = false } = options;
  const result: Message[] = [];

  // The resume system note is about the turn right before this one: it is
  // emitted at most once, and only when the LAST assistant message was
  // sealed as cancelled (spec §2.7 / P1-9). A stop several turns back, after
  // which a later turn completed, must not keep telling the model on every
  // request that it was just stopped. Older cancelled assistants stay
  // visible to the LLM through their cancelled toolResult.
  let lastAssistantIndex = -1;
  let lastCancelledAssistantIndex = -1;
  for (let i = chatMessages.length - 1; i >= 0; i--) {
    const m = chatMessages[i];
    if (m.role !== 'assistant') continue;
    if (lastAssistantIndex === -1) lastAssistantIndex = i;
    if (m.isCancelled) {
      lastCancelledAssistantIndex = i;
      break;
    }
  }
  const lastTurnWasStopped =
    lastCancelledAssistantIndex !== -1 && lastCancelledAssistantIndex === lastAssistantIndex;

  for (const msg of chatMessages) {
    if (msg.role === 'user') {
      const userMsg: UserMessage = {
        role: 'user',
        content: msg.skillId
          ? `${msg.content}
（本轮使用技能：${msg.skillId}）` : msg.content,
        timestamp: new Date(msg.timestamp).getTime(),
      };
      result.push(userMsg);
    } else if (msg.role === 'assistant') {
      const steers = appliedSteers(msg);
      // A steer delivered at the very start of the turn precedes the first
      // assistant message (spec §3.2.5, afterToolCallId = null).
      pushSteers(result, steers.filter(note => !hasToolCall(msg, note)), msg);
      if (msg.isAgentMessage && msg.agentToolCalls && msg.agentToolCalls.length > 0) {
        // Agent assistant message: reconstruct ToolCall content + subsequent ToolResultMessages
        const content: (TextContent | ToolCall)[] = [];

        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }

        for (const tc of msg.agentToolCalls as AgentToolCallRecord[]) {
          content.push({
            type: 'toolCall',
            id: tc.id,
            name: tc.name,
            arguments: tc.params,
          });
        }

        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content,
          api: 'openai-completions',
          provider: 'openai',
          model: '',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'toolUse',
          timestamp: new Date(msg.timestamp).getTime(),
        };
        result.push(assistantMsg);

        // Add tool results — every assistant toolCall MUST have a paired
        // toolResult, otherwise the next LLM call returns
        // `400 invalid_request: tool_use without tool_result` on the
        // anthropic-messages provider (spec §2.7 / P1-10). For cancelled
        // and still-executing branches we synthesise an isError result.
        for (const tc of msg.agentToolCalls as AgentToolCallRecord[]) {
          // status === 'cancelled' or 'executing' (defensive — the on-mount
          // sweep should have demoted any lingering 'executing' before we
          // get here, but treat it identically to cancelled if it slips
          // through).
          if (tc.status === 'cancelled' || tc.status === 'executing') {
            const cancelledBody = `{"error":"cancelled_by_user","detail":"${tc.name} was interrupted by the user before it could complete"}`;
            const toolResult: ToolResultMessage = {
              role: 'toolResult',
              toolCallId: tc.id,
              toolName: tc.name,
              content: [{ type: 'text', text: cancelledBody }],
              isError: true,
              timestamp: new Date(msg.timestamp).getTime(),
            };
            result.push(toolResult);
            continue;
          }

          if (tc.result !== undefined) {
            const isExploreCall = tc.name === 'explore_tools' && tc.status === 'completed';
            const text =
              compactExploreToolsResults && isExploreCall
                ? `(explore_tools result for category "${(tc.params as Record<string, unknown>)?.category ?? 'unknown'}" — see "已加载的高级工具" section in the system prompt for full details.)`
                : JSON.stringify(compactToolResult(tc.result));
            const toolResult: ToolResultMessage = {
              role: 'toolResult',
              toolCallId: tc.id,
              toolName: tc.name,
              content: [{ type: 'text', text }],
              isError: tc.status === 'error',
              timestamp: new Date(msg.timestamp).getTime(),
            };
            result.push(toolResult);
          }
        }
        // History is flattened to ONE assistant message followed by all its
        // tool results; a user message between two of those results would
        // break the tool_use/tool_result pairing, so the steer lands after
        // the whole block instead of right after its own tool result.
        pushSteers(result, steers.filter(note => hasToolCall(msg, note)), msg);
      } else {
        // Normal assistant message
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: msg.content }],
          api: 'openai-completions',
          provider: 'openai',
          model: '',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: 'stop',
          timestamp: new Date(msg.timestamp).getTime(),
        };
        result.push(assistantMsg);
      }
    }
    // Skip 'system' messages — they're handled via systemPrompt
  }

  // Resume-after-cancel system note (spec §2.7).
  //
  // pi-ai's Message union has no `system` role — the agent already takes a
  // single `systemPrompt` field that we can't extend from here. So the
  // note is synthesised as a UserMessage with explicit "[System note: …]"
  // framing, which is the standard cross-provider workaround. It is
  // appended exactly once, only when the most recent assistant in the
  // history was sealed as cancelled — limiting the note to "most recent"
  // prevents N stop/resume cycles from injecting N notes (P1-9).
  if (lastTurnWasStopped) {
    const note: UserMessage = {
      role: 'user',
      content:
        '[System note] The previous assistant turn was stopped by the user. Acknowledge briefly, then resume from the current timeline state — do NOT re-execute the cancelled tool unless the user explicitly asks.',
      timestamp: Date.now(),
    };
    result.push(note);
  }

  return result;
}

type AppliedSteer = NonNullable<ChatMessage['steers']>[number];

/** Only delivered steers are replayed: queued/failed ones already exist as normal user messages. */
function appliedSteers(msg: ChatMessage): AppliedSteer[] {
  return (msg.steers ?? []).filter(note => note.status === 'applied');
}

function hasToolCall(msg: ChatMessage, note: AppliedSteer): boolean {
  return !!note.afterToolCallId
    && (msg.agentToolCalls ?? []).some(call => call.id === note.afterToolCallId);
}

function pushSteers(result: Message[], notes: AppliedSteer[], msg: ChatMessage): void {
  for (const note of notes) {
    result.push({
      role: 'user',
      content: STEER_WRAPPER(note.text),
      timestamp: note.createdAt || new Date(msg.timestamp).getTime(),
    });
  }
}
