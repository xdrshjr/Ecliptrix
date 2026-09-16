/**
 * Shared animation configuration for the Timeline Chat UI.
 *
 * Centralizes all framer-motion variants, CSS keyframe names, and timing
 * constants so every component in the timeline directory uses a single
 * source of truth for durations, easings, and spring configs.
 *
 * ## Design decisions
 * - CSS @keyframes used for continuous/looping animations (spin, pulse, flow)
 *   because they run on the compositor thread and don't require JS ticks.
 * - framer-motion variants used for state transitions (enter, exit, expand,
 *   collapse) because they integrate with AnimatePresence and React state.
 * - All animated properties are `transform` and `opacity` only (GPU-composited)
 *   to guarantee 60 fps.
 *
 * @module timeline/animations
 */

import type { Variants } from 'framer-motion';

// ---------------------------------------------------------------------------
// Timing constants (ms)
// ---------------------------------------------------------------------------

export const TIMING = {
  /** Node entrance/exit animation duration. */
  NODE_ENTER: 0.2,
  /** Expand/collapse height transition. */
  EXPAND: 0.2,
  /** Content fade-in inside expanded regions. */
  CONTENT_FADE: 0.15,
  /** Delay before content fade-in starts after expand begins. */
  CONTENT_FADE_DELAY: 0.05,
  /** Chevron arrow rotation duration. */
  ARROW_ROTATE: 0.2,
  /** Status icon scale-in. */
  ICON_SCALE_IN: 0.2,
  /** Background flash (green/red). */
  BG_FLASH: 0.3,
  /** Shake animation total duration. */
  SHAKE: 0.3,
  /** Undo transition duration. */
  UNDO: 0.2,
  /** Streaming cursor blink cycle. */
  CURSOR_BLINK: 0.8,
  /** Cursor fade-out when streaming ends. */
  CURSOR_FADE_OUT: 0.2,
  /** Error slide-in. */
  ERROR_SLIDE_IN: 0.2,
  /** Dropdown menu appear/disappear. */
  DROPDOWN: 0.15,
  /** Elapsed timer update interval (ms, not seconds). */
  ELAPSED_TIMER_INTERVAL_MS: 100,
} as const;

// ---------------------------------------------------------------------------
// Easing presets
// ---------------------------------------------------------------------------

export const EASING = {
  easeOut: [0.0, 0.0, 0.2, 1] as [number, number, number, number],
  easeInOut: [0.4, 0.0, 0.2, 1] as [number, number, number, number],
  spring: { type: 'spring' as const, stiffness: 500, damping: 25 },
} as const;

// ---------------------------------------------------------------------------
// framer-motion variants
// ---------------------------------------------------------------------------

/**
 * Node entrance variant — used inside AnimatePresence for the timeline node list.
 * initial → animate → exit
 */
export const nodeVariants: Variants = {
  initial: {
    opacity: 0,
    y: 10,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: TIMING.NODE_ENTER,
      ease: EASING.easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: {
      duration: TIMING.NODE_ENTER,
      ease: EASING.easeOut,
    },
  },
};

/** Variant for undone nodes — reduces opacity to 0.5 with gray background feel. */
export const undoneNodeVariants: Variants = {
  initial: {
    opacity: 0,
    y: 10,
  },
  animate: {
    opacity: 0.5,
    y: 0,
    transition: {
      duration: TIMING.UNDO,
      ease: EASING.easeOut,
    },
  },
  exit: {
    opacity: 0,
    y: -10,
    transition: {
      duration: TIMING.NODE_ENTER,
      ease: EASING.easeOut,
    },
  },
};

/**
 * Expand/collapse variant — wraps collapsible content sections.
 * Used for ToolStep details and AgentExecutionNode step lists.
 */
export const expandVariants: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: TIMING.EXPAND, ease: EASING.easeInOut },
      opacity: { duration: TIMING.CONTENT_FADE, ease: EASING.easeOut },
    },
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      height: { duration: TIMING.EXPAND, ease: EASING.easeInOut },
      opacity: {
        duration: TIMING.CONTENT_FADE,
        delay: TIMING.CONTENT_FADE_DELAY,
        ease: EASING.easeOut,
      },
    },
  },
};

/**
 * Status icon scale-in with spring — used for completed checkmark, error X.
 */
export const iconScaleInVariants: Variants = {
  initial: {
    scale: 0,
    opacity: 0,
  },
  animate: {
    scale: 1,
    opacity: 1,
    transition: EASING.spring,
  },
};

/**
 * Error message slide-in variant.
 */
export const errorSlideInVariants: Variants = {
  initial: {
    y: -5,
    opacity: 0,
  },
  animate: {
    y: 0,
    opacity: 1,
    transition: {
      duration: TIMING.ERROR_SLIDE_IN,
      ease: EASING.easeOut,
    },
  },
};

/**
 * Dropdown menu variants.
 */
export const dropdownVariants: Variants = {
  initial: {
    opacity: 0,
    y: -4,
    scale: 0.95,
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: TIMING.DROPDOWN,
    },
  },
  exit: {
    opacity: 0,
    y: -4,
    scale: 0.95,
    transition: {
      duration: TIMING.DROPDOWN,
    },
  },
};

// ---------------------------------------------------------------------------
// CSS keyframe class names (defined in timeline-animations.css injected below)
// ---------------------------------------------------------------------------

/**
 * CSS class names for continuous animations. These reference @keyframes defined
 * in the <style> tag injected by TimelineAnimationStyles component.
 *
 * Usage: apply these Tailwind-compatible class names directly.
 */
export const CSS_ANIMATIONS = {
  /** Continuous 360° rotation, 1s linear infinite. */
  spin: 'timeline-anim-spin',
  /** Scale pulse 1→1.2→1, 1.5s ease-in-out infinite. */
  pulse: 'timeline-anim-pulse',
  /** Gradient flow on connector lines, 2s ease-in-out infinite. */
  flow: 'timeline-anim-flow',
  /** Horizontal shake (single-shot, 300ms). */
  shake: 'timeline-anim-shake',
  /** Background pulse for executing state. */
  bgPulse: 'timeline-anim-bg-pulse',
  /** Cursor blink for streaming text. */
  cursorBlink: 'timeline-anim-cursor-blink',
  /** Green flash for completed transition. */
  flashGreen: 'timeline-anim-flash-green',
  /** Red flash for error transition. */
  flashRed: 'timeline-anim-flash-red',
} as const;

// ---------------------------------------------------------------------------
// CSS keyframes stylesheet (injected once at module scope)
// ---------------------------------------------------------------------------

/**
 * Raw CSS string containing all @keyframes and utility classes needed by
 * timeline animations. Injected into the DOM by TimelineAnimationStyles.
 */
export const TIMELINE_ANIMATION_CSS = `
/* === Timeline Animation Keyframes === */

@keyframes timeline-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@keyframes timeline-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.2); }
}

@keyframes timeline-flow {
  0% { background-position: 0% 0%; }
  100% { background-position: 0% 200%; }
}

@keyframes timeline-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-3px); }
  30% { transform: translateX(3px); }
  50% { transform: translateX(-2px); }
  70% { transform: translateX(2px); }
}

@keyframes timeline-bg-pulse {
  0%, 100% { opacity: 0.05; }
  50% { opacity: 0.1; }
}

@keyframes timeline-cursor-blink {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}

@keyframes timeline-flash-green {
  0% { background-color: transparent; }
  30% { background-color: var(--flash-color-peak); }
  100% { background-color: transparent; }
}

@keyframes timeline-flash-red {
  0% { background-color: transparent; }
  30% { background-color: var(--flash-color-peak); }
  100% { background-color: var(--flash-color-rest); }
}

/* Light mode (default) flash variables */
.timeline-anim-flash-green {
  --flash-color-peak: rgba(34, 197, 94, 0.1);
}
.timeline-anim-flash-red {
  --flash-color-peak: rgba(239, 68, 68, 0.15);
  --flash-color-rest: rgba(239, 68, 68, 0.05);
}

/* Dark mode flash variants */
.dark .timeline-anim-flash-green {
  --flash-color-peak: rgba(34, 197, 94, 0.15);
}
.dark .timeline-anim-flash-red {
  --flash-color-peak: rgba(239, 68, 68, 0.2);
  --flash-color-rest: rgba(239, 68, 68, 0.08);
}

/* === Utility animation classes === */

.timeline-anim-spin {
  animation: timeline-spin 1s linear infinite;
}

.timeline-anim-pulse {
  animation: timeline-pulse 1.5s ease-in-out infinite;
}

.timeline-anim-flow {
  background-size: 100% 200%;
  animation: timeline-flow 2s ease-in-out infinite;
}

.timeline-anim-shake {
  animation: timeline-shake 0.3s ease-in-out;
}

.timeline-anim-bg-pulse {
  animation: timeline-bg-pulse 1.5s ease-in-out infinite;
}

.timeline-anim-cursor-blink {
  animation: timeline-cursor-blink 0.8s ease-in-out infinite;
}

.timeline-anim-flash-green {
  animation: timeline-flash-green 0.3s ease-out forwards;
}

.timeline-anim-flash-red {
  animation: timeline-flash-red 0.3s ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
  [class*="timeline-anim-"],
  .timeline-chat-panel .animate-ping,
  .timeline-chat-panel .animate-pulse,
  .timeline-chat-panel .animate-spin {
    animation: none !important;
    transition: none !important;
  }
}
`;
