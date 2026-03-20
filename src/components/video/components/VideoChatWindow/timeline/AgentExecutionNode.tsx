/**
 * AgentExecutionNode — renders the tool-execution phase on the timeline.
 *
 * Shows a concentric-circle icon (with pulse animation when active),
 * an "Executing (M/N)" header, and a collapsible list of ToolStep items.
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
import type { AgentExecutionNodeData } from './types';
import { formatTimestamp, toolCallToStepData } from './utils';
import TimelineNodeIcon from './TimelineNodeIcon';
import type { NodeIconVariant } from './TimelineNodeIcon';
import ToolStep from './ToolStep';
import { nodeVariants, expandVariants, TIMING } from './animations';

interface AgentExecutionNodeProps {
  node: AgentExecutionNodeData;
  /** Cancel callback — shown as a button when node is active. */
  onCancel?: () => void;
}

const AgentExecutionNode: React.FC<AgentExecutionNodeProps> = ({ node, onCancel }) => {
  // Auto-expand while active, collapse when done (user can toggle)
  const [isExpanded, setIsExpanded] = useState(node.isActive);

  // Re-expand when execution starts, collapse when it finishes
  useEffect(() => {
    if (node.isActive) {
      setIsExpanded(true);
    }
  }, [node.isActive]);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const steps = node.toolCalls.map(toolCallToStepData);
  const completedCount = steps.filter(
    (s) => s.status === 'completed' || s.status === 'error' || s.status === 'undone'
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
            {node.isActive ? 'Executing' : 'Executed'}
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
                {steps.map((step, idx) => (
                  <ToolStep
                    key={step.id}
                    step={step}
                    isLast={idx === steps.length - 1}
                  />
                ))}
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
                    Cancel Execution
                  </button>
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed summary */}
        {!isExpanded && !node.isActive && (
          <button
            type="button"
            onClick={toggleExpand}
            className="text-xs text-muted-foreground dark:text-zinc-500 hover:text-foreground dark:hover:text-zinc-300 transition-colors"
          >
            {totalCount} operation{totalCount !== 1 ? 's' : ''} completed
            {hasErrors ? ' (with errors)' : ''} — click to expand
          </button>
        )}

        {/* Cancel notice — shown after cancellation */}
        {!node.isActive && steps.some((s) => s.status === 'executing') && (
          <div className="mt-1 text-xs text-muted-foreground dark:text-zinc-500 italic">
            Execution cancelled. Completed operations have been preserved.
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default AgentExecutionNode;
