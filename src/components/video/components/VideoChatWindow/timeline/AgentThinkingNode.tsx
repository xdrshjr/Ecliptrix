/**
 * AgentThinkingNode — renders the "AI is analyzing..." phase on the timeline.
 *
 * Appears when the agent is streaming text but has not yet started any tool calls.
 * Shows a spinning half-circle icon with the partial text content and a blinking
 * cursor `|` that fades out when streaming ends.
 *
 * Animations:
 * - Icon: CSS spin (1s linear infinite) via TimelineNodeIcon "thinking"
 * - Cursor: CSS cursor-blink animation (opacity 0→1→0, 800ms) while streaming
 * - Cursor fade-out: 200ms opacity transition when isStreaming becomes false
 *
 * @module timeline/AgentThinkingNode
 */

'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AgentThinkingNodeData } from './types';
import { formatTimestamp } from './utils';
import TimelineNodeIcon from './TimelineNodeIcon';
import { nodeVariants, TIMING, CSS_ANIMATIONS } from './animations';

interface AgentThinkingNodeProps {
  node: AgentThinkingNodeData;
}

const AgentThinkingNode: React.FC<AgentThinkingNodeProps> = ({ node }) => {
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
      <TimelineNodeIcon variant="thinking" />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground dark:text-zinc-500 tabular-nums">
            {formatTimestamp(node.timestamp)}
          </span>
          <span className="text-xs font-medium text-primary dark:text-primary/90">
            AI Analyzing...
          </span>
        </div>

        {/* Streaming text + blinking cursor */}
        <div className="text-sm text-foreground/80 dark:text-zinc-300 leading-relaxed">
          {node.content}
          <AnimatePresence>
            {node.isStreaming && (
              <motion.span
                key="cursor"
                className={`inline-block ml-0.5 align-text-bottom font-light text-primary/70 dark:text-primary/60 select-none ${CSS_ANIMATIONS.cursorBlink}`}
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: TIMING.CURSOR_FADE_OUT } }}
              >
                |
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
};

export default AgentThinkingNode;
