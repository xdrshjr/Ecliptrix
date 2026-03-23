/**
 * Timeline Chat UI — utility functions.
 *
 * Pure helper functions used by timeline components. No React imports,
 * no side effects — safe to unit-test in isolation.
 *
 * @module timeline/utils
 */

import type { AgentToolCallRecord, ChatMessage } from '@/types';
import type {
  TimelineNodeData,
  ToolStepData,
  ToolStepStatus,
} from './types';

// ---------------------------------------------------------------------------
// Tool display name mapping
// ---------------------------------------------------------------------------

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_timeline: 'Get Timeline',
  search_materials: 'Search Materials',
  add_to_track: 'Add to Track',
  trim_clip: 'Trim Clip',
  delete_clip: 'Delete Clip',
  move_clip: 'Move Clip',
  resize_clip: 'Resize Clip',
  split_clip: 'Split Clip',
  adjust_volume: 'Adjust Volume',
  add_text_overlay: 'Add Text Overlay',
  add_transition: 'Add Transition',
  set_clip_speed: 'Set Clip Speed',
};

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

/** Format elapsed ms as human-readable (e.g. "1.2s", "320ms"). */
export function formatElapsedTime(ms: number | null): string {
  if (ms === null || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a Date to a short time string like "14:23". */
export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Format a param value for display. */
export function formatParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

/** Generate a one-line summary from a tool result. */
export function summarizeResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') {
    return result.length > 80 ? result.slice(0, 77) + '...' : result;
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if ('success' in obj && 'message' in obj) {
      return String(obj.message);
    }
    if ('content' in obj) {
      const c = String(obj.content);
      return c.length > 80 ? c.slice(0, 77) + '...' : c;
    }
    // Fallback: stringify and truncate
    const str = JSON.stringify(result);
    return str.length > 80 ? str.slice(0, 77) + '...' : str;
  }
  return String(result);
}

/** Format full result for expanded view. */
export function formatResult(result: unknown): string {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    if ('success' in obj && 'message' in obj) {
      return String(obj.message);
    }
    if ('content' in obj) return String(obj.content);
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

// ---------------------------------------------------------------------------
// AgentToolCallRecord → ToolStepData
// ---------------------------------------------------------------------------

export function toolCallToStepData(tc: AgentToolCallRecord): ToolStepData {
  return {
    id: tc.id,
    name: tc.name,
    displayName: getToolDisplayName(tc.name),
    status: tc.status as ToolStepStatus,
    params: tc.params,
    result: tc.result,
    elapsedMs: null, // Not tracked in current ChatMessage — could be enhanced
    summary: tc.result ? summarizeResult(tc.result) : '',
  };
}

// ---------------------------------------------------------------------------
// mapMessageToNodes — the core mapping logic
// ---------------------------------------------------------------------------

/**
 * Split a single ChatMessage into one or more TimelineNodeData entries.
 *
 * Mapping rules (from Spec 03):
 * - Non-agent user messages → UserMessageNodeData
 * - Non-agent assistant messages → AgentResponseNodeData (reusing the "response" kind)
 * - Agent message that is streaming with NO tool calls yet → ThinkingNode
 * - Agent message with tool calls → ExecutionNode
 * - Agent message that is done streaming and has content → ResponseNode
 *
 * A single agent message may produce up to 3 nodes (thinking + execution + response)
 * depending on which fields are populated. During streaming, the split evolves over
 * time as tool calls begin and content finalizes.
 */
export function mapMessageToNodes(message: ChatMessage): TimelineNodeData[] {
  const nodes: TimelineNodeData[] = [];

  if (!message.isAgentMessage) {
    // Plain user or assistant message
    if (message.role === 'user') {
      nodes.push({
        kind: 'user',
        id: `${message.id}-user`,
        timestamp: message.timestamp,
        content: message.content,
      });
    } else {
      // assistant or system — render as a response node
      nodes.push({
        kind: 'response',
        id: `${message.id}-response`,
        timestamp: message.timestamp,
        content: message.content,
        toolCalls: [],
        isUndone: false,
        messageId: message.id,
        canUndo: false,
        isStreaming: !!message.isStreaming,
      });
    }
    return nodes;
  }

  // --- Agent message: may produce thinking + execution + response ---

  const hasToolCalls = (message.agentToolCalls?.length ?? 0) > 0;
  const isStreaming = !!message.isStreaming;

  // 1. Thinking node: streaming text with no tool calls yet
  if (isStreaming && !hasToolCalls && message.content) {
    nodes.push({
      kind: 'thinking',
      id: `${message.id}-thinking`,
      timestamp: message.timestamp,
      content: message.content,
      isStreaming: true,
    });
  }

  // 2. Execution node: when tool calls exist
  if (hasToolCalls) {
    nodes.push({
      kind: 'execution',
      id: `${message.id}-execution`,
      timestamp: message.timestamp,
      toolCalls: message.agentToolCalls!,
      isActive: isStreaming,
      messageId: message.id,
    });
  }

  // 3. Response node: finalized text after streaming ends
  if (!isStreaming && message.content) {
    const operationCount = message.pendingOperations?.length ?? 0;
    nodes.push({
      kind: 'response',
      id: `${message.id}-response`,
      timestamp: message.timestamp,
      content: message.content,
      toolCalls: message.agentToolCalls ?? [],
      isUndone: !!message.isUndone,
      messageId: message.id,
      canUndo: operationCount > 0 && !message.isUndone,
      isStreaming: false,
    });
  }

  // 4. Fallback: finalized agent message with no content and no tool calls
  //    (e.g., model returned empty response). Prevents a blank gap in the UI.
  if (!isStreaming && !message.content && !hasToolCalls) {
    nodes.push({
      kind: 'response',
      id: `${message.id}-response`,
      timestamp: message.timestamp,
      content: 'The model did not return a response.',
      toolCalls: [],
      isUndone: false,
      messageId: message.id,
      canUndo: false,
      isStreaming: false,
    });
  }

  return nodes;
}

/**
 * Flatten all conversation messages into a sorted list of TimelineNodeData.
 * Used by TimelineChatPanel.
 */
export function messagesToTimelineNodes(messages: ChatMessage[]): TimelineNodeData[] {
  return messages.flatMap(mapMessageToNodes);
}
