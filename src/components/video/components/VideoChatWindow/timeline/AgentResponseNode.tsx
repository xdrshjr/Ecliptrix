/**
 * AgentResponseNode — renders the agent's final text response on the timeline.
 *
 * Features:
 * - Solid primary circle icon (or undone gray icon with fade)
 * - Markdown-rendered content with streaming cursor (skipped for a turn that
 *   only called tools, which still needs its undo buttons)
 * - Undo buttons: "Undo all" + a keyboard-operable ARIA menu of the steps
 *   that changed the timeline, numbered within the turn
 * - Undo animation: gray background + strikethrough + opacity 0.5
 * - Dropdown uses shared dropdownVariants for enter/exit
 *
 * @module timeline/AgentResponseNode
 */

'use client';

import React, { useState, useCallback, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { useLocale } from '@/contexts/LocaleContext';
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
  /**
   * Disables the undo buttons while the agent runs: the server keeps editing
   * its own copy, so a local revert would fork the timeline.
   */
  undoDisabled?: boolean;
  /**
   * False when this session holds no step records for the turn (a turn from
   * before a reload): only the whole-turn undo is offered.
   */
  canUndoSteps?: boolean;
}

interface UndoStepEntry {
  id: string;
  label: string;
  /** Which clip / material the step touched, for telling steps apart. */
  target?: string;
}

const UNDO_BUTTON_CLASS =
  'flex items-center gap-1 text-xs text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-zinc-200 transition-colors px-2 py-1 rounded-md hover:bg-accent dark:hover:bg-zinc-700 border border-transparent hover:border-border dark:hover:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground disabled:hover:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const MENU_ITEM_CLASS =
  'w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground dark:text-zinc-200 hover:bg-accent dark:hover:bg-zinc-700 focus:bg-accent dark:focus:bg-zinc-700 focus:outline-none transition-colors text-left';

const TARGET_PARAM_KEYS = ['clipId', 'materialId'] as const;

function describeStepTarget(params: Record<string, unknown>): string | undefined {
  const parts = TARGET_PARAM_KEYS.flatMap((key) =>
    typeof params[key] === 'string' ? [`${key}: ${params[key] as string}`] : [],
  );
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/** Next menu item to focus for a navigation key, or null for other keys. */
function menuFocusTarget(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

const UndoIcon: React.FC<{ className: string }> = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
  </svg>
);

const AgentResponseNode: React.FC<AgentResponseNodeProps> = ({
  node,
  onUndoAll,
  onUndoSingle,
  isStreaming: isStreamingProp = false,
  undoDisabled = false,
  canUndoSteps = true,
}) => {
  const { t } = useLocale();
  const isStreaming = node.isStreaming ?? isStreamingProp;
  const [showUndoMenu, setShowUndoMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const undoAllRef = useRef<HTMLButtonElement>(null);
  const focusAfterUndoRef = useRef(false);
  const isUndoMenuOpen = showUndoMenu && !undoDisabled;

  const closeMenu = useCallback((restoreFocus: boolean) => {
    setShowUndoMenu(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isUndoMenuOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowUndoMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isUndoMenuOpen]);

  // An opened menu takes focus on its first item (ARIA menu pattern)
  useEffect(() => {
    if (isUndoMenuOpen) itemRefs.current[0]?.focus();
  }, [isUndoMenuOpen]);

  const handleUndoAll = useCallback(() => {
    setShowUndoMenu(false);
    if (undoDisabled) return;
    onUndoAll?.(node.messageId);
  }, [onUndoAll, node.messageId, undoDisabled]);

  const handleUndoSingle = useCallback(
    (toolCallId: string) => {
      closeMenu(true);
      if (undoDisabled) return;
      focusAfterUndoRef.current = true;
      onUndoSingle?.(node.messageId, toolCallId);
    },
    [onUndoSingle, node.messageId, undoDisabled, closeMenu],
  );

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        return;
      }
      if (e.key === 'Tab') {
        closeMenu(false);
        return;
      }
      const items = itemRefs.current.filter((el): el is HTMLButtonElement => el !== null);
      const current = items.findIndex((el) => el === document.activeElement);
      const next = menuFocusTarget(e.key, current, items.length);
      if (next === null) return;
      e.preventDefault();
      items[next].focus();
    },
    [closeMenu],
  );

  const iconVariant = node.isUndone ? 'undone' : 'response';
  const activeVariants = node.isUndone ? undoneNodeVariants : nodeVariants;

  // Only completed steps the client actually applied to the timeline can be
  // undone one by one; numbering follows the turn's step order.
  const undoSteps: UndoStepEntry[] = node.toolCalls.flatMap((tc, index) =>
    tc.status === 'completed' && tc.changedTimeline === true
      ? [{
        id: tc.id,
        label: t.agentTimeline.undoStepItem
          .replace('{index}', String(index + 1))
          .replace('{tool}', getToolDisplayName(tc.name, t.agentTimeline.toolNames)),
        target: describeStepTarget(tc.params),
      }]
      : [],
  );
  const showStepMenu = canUndoSteps && undoSteps.length > 1;
  const blockedTitle = undoDisabled ? t.agentUndo.blockedWhileRunning : undefined;
  itemRefs.current.length = undoSteps.length;

  // Undoing a step can leave a single one: the menu button then unmounts and
  // focus would drop to <body>, so it moves to "Undo all" instead.
  useEffect(() => {
    if (showStepMenu || !focusAfterUndoRef.current) return;
    focusAfterUndoRef.current = false;
    if (document.activeElement === document.body) undoAllRef.current?.focus();
  }, [showStepMenu]);

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
            {t.agentTimeline.responseAuthor}
          </span>
          {node.isUndone && (
            <span className="text-xs text-muted-foreground dark:text-zinc-500 italic">
              {t.agentTimeline.undoneTag}
            </span>
          )}
        </div>

        {/* Markdown content + streaming cursor */}
        {(node.content || isStreaming) && (
          <div className={`text-sm leading-relaxed ${node.isUndone ? 'line-through decoration-muted-foreground/50' : ''}`}>
            <MarkdownRenderer content={node.content} isUser={false} isStreaming={isStreaming} />
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
        )}

        {/* Undo buttons area */}
        {node.canUndo && !node.isUndone && (
          <div className="mt-2 flex items-center gap-2 relative" ref={menuRef}>
            <button
              ref={undoAllRef}
              type="button"
              onClick={handleUndoAll}
              disabled={undoDisabled}
              className={UNDO_BUTTON_CLASS}
              title={blockedTitle ?? t.agentTimeline.undoAllTitle}
            >
              <UndoIcon className="w-3 h-3" />
              {t.agentTimeline.undoAll}
            </button>

            {showStepMenu && (
              <>
                <button
                  ref={triggerRef}
                  type="button"
                  onClick={() => setShowUndoMenu((v) => !v)}
                  disabled={undoDisabled}
                  className={UNDO_BUTTON_CLASS}
                  title={blockedTitle}
                  aria-haspopup="menu"
                  aria-expanded={isUndoMenuOpen}
                  aria-controls={isUndoMenuOpen ? menuId : undefined}
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  {t.agentTimeline.undoStep}
                </button>

                <AnimatePresence>
                  {isUndoMenuOpen && (
                    <motion.div
                      id={menuId}
                      role="menu"
                      aria-label={t.agentTimeline.undoStep}
                      onKeyDown={handleMenuKeyDown}
                      variants={dropdownVariants}
                      initial="initial"
                      animate="animate"
                      exit="exit"
                      className="absolute top-full left-0 mt-1 z-20 min-w-[180px] bg-card dark:bg-zinc-800 border border-border dark:border-zinc-700 rounded-md shadow-lg overflow-hidden"
                    >
                      {undoSteps.map((step, index) => (
                        <button
                          key={step.id}
                          ref={(el) => {
                            itemRefs.current[index] = el;
                          }}
                          type="button"
                          role="menuitem"
                          tabIndex={-1}
                          title={step.target}
                          onClick={() => handleUndoSingle(step.id)}
                          className={MENU_ITEM_CLASS}
                        >
                          <UndoIcon className="w-3 h-3 text-muted-foreground dark:text-zinc-400 flex-shrink-0" />
                          {step.label}
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
              {t.agentTimeline.undoneNotice}
            </span>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

export default AgentResponseNode;
