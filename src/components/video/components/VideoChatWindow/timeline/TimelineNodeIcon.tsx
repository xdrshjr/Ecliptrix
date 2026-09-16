/**
 * TimelineNodeIcon — renders the circular icon on the left edge of a timeline node.
 *
 * Each node kind has a distinct visual treatment with enhanced animations:
 * - user:             solid circle (neutral) — static
 * - thinking:         half-circle with CSS spin animation (1s linear infinite)
 * - execution-active: concentric circles with CSS pulse animation (scale 1→1.2→1)
 * - execution-done:   green checkmark with spring scale-in
 * - execution-error:  red X with spring scale-in + shake
 * - response:         solid circle (primary) — static
 * - undone:           gray circle, fades to 0.5 opacity over 200ms
 *
 * @module timeline/TimelineNodeIcon
 */

'use client';

import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CSS_ANIMATIONS, EASING, TIMING } from './animations';

export type NodeIconVariant =
  | 'user'
  | 'thinking'
  | 'thinking-idle'
  | 'execution-active'
  | 'execution-done'
  | 'execution-error'
  | 'response'
  | 'undone';

interface TimelineNodeIconProps {
  variant: NodeIconVariant;
}

/** Container shared by all variants — 32x32 centered flex. */
const IconContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div aria-hidden="true" className="flex-shrink-0 relative w-[32px] h-[32px] flex items-center justify-center">
    {children}
  </div>
);

// 变体 switch 超过 60 行，保留统一图标布局以避免各状态尺寸漂移。
const TimelineNodeIcon: React.FC<TimelineNodeIconProps> = ({ variant }) => {
  const reducedMotion = useReducedMotion();
  switch (variant) {
    // -----------------------------------------------------------------------
    // User — static neutral circle
    // -----------------------------------------------------------------------
    case 'user':
      return (
        <IconContainer>
          <div className="w-3 h-3 rounded-full bg-muted-foreground dark:bg-zinc-400" />
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Thinking — spinning half-circle (CSS animation for 60fps)
    // -----------------------------------------------------------------------
    case 'thinking':
      return (
        <IconContainer>
          <div
            className={`w-4 h-4 rounded-full border-2 border-primary border-t-transparent ${CSS_ANIMATIONS.spin}`}
          />
        </IconContainer>
      );

    case 'thinking-idle':
      return (
        <IconContainer>
          <svg className="w-4 h-4 text-primary" fill="none"
            stroke="currentColor" viewBox="0 0 24 24">
            <path strokeWidth={1.8} strokeLinecap="round"
              d="M9 18h6m-5 3h4M8.5 14.5a6 6 0 117 0L15 17H9z" />
          </svg>
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Execution active — pulsing concentric circles (CSS animation)
    // -----------------------------------------------------------------------
    case 'execution-active':
      return (
        <IconContainer>
          {/* Outer ring — ping effect */}
          <div className="absolute w-5 h-5 rounded-full border-2 border-primary/50 dark:border-primary/40 animate-ping" />
          {/* Inner dot — CSS pulse scale */}
          <div className={`w-3 h-3 rounded-full bg-primary ${CSS_ANIMATIONS.pulse}`} />
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Execution done — green checkmark with spring scale-in
    // -----------------------------------------------------------------------
    case 'execution-done':
      return (
        <IconContainer>
          <AnimatePresence mode="wait">
            <motion.div
              key="done-check"
              className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : EASING.spring}
            >
              <svg
                className="w-3 h-3 text-green-600 dark:text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </motion.div>
          </AnimatePresence>
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Execution error — red X with spring scale-in + shake
    // -----------------------------------------------------------------------
    case 'execution-error':
      return (
        <IconContainer>
          <AnimatePresence mode="wait">
            <motion.div
              key="error-x"
              className={`w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center ${CSS_ANIMATIONS.shake}`}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0 } : EASING.spring}
            >
              <svg
                className="w-3 h-3 text-red-600 dark:text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </motion.div>
          </AnimatePresence>
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Response — static primary circle
    // -----------------------------------------------------------------------
    case 'response':
      return (
        <IconContainer>
          <div className="w-3 h-3 rounded-full bg-primary" />
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Undone — gray circle with fade animation
    // -----------------------------------------------------------------------
    case 'undone':
      return (
        <IconContainer>
          <motion.div
            className="w-3 h-3 rounded-full bg-muted-foreground/40 dark:bg-zinc-500/40"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0.5 }}
            transition={{ duration: reducedMotion ? 0 : TIMING.UNDO }}
          />
        </IconContainer>
      );

    // -----------------------------------------------------------------------
    // Default fallback
    // -----------------------------------------------------------------------
    default:
      return (
        <IconContainer>
          <div className="w-3 h-3 rounded-full bg-border" />
        </IconContainer>
      );
  }
};

export default TimelineNodeIcon;
