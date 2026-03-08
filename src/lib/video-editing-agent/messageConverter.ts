import type { Message, UserMessage, AssistantMessage, ToolResultMessage, TextContent, ToolCall } from '@mariozechner/pi-ai';
import type { ChatMessage } from '@/types';
import type { AgentToolCallRecord } from './types';

/**
 * Convert app ChatMessage[] to pi-ai Message[] for agent history injection.
 * The LAST user message should be excluded — it's passed to agent.prompt() separately.
 */
export function convertToAgentMessages(chatMessages: ChatMessage[]): Message[] {
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
            const toolResult: ToolResultMessage = {
              role: 'toolResult',
              toolCallId: tc.id,
              toolName: tc.name,
              content: [{ type: 'text', text: JSON.stringify(tc.result) }],
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
