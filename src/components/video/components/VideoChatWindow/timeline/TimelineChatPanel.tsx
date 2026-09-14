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
 * - ErrorStateCard shown for agent-level errors
 * - Cancel button passed to AgentExecutionNode
 * - All nodes use shared animation variants
 *
 * @module timeline/TimelineChatPanel
 */

'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentExecutionState } from '@/components/video/hooks/useAgentExecutionState';
import type { TimelineChatPanelProps, TimelineNodeData, ConnectorState } from './types';
import { messagesToTimelineNodes } from './utils';
import TimelineAnimationStyles from './TimelineAnimationStyles';
import TimelineConnector from './TimelineConnector';
import UserMessageNode from './UserMessageNode';
import AgentThinkingNode from './AgentThinkingNode';
import AgentExecutionNode from './AgentExecutionNode';
import AgentResponseNode from './AgentResponseNode';
import ErrorStateCard from './ErrorStateCard';
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
  if (nextNode.kind === 'thinking' && nextNode.isThinkingPhase) return 'active';
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
  if (!isAgentRunning(executionState.status)) {
    return null;
  }

  // The stream already ended: stopping would do nothing, so the button is disabled.
  const isFinishing = executionState.status === 'finishing';
  const currentToolName = executionState.currentTool?.name ?? null;
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
                ? `Retrying (attempt ${executionState.retryCount})...`
                : currentToolName
                  ? `Executing: ${currentToolName}`
                  : completedCount > 0
                    ? `Completed ${completedCount} operation${completedCount > 1 ? 's' : ''}, continuing...`
                    : 'Agent is working...'}
          </span>

          {/* Cancel button */}
          <button
            type="button"
            onClick={onCancel}
            disabled={isFinishing}
            title={isFinishing ? finishingLabel : undefined}
            className="text-xs text-muted-foreground dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-auto px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 border border-transparent hover:border-red-200 dark:hover:border-red-800/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground disabled:hover:bg-transparent disabled:hover:border-transparent"
          >
            Cancel
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
};

const TimelineChatPanel: React.FC<TimelineChatPanelComponentProps> = ({
  messages,
  executionState,
  onUndoAll,
  onUndoSingle,
  onCancel,
  undoDisabled: undoDisabledProp = false,
}) => {
  const { t } = useLocale();
  const isFinishing = executionState?.status === 'finishing';
  const undoDisabled = undoDisabledProp || isAgentRunning(executionState?.status);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // ----- Auto-scroll logic (optimized) -----

  const isNearBottom = useCallback(() => {
    if (!containerRef.current) return true;
    const c = containerRef.current;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback(
    (force = false) => {
      if (!shouldAutoScrollRef.current && !force) return;
      const c = containerRef.current;
      if (c) c.scrollTop = c.scrollHeight;
    },
    [],
  );

  const handleScroll = useCallback(() => {
    const nearBottom = isNearBottom();
    if (nearBottom !== shouldAutoScrollRef.current) {
      shouldAutoScrollRef.current = nearBottom;
      setShouldAutoScroll(nearBottom);
    }
  }, [isNearBottom]);

  // Scroll when messages change
  useEffect(() => {
    const timer = setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom]);

  // Scroll during streaming — 150ms interval to avoid excess operations
  const hasStreaming = useMemo(
    () => messages.some((m) => m.isStreaming),
    [messages],
  );

  useEffect(() => {
    if (!hasStreaming && !isAgentRunning(executionState?.status)) return;
    const id = setInterval(() => {
      if (shouldAutoScrollRef.current) scrollToBottom();
    }, 150);
    return () => clearInterval(id);
  }, [hasStreaming, executionState?.status, scrollToBottom]);

  // ----- Map messages to timeline nodes -----

  const nodes = useMemo(() => messagesToTimelineNodes(messages), [messages]);

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
      className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 min-h-0"
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
              {idx > 0 && <TimelineConnector state={connectorState} height={16} />}

              {/* The node itself */}
              {node.kind === 'user' && <UserMessageNode node={node} />}
              {node.kind === 'thinking' && <AgentThinkingNode node={node} />}
              {node.kind === 'execution' && (
                <AgentExecutionNode node={node} onCancel={isFinishing ? undefined : onCancel} />
              )}
              {node.kind === 'response' && (
                <AgentResponseNode
                  node={node}
                  onUndoAll={onUndoAll}
                  onUndoSingle={onUndoSingle}
                  undoDisabled={undoDisabled}
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
            message={executionState.error.userMessage || executionState.error.message || 'An unexpected error occurred.'}
            retryCount={executionState.retryCount}
            maxRetries={2}
            onCancel={onCancel}
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
