/**
 * AgentResponseNode — renders the agent's final text response on the timeline.
 *
 * Features:
 * - Solid primary circle icon (or undone gray icon with fade)
 * - Markdown-rendered content with streaming cursor
 * - Undo buttons: "Undo All" + per-tool-call undo dropdown
 * - Undo animation: gray background + strikethrough + opacity 0.5
 * - Dropdown uses shared dropdownVariants for enter/exit
 *
 * @module timeline/AgentResponseNode
 */

'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import type { AgentResponseNodeData } from './types';
import { formatTimestamp, getToolDisplayName } from './utils';
import TimelineNodeIcon from './TimelineNodeIcon';
import {
  nodeVariants,
  undoneNodeVariants,
  dropdownVariants,
  CSS_ANIMATIONS,
  TIMING,
} from './animations';

interface AgentResponseNodeProps {
  node: AgentResponseNodeData;
  onUndoAll?: (messageId: string) => void;
  onUndoSingle?: (messageId: string, toolCallId: string) => void;
  /** Whether this response is still streaming (shows blinking cursor). */
  isStreaming?: boolean;
}

const AgentResponseNode: React.FC<AgentResponseNodeProps> = ({
  node,
  onUndoAll,
  onUndoSingle,
  isStreaming = false,
}) => {
  const [showUndoMenu, setShowUndoMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showUndoMenu) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUndoMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showUndoMenu]);

  const handleUndoAll = useCallback(() => {
    onUndoAll?.(node.messageId);
    setShowUndoMenu(false);
  }, [onUndoAll, node.messageId]);

  const handleUndoSingle = useCallback(
    (toolCallId: string) => {
      onUndoSingle?.(node.messageId, toolCallId);
      setShowUndoMenu(false);
    },
    [onUndoSingle, node.messageId],
  );

  const iconVariant = node.isUndone ? 'undone' : 'response';
  const activeVariants = node.isUndone ? undoneNodeVariants : nodeVariants;

  // Only show tool calls that had a result (completed tools, not just status queries)
  const undoableToolCalls = node.toolCalls.filter(
    (tc) => tc.status === 'completed' && tc.name !== 'get_timeline' && tc.name !== 'search_materials'
  );
  const hasUndoableTools = undoableToolCalls.length > 0;

  return (
    <motion.div
      className={`flex items-start gap-0 ${node.isUndone ? 'bg-muted/20 dark:bg-zinc-800/20 rounded-lg' : ''}`}
      variants={activeVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      layout="position"
    >
      {/* Icon column */}
      <TimelineNodeIcon variant={iconVariant} />

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground dark:text-zinc-500 tabular-nums">
            {formatTimestamp(node.timestamp)}
          </span>
          <span className="text-xs font-medium text-primary dark:text-primary/90">
            AI
          </span>
          {node.isUndone && (
            <span className="text-xs text-muted-foreground dark:text-zinc-500 italic">
              (undone)
            </span>
          )}
        </div>

        {/* Markdown content + streaming cursor */}
        <div className={`text-sm leading-relaxed ${node.isUndone ? 'line-through decoration-muted-foreground/50' : ''}`}>
          <MarkdownRenderer content={node.content} isUser={false} />
          <AnimatePresence>
            {isStreaming && (
              <motion.span
                key="response-cursor"
                className={`inline-block ml-0.5 align-text-bottom font-light text-primary/70 dark:text-primary/60 select-none ${CSS_ANIMATIONS.cursorBlink}`}
                initial={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: TIMING.CURSOR_FADE_OUT } }}
              >
                |
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        {/* Undo buttons area */}
        {node.canUndo && !node.isUndone && (
          <div className="mt-2 flex items-center gap-2 relative" ref={menuRef}>
            {/* Undo All button */}
            <button
              type="button"
              onClick={handleUndoAll}
              className="flex items-center gap-1 text-xs text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-zinc-200 transition-colors px-2 py-1 rounded-md hover:bg-accent dark:hover:bg-zinc-700 border border-transparent hover:border-border dark:hover:border-zinc-600"
              title="Undo all operations in this response"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Undo All
            </button>

            {/* Per-tool undo dropdown trigger */}
            {hasUndoableTools && undoableToolCalls.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowUndoMenu((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-zinc-200 transition-colors px-2 py-1 rounded-md hover:bg-accent dark:hover:bg-zinc-700 border border-transparent hover:border-border dark:hover:border-zinc-600"
                  aria-expanded={showUndoMenu}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  Undo Single
                </button>

                {/* Dropdown menu — enhanced with shared dropdownVariants */}
                <AnimatePresence>
                  {showUndoMenu && (
                    <motion.div
                      variants={dropdownVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute top-full left-0 mt-1 z-20 min-w-[180px] bg-card dark:bg-zinc-800 border border-border dark:border-zinc-700 rounded-md shadow-lg overflow-hidden"
                    >
                      {undoableToolCalls.map((tc) => (
                        <button
                          key={tc.id}
                          type="button"
                          onClick={() => handleUndoSingle(tc.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground dark:text-zinc-200 hover:bg-accent dark:hover:bg-zinc-700 transition-colors text-left"
                        >
                          <svg className="w-3 h-3 text-muted-foreground dark:text-zinc-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                          </svg>
                          Undo {getToolDisplayName(tc.name)}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            )}
          </div>
        )}

        {/* Undone indicator */}
        {node.isUndone && (
          <motion.div
            className="mt-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: TIMING.UNDO }}
          >
            <span className="text-xs text-muted-foreground dark:text-zinc-500 italic">
              Operations undone
            </span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default AgentResponseNode;
