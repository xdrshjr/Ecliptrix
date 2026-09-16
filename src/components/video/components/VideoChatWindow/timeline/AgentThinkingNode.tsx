/**
 * AgentThinkingNode — renders the "AI is analyzing..." phase on the timeline.
 *
 * Two modes:
 * 1. isThinkingPhase: Shows the pre-execution thinking analysis with a
 *    collapsible panel and "thinking" label.
 * 2. Default: Shows streaming text content with spinning icon and blinking cursor.
 *
 * @module timeline/AgentThinkingNode
 */

'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from 'framer-motion';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentThinkingNodeData } from './types';
import { formatTimestamp } from './utils';
import TimelineNodeIcon from './TimelineNodeIcon';
import { nodeVariants, CSS_ANIMATIONS } from './animations';

interface AgentThinkingNodeProps {
  node: AgentThinkingNodeData;
}

// 两个展示分支保留原结构，避免改变历史思考的折叠状态。
const ThinkingContent: React.FC<AgentThinkingNodeProps> = ({ node }) => {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const reduced = useReducedMotion();

  if (node.isThinkingPhase) {
    return (
      <motion.div
        className="flex items-start gap-0"
        variants={reduced ? undefined : nodeVariants}
        initial={reduced ? false : 'initial'}
        animate="animate"
        exit={reduced ? undefined : 'exit'}
        layout={reduced ? false : 'position'}
      >
        <TimelineNodeIcon variant={node.isStreaming ? 'thinking' : 'thinking-idle'} />

        <div className="flex-1 min-w-0 pt-1">
          <div className="rounded-md border border-primary/20 dark:border-primary/15 bg-primary/5 dark:bg-primary/8 overflow-hidden">
            <button
              type="button"
              onClick={() => setCollapsed(c => !c)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-primary/8 dark:hover:bg-primary/12 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-primary flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              <span className="text-xs font-medium text-primary dark:text-primary/90 flex-1">
                {node.isStreaming ? t.agentTimeline.thinking : t.agentTimeline.thoughtProcess}
              </span>
              <svg
                className={`w-3 h-3 text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-180'}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  initial={reduced ? false : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: reduced ? 0 : 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-2 pt-1 text-xs text-foreground/70 dark:text-zinc-400 leading-relaxed border-t border-primary/10 dark:border-primary/8 whitespace-pre-wrap">
                    {node.content}
                    {node.isStreaming && (
                      <span className={`inline-block ml-0.5 align-text-bottom font-light text-primary/70 select-none ${CSS_ANIMATIONS.cursorBlink}`}>|</span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
            {formatTimestamp(node.timestamp)}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="flex items-start gap-0"
      variants={reduced ? undefined : nodeVariants}
      initial={reduced ? false : 'initial'}
      animate="animate"
      exit={reduced ? undefined : 'exit'}
      layout={reduced ? false : 'position'}
    >
      {/* Icon column */}
      <TimelineNodeIcon variant={node.isStreaming ? 'thinking' : 'thinking-idle'} />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground dark:text-zinc-500 tabular-nums">
            {formatTimestamp(node.timestamp)}
          </span>
          <span className="text-xs font-medium text-primary dark:text-primary/90">
            {node.isStreaming ? t.agentTimeline.analyzing : t.agentTimeline.thoughtProcess}
          </span>
        </div>

        {/* Streaming text + blinking cursor */}
        <div className="text-sm text-foreground/80 dark:text-zinc-300 leading-relaxed">
          {node.content}
            {node.isStreaming && (
              <span
                className={`inline-block ml-0.5 align-text-bottom font-light text-primary/70 dark:text-primary/60 select-none ${CSS_ANIMATIONS.cursorBlink}`}
              >
                |
              </span>
            )}
        </div>
      </div>
    </motion.div>
  );
};

const AgentThinkingNode: React.FC<AgentThinkingNodeProps> = props => (
  <MotionConfig reducedMotion="user">
    <ThinkingContent {...props} />
  </MotionConfig>
);

export default AgentThinkingNode;
