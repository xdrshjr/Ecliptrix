/**
 * Timeline Chat UI — utility functions.
 *
 * Pure helper functions used by timeline components. No React imports,
 * no side effects — safe to unit-test in isolation.
 *
 * @module timeline/utils
 */

import type { AgentToolCallRecord, ChatMessage } from '@/types';
import { summarizeTurn } from '../turnSummary';
import type {
  TimelineNodeData,
  ToolStepData,
  ToolStepStatus,
} from './types';

// ---------------------------------------------------------------------------
// Tool display name mapping
// ---------------------------------------------------------------------------

/** Localised tool names (`t.agentTimeline.toolNames`). */
export type ToolNameLabels = Readonly<Record<string, string>>;

/** Localised name of a tool; unknown tools (or no labels) show the raw name. */
export function getToolDisplayName(toolName: string, toolNames?: ToolNameLabels): string {
  if (toolNames && Object.prototype.hasOwnProperty.call(toolNames, toolName)) {
    return toolNames[toolName];
  }
  return toolName;
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
    if ('success' in obj && 'error' in obj) {
      const errMsg = String(obj.error);
      return errMsg.length > 80 ? errMsg.slice(0, 77) + '...' : errMsg;
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
    if ('success' in obj && 'error' in obj) {
      return String(obj.error);
    }
    if ('content' in obj) return String(obj.content);
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

// ---------------------------------------------------------------------------
// AgentToolCallRecord → ToolStepData
// ---------------------------------------------------------------------------

export function toolCallToStepData(
  tc: AgentToolCallRecord,
  toolNames?: ToolNameLabels,
): ToolStepData {
  return {
    id: tc.id,
    name: tc.name,
    displayName: getToolDisplayName(tc.name, toolNames),
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
 *
 * `labels.emptyResponse` is the localised text shown for a finished agent
 * message that produced neither text nor tool calls.
 */
export interface TimelineNodeLabels {
  emptyResponse: string;
}

// 映射分支保留在一起以确保节点顺序和稳定 ID；既有函数超过 60 行。
export function mapMessageToNodes(
  message: ChatMessage,
  labels: TimelineNodeLabels,
): TimelineNodeData[] {
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

  // --- Agent message: may produce agent_thinking + thinking + execution + response ---

  const hasToolCalls = (message.agentToolCalls?.length ?? 0) > 0;
  const isStreaming = message.isStreaming === true && !message.isCancelled;
  const hasThinkingContent = !!message.thinkingContent;

  // 0. Agent thinking-phase node: shows the pre-execution analysis
  if (hasThinkingContent || message.isThinking) {
    nodes.push({
      kind: 'thinking',
      id: `${message.id}-agent-thinking`,
      timestamp: message.timestamp,
      content: message.thinkingContent ?? '',
      isStreaming: message.isThinking === true && isStreaming,
      thinkingContent: message.thinkingContent,
      isThinkingPhase: true,
    });
  }

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
      ...(message.steers?.length ? { steers: message.steers } : {}),
    });
  }

  // 3. Response node: finalized text after streaming ends. A turn stopped
  //    after its tool calls but before any text still gets one (with no
  //    text), because this node carries the turn's only "Undo all" button.
  // Only turns that recorded track patches can be reverted. Older messages
  // (whole-timeline snapshots) hide the button instead of wiping later edits.
  const patchCount = message.timelineTrackPatches?.length ?? 0;
  const isToolOnlyTurn = !message.content && hasToolCalls && patchCount > 0;
  if (!isStreaming && (message.content || isToolOnlyTurn)) {
    nodes.push({
      kind: 'response',
      id: `${message.id}-response`,
      timestamp: message.timestamp,
      content: message.content,
      toolCalls: message.agentToolCalls ?? [],
      isUndone: !!message.isUndone,
      messageId: message.id,
      summary: summarizeTurn(message),
      canUndo: patchCount > 0 && !message.isUndone,
      isStreaming: false,
    });
  }

  // 4. Fallback: finalized agent message with no content and no tool calls
  //    (e.g., model returned empty response). Prevents a blank gap in the UI.
  if (!isStreaming && !message.content && !hasToolCalls && !hasThinkingContent) {
    nodes.push({
      kind: 'response',
      id: `${message.id}-response`,
      timestamp: message.timestamp,
      content: labels.emptyResponse,
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
export function messagesToTimelineNodes(
  messages: ChatMessage[],
  labels: TimelineNodeLabels,
): TimelineNodeData[] {
  return messages.flatMap(message => mapMessageToNodes(message, labels));
}
