/**
 * AgentExecutionNode — renders the tool-execution phase on the timeline.
 *
 * Shows a concentric-circle icon (with pulse animation when active),
 * a localised executing / executed (M/N) header, and a collapsible list of
 * ToolStep items.
 *
 * Enhanced animations (Spec 05):
 * - Node entrance via shared nodeVariants
 * - Icon: execution-active (CSS pulse) → execution-done (spring checkmark)
 *         or execution-error (spring X + shake)
 * - Expand/collapse: shared expandVariants (height 200ms, content fade 150ms)
 * - Cancel button: shown during active execution
 *
 * @module timeline/AgentExecutionNode
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentToolCallRecord } from '@/types';
import type { AgentExecutionNodeData } from './types';
import { formatTimestamp, toolCallToStepData } from './utils';
import TimelineNodeIcon from './TimelineNodeIcon';
import type { NodeIconVariant } from './TimelineNodeIcon';
import ToolStep from './ToolStep';
import SteerNoteNode from './SteerNoteNode';
import { CoverToolStatus } from '../AgentToolCallCard';
import WebResearchToolCard, { isWebResearchTool } from '../WebResearchToolCard';
import ToolkitToolCard, { askQuestionId, isToolkitTool } from '../ToolkitToolCard';
import QualityReportCard, { ExportInspectCard } from '../QualityReportCard';
import CrewCard from './CrewCard';
import AcquireProgress from './AcquireProgress';
import VisionObservationCard from '../VisionObservationCard';
import {
  isExportInspectTool, isQualityTool, isVisionTool,
} from '@/types/agentVision';
import { nodeVariants, expandVariants, TIMING } from './animations';

interface AgentExecutionNodeProps {
  node: AgentExecutionNodeData;
  /** Cancel callback — shown as a button when node is active. */
  onCancel?: () => void;
  /** `[[ask:<id>]]` answers already present in the conversation. */
  answeredQuestionIds?: ReadonlySet<string>;
  /** Questions whose turn ended without an answer. */
  unresolvedQuestionIds?: ReadonlySet<string>;
}

/**
 * A tool call is only ready for its dedicated card once the result exists.
 *
 * `tool_call` events are recorded with `status: 'executing'` and **no** result,
 * and a cancelled / timed-out call never gets one. Rendering e.g. the lint card
 * from an empty result makes it say "all 16 checks passed" while the check is
 * still running — the exact fake-green the self-check exists to prevent. Until
 * the result lands, the plain `ToolStep` row (spinner / cancelled state) is the
 * honest rendering.
 */
function hasResult(toolCall: AgentToolCallRecord | undefined): boolean {
  return toolCall !== undefined && toolCall.result !== undefined;
}

/**
 * Notes delivered at the very start of the turn (`afterToolCallId` null) or
 * after a step that is no longer listed: they precede the first step, so no
 * note ever disappears from the timeline.
 */
function steerNotesBefore(node: AgentExecutionNodeData) {
  const known = new Set(node.toolCalls.map(call => call.id));
  return (node.steers ?? []).filter(
    note => !note.afterToolCallId || !known.has(note.afterToolCallId));
}

const AgentExecutionNode: React.FC<AgentExecutionNodeProps> = ({
  node, onCancel, answeredQuestionIds, unresolvedQuestionIds,
}) => {
  const { t } = useLocale();
  /**
   * 还有没回答的提问时强制展开。
   *
   * `isActive` 只说明「本轮在跑」；重新打开一个历史会话时它已经是 false，
   * 于是提问卡片（以及选项按钮）被折叠在 `executed (N/N)` 里面 —— 用户看不到
   * 任何待答线索。提问必须有可见出口，所以这一条是**状态初始化**的一部分。
   */
  const hasOpenQuestion = node.toolCalls.some((tc) => {
    if (tc.name !== 'ask_user') return false;
    const questionId = askQuestionId(tc.result);
    return questionId === null || answeredQuestionIds?.has(questionId) !== true;
  });
  // Auto-expand while active, collapse when done (user can toggle)
  const [isExpanded, setIsExpanded] = useState(node.isActive || hasOpenQuestion);

  // Re-expand when execution starts, or when a question is still unanswered
  useEffect(() => {
    if (node.isActive || hasOpenQuestion) {
      setIsExpanded(true);
    }
  }, [node.isActive, hasOpenQuestion]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const steps = node.toolCalls.map((tc) => toolCallToStepData(tc, t.agentTimeline.toolNames));
  const completedCount = steps.filter(
    (s) =>
      s.status === 'completed' ||
      s.status === 'error' ||
      s.status === 'undone' ||
      s.status === 'cancelled'
  ).length;
  const totalCount = steps.length;
  const hasErrors = steps.some((s) => s.status === 'error');

  // Determine icon variant based on node state
  let iconVariant: NodeIconVariant;
  if (node.isActive) {
    iconVariant = 'execution-active';
  } else if (hasErrors) {
    iconVariant = 'execution-error';
  } else {
    iconVariant = 'execution-done';
  }

  return (
    <motion.div
      className="flex items-start gap-0"
      variants={nodeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      layout="position"
    >
      {/* Icon column */}
      <TimelineNodeIcon variant={iconVariant} />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        {/* Header row */}
        <button
          type="button"
          className="flex items-center gap-2 mb-1.5 w-full text-left group"
          onClick={toggleExpand}
          aria-expanded={isExpanded}
        >
          <span className="text-xs text-muted-foreground dark:text-zinc-500 tabular-nums">
            {formatTimestamp(node.timestamp)}
          </span>
          <span className="text-xs font-medium text-foreground dark:text-zinc-200">
            {node.isActive ? t.agentTimeline.executing : t.agentTimeline.executed}
            {' '}
            <span className={`tabular-nums ${hasErrors ? 'text-red-500 dark:text-red-400' : 'text-primary'}`}>
              ({completedCount}/{totalCount})
            </span>
          </span>

          {/* Expand/collapse chevron */}
          <motion.svg
            className="w-3 h-3 text-muted-foreground dark:text-zinc-500 ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: TIMING.ARROW_ROTATE }}
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </motion.svg>
        </button>

        {/* Tool steps list — enhanced expand/collapse */}
        <AnimatePresence initial={false}>
          {isExpanded && steps.length > 0 && (
            <motion.div
              key="steps"
              variants={expandVariants}
              initial="collapsed"
              animate="expanded"
              exit="collapsed"
              className="overflow-hidden"
            >
              <div className="border border-border dark:border-zinc-700 rounded-md overflow-hidden bg-muted/50 dark:bg-zinc-800/50 text-sm">
                {steerNotesBefore(node).map(note => (
                  <SteerNoteNode key={note.id} note={note} />
                ))}
                {steps.map((step, idx) => {
                  const toolCall = node.toolCalls[idx];
                  const settled = hasResult(toolCall);
                  return (
                  <React.Fragment key={step.id}>
                  {settled && isQualityTool(toolCall.name) ? (
                    <QualityReportCard toolCall={toolCall} />
                  ) : settled && isExportInspectTool(toolCall.name) ? (
                    <ExportInspectCard toolCall={toolCall} />
                  ) : settled && isVisionTool(toolCall.name) ? (
                    <VisionObservationCard toolCall={toolCall} />
                  ) : toolCall.name === 'delegate_research' ? (
                    <CrewCard toolCall={toolCall} />
                  ) : toolCall.name === 'acquire_web_materials' ? (
                    <AcquireProgress toolCall={toolCall} />
                  ) : isToolkitTool(toolCall.name) ? (
                    <ToolkitToolCard toolCall={toolCall}
                      answeredQuestionIds={answeredQuestionIds as Set<string> | undefined}
                      unresolvedQuestionIds={unresolvedQuestionIds as Set<string> | undefined} />
                  ) : isWebResearchTool(toolCall.name) ? (
                    <WebResearchToolCard toolCall={toolCall} />
                  ) : <ToolStep
                    key={step.id}
                    step={step}
                    isLast={idx === steps.length - 1}
                  />}
                  {toolCall.name.endsWith('_video_cover') && (
                    <CoverToolStatus toolCall={toolCall} />
                  )}
                  {(node.steers ?? [])
                    .filter(note => note.afterToolCallId === step.id)
                    .map(note => <SteerNoteNode key={note.id} note={note} />)}
                  </React.Fragment>
                  );
                })}
              </div>

              {/* Cancel button — shown during active execution */}
              {node.isActive && onCancel && (
                <motion.div
                  className="mt-2 flex justify-center"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: 0.05 }}
                >
                  <button
                    type="button"
                    onClick={onCancel}
                    className="text-xs text-muted-foreground dark:text-zinc-400 hover:text-red-500 dark:hover:text-red-400 transition-colors px-4 py-1.5 rounded-md border border-border dark:border-zinc-600 hover:border-red-300 dark:hover:border-red-700 hover:bg-red-50 dark:hover:bg-red-900/15"
                  >
                    {t.agentTimeline.stop}
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed summary */}
        {!isExpanded && node.toolCalls.filter(call =>
          call.name.endsWith('_video_cover')).map(call => (
          <CoverToolStatus key={call.id} toolCall={call} />
        ))}
        {!isExpanded && !node.isActive && (
          <button
            type="button"
            onClick={toggleExpand}
            className="text-xs text-muted-foreground dark:text-zinc-500 hover:text-foreground dark:hover:text-zinc-300 transition-colors"
          >
            {(hasErrors ? t.agentTimeline.collapsedSummaryErrors : t.agentTimeline.collapsedSummary)
              .replace('{count}', String(totalCount))}
          </button>
        )}

        {/* Cancel notice — shown after cancellation */}
        {!node.isActive && steps.some((s) => s.status === 'executing') && (
          <div className="mt-1 text-xs text-muted-foreground dark:text-zinc-500 italic">
            {t.agentTimeline.cancelledNotice}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default AgentExecutionNode;
