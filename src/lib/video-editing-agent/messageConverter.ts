import type { Message, UserMessage, AssistantMessage, ToolResultMessage, TextContent, ToolCall } from '@mariozechner/pi-ai';
import type { ChatMessage } from '@/types';
import type { AgentToolCallRecord } from './types';

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

  for (const msg of chatMessages) {
    if (msg.role === 'user') {
      const userMsg: UserMessage = {
        role: 'user',
        content: msg.content,
        timestamp: new Date(msg.timestamp).getTime(),
      };
      result.push(userMsg);
    } else if (msg.role === 'assistant') {
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

        // Add tool results
        for (const tc of msg.agentToolCalls as AgentToolCallRecord[]) {
          if (tc.result !== undefined) {
            const isExploreCall = tc.name === 'explore_tools' && tc.status === 'completed';
            const text =
              compactExploreToolsResults && isExploreCall
                ? `(explore_tools result for category "${(tc.params as Record<string, unknown>)?.category ?? 'unknown'}" — see "已加载的高级工具" section in the system prompt for full details.)`
                : JSON.stringify(tc.result);
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

  return result;
}
