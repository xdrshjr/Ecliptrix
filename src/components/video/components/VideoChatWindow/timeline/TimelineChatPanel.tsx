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
import type { ChatMessage } from '@/types';
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

interface LiveExecutionIndicatorProps {
  executionState: AgentExecutionState;
  onCancel: () => void;
}

const LiveExecutionIndicator: React.FC<LiveExecutionIndicatorProps> = ({
  executionState,
  onCancel,
}) => {
  if (executionState.status !== 'executing' && executionState.status !== 'retrying') {
    return null;
  }

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
            {executionState.status === 'retrying'
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
            className="text-xs text-muted-foreground dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors ml-auto px-2 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 border border-transparent hover:border-red-200 dark:hover:border-red-800/50"
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

const TimelineChatPanel: React.FC<TimelineChatPanelProps> = ({
  messages,
  executionState,
  onUndoAll,
  onUndoSingle,
  onCancel,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // ----- Auto-scroll logic (ported from VideoChatWindow) -----

  const isNearBottom = useCallback(() => {
    if (!containerRef.current) return true;
    const c = containerRef.current;
    return c.scrollHeight - c.scrollTop - c.clientHeight < 100;
  }, []);

  const scrollToBottom = useCallback(
    (force = false) => {
      if (!shouldAutoScroll && !force) return;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    },
    [shouldAutoScroll],
  );

  const handleScroll = useCallback(() => {
    setShouldAutoScroll(isNearBottom());
  }, [isNearBottom]);

  // Scroll when messages change
  useEffect(() => {
    const timer = setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(timer);
  }, [messages, scrollToBottom]);

  // High-frequency scroll during streaming
  const hasStreaming = useMemo(
    () => messages.some((m) => m.isStreaming),
    [messages],
  );

  useEffect(() => {
    if (!hasStreaming && !(executionState?.status === 'executing')) return;
    const id = setInterval(() => {
      if (shouldAutoScroll) scrollToBottom();
    }, 100);
    return () => clearInterval(id);
  }, [hasStreaming, executionState?.status, shouldAutoScroll, scrollToBottom]);

  // ----- Map messages to timeline nodes -----

  const nodes = useMemo(() => messagesToTimelineNodes(messages), [messages]);

  // ----- Determine if we need a live execution indicator at the end -----
  const showLiveIndicator =
    executionState != null &&
    (executionState.status === 'executing' || executionState.status === 'retrying') &&
    (messages.length === 0 || !messages[messages.length - 1].isStreaming);

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
      className="flex-1 overflow-y-auto px-4 py-4 min-h-0"
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
            <React.Fragment key={node.id}>
              {/* Connector line between nodes (skip before first) */}
              {idx > 0 && <TimelineConnector state={connectorState} height={16} />}

              {/* The node itself */}
              {node.kind === 'user' && <UserMessageNode node={node} />}
              {node.kind === 'thinking' && <AgentThinkingNode node={node} />}
              {node.kind === 'execution' && (
                <AgentExecutionNode node={node} onCancel={onCancel} />
              )}
              {node.kind === 'response' && (
                <AgentResponseNode
                  node={node}
                  onUndoAll={onUndoAll}
                  onUndoSingle={onUndoSingle}
                />
              )}
            </React.Fragment>
          );
        })}
      </AnimatePresence>

      {/* Live execution indicator (when agent is running but no streaming message yet) */}
      {showLiveIndicator && executionState && (
        <>
          {nodes.length > 0 && <TimelineConnector state="active" height={16} />}
          <LiveExecutionIndicator executionState={executionState} onCancel={onCancel} />
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
