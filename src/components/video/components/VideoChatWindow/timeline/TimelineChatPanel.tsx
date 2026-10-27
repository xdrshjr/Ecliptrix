/**
 * TimelineChatPanel — the main timeline-based message display component.
 *
 * Replaces the flat message list in VideoChatWindow with a vertical timeline.
 * Composes TimelineConnector lines between TimelineNode variants, handles
 * auto-scroll, and wires up real-time execution state from useAgentExecution.
 *
 * Enhanced (Spec 05):
 * - AnimatePresence wraps the node list for smooth enter/exit animations
 * - TimelineAnimationStyles injected once for CSS @keyframes
 * - WelcomeGuide shown when messages are empty
 * - ErrorStateCard shown for agent-level errors (the run is over, so it
 *   offers Dismiss, never Cancel)
 * - Cancel button passed to AgentExecutionNode
 * - All nodes use shared animation variants
 *
 * @module timeline/TimelineChatPanel
 */

'use client';

import React, {
  useRef, useEffect, useLayoutEffect, useCallback, useMemo,
} from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import { streamErrorMessageKey } from '@/lib/video-editing-agent/errorRecovery';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import type { TimelineChatPanelProps, TimelineNodeData, ConnectorState } from './types';
import { getToolDisplayName, messagesToTimelineNodes } from './utils';
import TimelineAnimationStyles from './TimelineAnimationStyles';
import TimelineConnector from './TimelineConnector';
import UserMessageNode from './UserMessageNode';
import AgentThinkingNode from './AgentThinkingNode';
import AgentExecutionNode from './AgentExecutionNode';
import AgentResponseNode from './AgentResponseNode';
import ErrorStateCard from './ErrorStateCard';
import CompactionDivider from '../CompactionDivider';
import type { ErrorCardVariant } from './ErrorStateCard';
import { CSS_ANIMATIONS } from './animations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the connector state between two adjacent nodes.
 */
function getConnectorState(
  prevNode: TimelineNodeData | null,
  nextNode: TimelineNodeData,
): ConnectorState {
  // If the next node is an active execution or thinking → active line
  if (nextNode.kind === 'thinking' && nextNode.isStreaming) return 'active';
  if (nextNode.kind === 'execution' && nextNode.isActive) return 'active';

  // If the next node is an undone response → undone line
  if (nextNode.kind === 'response' && nextNode.isUndone) return 'undone';

  // If previous node was undone response → undone line continuation
  if (prevNode?.kind === 'response' && prevNode.isUndone) return 'undone';

  return 'default';
}

// ---------------------------------------------------------------------------
// Live execution indicator — shown at the bottom when agent is executing
// but no message nodes exist yet for the current execution
// ---------------------------------------------------------------------------

/** The stream is open, or it ended and the last operations are still being applied. */
function isAgentRunning(status: AgentExecutionState['status'] | undefined): boolean {
  return status === 'executing' || status === 'retrying' || status === 'finishing';
}

interface LiveExecutionIndicatorProps {
  executionState: AgentExecutionState;
  onCancel: () => void;
  /** Label shown while status is `finishing`. */
  finishingLabel: string;
}

const LiveExecutionIndicator: React.FC<LiveExecutionIndicatorProps> = ({
  executionState,
  onCancel,
  finishingLabel,
}) => {
  const { t } = useLocale();
  if (!isAgentRunning(executionState.status)) {
    return null;
  }

  // The stream already ended: stopping would do nothing, so the button is disabled.
  const isFinishing = executionState.status === 'finishing';
  const currentToolName = executionState.currentTool
    ? getToolDisplayName(executionState.currentTool.name, t.agentTimeline.toolNames)
    : null;
  const completedCount = executionState.completedTools.length;

  return (
    <div className="flex items-start gap-0 py-1">
      {/* Icon with pulse */}
      <div className="w-[32px] h-[32px] flex items-center justify-center flex-shrink-0 relative">
        <div className="absolute w-5 h-5 rounded-full border-2 border-primary/40 dark:border-primary/30 animate-ping" />
        <div className={`w-3 h-3 rounded-full bg-primary ${CSS_ANIMATIONS.pulse}`} />
      </div>

      {/* Status text */}
      <div className="flex-1 min-w-0 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-primary dark:text-primary/90">
            {isFinishing
              ? finishingLabel
              : executionState.status === 'retrying'
                ? t.agentTimeline.liveRetrying.replace('{n}', String(executionState.retryCount))
                : currentToolName
                  ? t.agentTimeline.liveTool.replace('{tool}', currentToolName)
                  : completedCount > 0
                    ? t.agentTimeline.liveProgress.replace('{count}', String(completedCount))
                    : t.agentTimeline.liveWorking}
          </span>

          {/* Stop button — same action and label as the execution card's */}
          <button
            type="button"
            onClick={onCancel}
            disabled={isFinishing}
            title={isFinishing ? finishingLabel : undefined}
            className="text-xs text-muted-foreground dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-auto px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 border border-transparent hover:border-red-200 dark:hover:border-red-800/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-transparent disabled:hover:border-transparent"
          >
            {t.agentTimeline.stop}
          </button>
        </div>

        {/* Streaming text preview */}
        {executionState.pendingMessage && (
          <div className="text-xs text-muted-foreground dark:text-zinc-400 mt-1 truncate max-w-[280px]">
            {executionState.pendingMessage.slice(0, 100)}
            {executionState.pendingMessage.length > 100 ? '...' : ''}
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// TimelineChatPanel
// ---------------------------------------------------------------------------

type TimelineChatPanelComponentProps = TimelineChatPanelProps & {
  /** Disables agent undo buttons (set while the agent runs). */
  undoDisabled?: boolean;
  /** Clears the error of a run that already ended (the error card's action). */
  onDismiss?: () => void;
  /**
   * Agent messages whose steps can still be undone one by one in this
   * session. When omitted every turn offers single-step undo.
   */
  singleUndoMessageIds?: ReadonlySet<string>;
  /** `[[ask:<id>]]` answers already present in the conversation. */
  answeredQuestionIds?: ReadonlySet<string>;
  /** Questions whose turn ended without an answer. */
  unresolvedQuestionIds?: ReadonlySet<string>;
};

/** 持续保存可见状态的快照，不能在 display:none 后读取零尺寸。 */
function useVisibleScroll(isVisible: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(isVisible);
  const snapshotRef = useRef({ top: 0, follow: true });
  visibleRef.current = isVisible;

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!visibleRef.current || !container || !snapshotRef.current.follow) return;
    container.scrollTop = Math.max(0,
      container.scrollHeight - container.clientHeight);
    snapshotRef.current.top = container.scrollTop;
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!visibleRef.current || !container) return;
    // 程序恢复产生的 scroll 事件不得改变用户此前选择的跟随策略。
    if (container.scrollTop === snapshotRef.current.top) return;
    snapshotRef.current = {
      top: container.scrollTop,
      follow: container.scrollHeight - container.scrollTop -
        container.clientHeight < 100,
    };
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!isVisible || !container) return;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = snapshotRef.current.follow
      ? maxTop : Math.min(snapshotRef.current.top, maxTop);
    snapshotRef.current.top = container.scrollTop;
  }, [isVisible]);

  return { containerRef, scrollToBottom, handleScroll };
}

// 保留现有时间线渲染集中接线，本次仅修改可见性与连接线判断。
const TimelineChatPanel: React.FC<TimelineChatPanelComponentProps> = ({
  messages,
  executionState,
  onUndoAll,
  onUndoSingle,
  onCancel,
  undoDisabled: undoDisabledProp = false,
  onDismiss,
  singleUndoMessageIds,
  answeredQuestionIds,
  unresolvedQuestionIds,
  onUndoCompaction,
  compactingAfterMessageId,
  isVisible = true,
}) => {
  const { t } = useLocale();
  const isFinishing = executionState?.status === 'finishing';
  const undoDisabled = undoDisabledProp || isAgentRunning(executionState?.status);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { containerRef, scrollToBottom, handleScroll } =
    useVisibleScroll(isVisible);

  // Scroll when messages change
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom, isVisible]);

  // Scroll during streaming — 150ms interval to avoid excess operations
  const hasStreaming = useMemo(
    () => messages.some((m) => m.isStreaming),
    [messages],
  );

  useEffect(() => {
    if (!isVisible ||
        (!hasStreaming && !isAgentRunning(executionState?.status))) return;
    const id = setInterval(scrollToBottom, 150);
    return () => clearInterval(id);
  }, [hasStreaming, executionState?.status, scrollToBottom, isVisible]);

  // ----- Map messages to timeline nodes -----

  const emptyResponseLabel = t.agentStream.errors.emptyResponse;
  const nodes = useMemo(
    () => messagesToTimelineNodes(messages, { emptyResponse: emptyResponseLabel },
      { compactingAfterMessageId }),
    [messages, emptyResponseLabel, compactingAfterMessageId],
  );

  // ----- Determine if we need a live execution indicator at the end -----
  // While finishing it is always shown: it tells the user why the timeline is
  // still locked for a moment after the answer arrived.
  const showLiveIndicator =
    executionState != null &&
    (isFinishing ||
      ((executionState.status === 'executing' || executionState.status === 'retrying') &&
        (messages.length === 0 || !messages[messages.length - 1].isStreaming)));

  // ----- Determine error state -----
  const showError =
    executionState != null && executionState.status === 'error' && executionState.error != null;

  const errorVariant: ErrorCardVariant | null = useMemo(() => {
    if (!showError || !executionState?.error) return null;
    const errType = executionState.error.type;
    if (errType === 'network_drop' || errType === 'heartbeat_timeout') return 'reconnecting';
    if (errType === 'total_timeout') return 'timeout';
    return 'error';
  }, [showError, executionState?.error]);

  // ----- Empty state -----

  if (nodes.length === 0 && !showLiveIndicator && !showError) {
    return null; // Empty — let parent show WelcomeGuide or placeholder
  }

  // ----- Render -----

  return (
    <div
      ref={containerRef}
      className="agent-chat-messages flex-1 overflow-y-auto overscroll-contain px-4 py-4 min-h-0"
      onScroll={handleScroll}
    >
      {/* Inject CSS @keyframes once */}
      <TimelineAnimationStyles />

      {/* Render nodes with connectors between them — wrapped in AnimatePresence */}
      <AnimatePresence initial={false} mode="popLayout">
        {nodes.map((node, idx) => {
          const prevNode = idx > 0 ? nodes[idx - 1] : null;
          const connectorState = idx > 0 ? getConnectorState(prevNode, node) : 'default';

          return (
            <div key={node.id}>
              {/* Connector line between nodes (skip before first) */}
              {idx > 0 && <TimelineConnector state={connectorState} height={12} />}

              {/* The node itself */}
              {node.kind === 'user' && <UserMessageNode node={node} />}
              {node.kind === 'thinking' && <AgentThinkingNode node={node} />}
              {node.kind === 'execution' && (
                <AgentExecutionNode node={node}
                  onCancel={isFinishing ? undefined : onCancel}
                  answeredQuestionIds={answeredQuestionIds}
                  unresolvedQuestionIds={unresolvedQuestionIds} />
              )}
              {node.kind === 'compaction' && (
                <CompactionDivider pending={node.pending} messageId={node.messageId}
                  summaryText={node.summaryText} coveredCount={node.coveredCount}
                  tokensBefore={node.tokensBefore} tokensAfter={node.tokensAfter}
                  undoDisabled={undoDisabled} onUndo={onUndoCompaction} />
              )}
              {node.kind === 'response' && (
                <AgentResponseNode
                  node={node}
                  onUndoAll={onUndoAll}
                  onUndoSingle={onUndoSingle}
                  undoDisabled={undoDisabled}
                  canUndoSteps={singleUndoMessageIds ? singleUndoMessageIds.has(node.messageId) : true}
                />
              )}
            </div>
          );
        })}
      </AnimatePresence>

      {/* Live execution indicator (when agent is running but no streaming message yet) */}
      {showLiveIndicator && executionState && (
        <>
          {nodes.length > 0 && <TimelineConnector state="active" height={16} />}
          <LiveExecutionIndicator
            executionState={executionState}
            onCancel={onCancel}
            finishingLabel={t.agentApply.finishing}
          />
        </>
      )}

      {/* Agent-level error card */}
      {showError && executionState?.error && errorVariant && (
        <>
          {nodes.length > 0 && <TimelineConnector state="default" height={16} />}
          <ErrorStateCard
            variant={errorVariant}
            message={t.agentTimeline.errorPrefix.replace(
              '{message}',
              t.agentStream.errors[streamErrorMessageKey(executionState.error)],
            )}
            retryCount={executionState.retryCount}
            maxRetries={2}
            onDismiss={onDismiss}
            onRetry={undefined /* retry is handled by the execution engine automatically */}
          />
        </>
      )}

      {/* Scroll anchor */}
      <div ref={bottomRef} />
    </div>
  );
};

export default TimelineChatPanel;
