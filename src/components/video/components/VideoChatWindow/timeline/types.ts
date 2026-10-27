/**
 * Timeline Chat UI — shared type definitions.
 *
 * These types power the vertical-timeline message view that replaces
 * the old AgentMessageBubble / AgentToolCallCard components.
 *
 * @module timeline/types
 */

import type { AgentToolCallRecord, ChatMessage, TimelineState } from '@/types';
import type { SteerNote } from '@/types/agentSteering';
import type { TurnSummary } from '../turnSummary';
import type { AgentExecutionState, ToolCallRecord as ExecToolCallRecord } from '@/components/video/hooks/useAgentExecutionState';

// ---------------------------------------------------------------------------
// TimelineNode variants
// ---------------------------------------------------------------------------

/** Discriminated union for the different node kinds rendered on the timeline. */
export type TimelineNodeData =
  | UserMessageNodeData
  | AgentThinkingNodeData
  | AgentExecutionNodeData
  | AgentResponseNodeData
  | CompactionNodeData;

export interface UserMessageNodeData {
  kind: 'user';
  id: string;
  timestamp: Date;
  content: string;
}

/** Where earlier turns were folded into a digest (or are about to be). */
export interface CompactionNodeData {
  kind: 'compaction';
  id: string;
  timestamp: Date;
  /** The compaction message; absent for the pending placeholder. */
  messageId?: string;
  pending: boolean;
  summaryText: string;
  coveredCount: number;
  tokensBefore: number;
  tokensAfter: number;
}

export interface AgentThinkingNodeData {
  kind: 'thinking';
  id: string;
  timestamp: Date;
  content: string;
  isStreaming: boolean;
  /** Pre-execution thinking content from the thinking phase. */
  thinkingContent?: string;
  /** Whether the thinking phase is still active (streaming thinking content). */
  isThinkingPhase?: boolean;
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
  /** Notes the user added mid-run; each sits after the step it followed. */
  steers?: SteerNote[];
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
  /** Whether this response is still being streamed. */
  isStreaming?: boolean;
  /** What this turn changed; absent while streaming or when there is nothing to report. */
  summary?: TurnSummary | null;
}

// ---------------------------------------------------------------------------
// ToolStep display state
// ---------------------------------------------------------------------------

export type ToolStepStatus = 'executing' | 'completed' | 'error' | 'undone' | 'cancelled';

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
  /** 最小化时暂停自动滚动，重开恢复当前会话的阅读位置。 */
  isVisible?: boolean;
  /** Removes a compaction message, restoring what it superseded. */
  onUndoCompaction?: (compactionId: string) => void;
  /** The digest being made will follow this message; shows the skeleton there. */
  compactingAfterMessageId?: string | null;
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
