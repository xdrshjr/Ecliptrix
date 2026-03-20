/**
 * Timeline Chat UI — shared type definitions.
 *
 * These types power the vertical-timeline message view that replaces
 * the old AgentMessageBubble / AgentToolCallCard components.
 *
 * @module timeline/types
 */

import type { AgentToolCallRecord, ChatMessage, TimelineState } from '@/types';
import type { AgentExecutionState, ToolCallRecord as ExecToolCallRecord } from '@/components/video/hooks/useAgentExecutionState';

// ---------------------------------------------------------------------------
// TimelineNode variants
// ---------------------------------------------------------------------------

/** Discriminated union for the different node kinds rendered on the timeline. */
export type TimelineNodeData =
  | UserMessageNodeData
  | AgentThinkingNodeData
  | AgentExecutionNodeData
  | AgentResponseNodeData;

export interface UserMessageNodeData {
  kind: 'user';
  id: string;
  timestamp: Date;
  content: string;
}

export interface AgentThinkingNodeData {
  kind: 'thinking';
  id: string;
  timestamp: Date;
  content: string;
  isStreaming: boolean;
}

export interface AgentExecutionNodeData {
  kind: 'execution';
  id: string;
  timestamp: Date;
  /** Completed + current tool calls from the ChatMessage. */
  toolCalls: AgentToolCallRecord[];
  /** True while the agent is still executing tools. */
  isActive: boolean;
  /** Source message ID, for undo correlation. */
  messageId: string;
}

export interface AgentResponseNodeData {
  kind: 'response';
  id: string;
  timestamp: Date;
  content: string;
  /** Tool calls associated with this response, for single-op undo buttons. */
  toolCalls: AgentToolCallRecord[];
  /** Whether the whole message has been undone. */
  isUndone: boolean;
  /** Source message ID, for undo actions. */
  messageId: string;
  /** Whether single-operation undo is available. */
  canUndo: boolean;
}

// ---------------------------------------------------------------------------
// ToolStep display state
// ---------------------------------------------------------------------------

export type ToolStepStatus = 'executing' | 'completed' | 'error' | 'undone';

export interface ToolStepData {
  id: string;
  name: string;
  displayName: string;
  status: ToolStepStatus;
  params: Record<string, unknown>;
  result?: unknown;
  /** Elapsed time in ms for this step (null if not completed). */
  elapsedMs: number | null;
  /** One-line summary auto-generated from the result. */
  summary: string;
}

// ---------------------------------------------------------------------------
// TimelineConnector state
// ---------------------------------------------------------------------------

export type ConnectorState = 'default' | 'active' | 'undone';

// ---------------------------------------------------------------------------
// TimelineChatPanel props (the main public API consumed by VideoChatWindow)
// ---------------------------------------------------------------------------

export interface TimelineChatPanelProps {
  messages: ChatMessage[];
  /** Real-time execution state provided by useAgentExecution (google-dev-04). */
  executionState: AgentExecutionState | null;
  /** Called to undo ALL operations in a given agent message. */
  onUndoAll: (messageId: string) => void;
  /** Called to undo a single tool call operation. */
  onUndoSingle: (messageId: string, toolCallId: string) => void;
  /** Called to cancel in-flight agent execution. */
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Enhanced AgentToolCallRecord with preOperationSnapshot (for single-op undo)
// ---------------------------------------------------------------------------

/**
 * Extended tool call record that includes a partial timeline snapshot
 * captured _before_ the operation was applied. Used by the undo system
 * to revert a single tool call without affecting other operations.
 */
export interface EnhancedToolCallRecord extends AgentToolCallRecord {
  /** Partial snapshot of timeline state right before this tool executed. */
  preOperationSnapshot?: Partial<TimelineState>;
}
