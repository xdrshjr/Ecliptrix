/**
 * TimelineConnector — the vertical connecting line between timeline nodes.
 *
 * Rendered between each pair of adjacent nodes. Supports three visual states:
 * - default: neutral gray solid line
 * - active:  gradient flow animation (primary colored, 2s infinite)
 * - undone:  dashed gray line indicating reverted operations
 *
 * The active state uses a CSS background gradient + flow keyframe so the
 * animation runs entirely on the compositor thread (no JS ticks needed).
 *
 * @module timeline/TimelineConnector
 */

'use client';

import React from 'react';
import type { ConnectorState } from './types';
import { CSS_ANIMATIONS } from './animations';

interface TimelineConnectorProps {
  state?: ConnectorState;
  /** Height in pixels. Defaults to 24. */
  height?: number;
}

const TimelineConnector: React.FC<TimelineConnectorProps> = ({
  state = 'default',
  height = 24,
}) => {
  // Active state uses a gradient flow instead of a simple border
  if (state === 'active') {
    return (
      <div
        className="flex justify-start pl-[15px]"
        style={{ height }}
        aria-hidden="true"
      >
        <div
          className={`w-0.5 h-full rounded-full ${CSS_ANIMATIONS.flow}`}
          style={{
            background: 'linear-gradient(180deg, var(--primary) 0%, hsl(var(--primary) / 0.4) 50%, transparent 100%)',
            backgroundSize: '100% 200%',
          }}
        />
      </div>
    );
  }

  // Default and undone states use simple border-left
  const stateClasses: Record<string, string> = {
    default: 'border-border dark:border-zinc-600',
    undone: 'border-muted-foreground/40 dark:border-zinc-500/40 border-dashed',
  };

  const lineClass = stateClasses[state] ?? stateClasses.default;

  return (
    <div
      className="flex justify-start pl-[15px]"
      style={{ height }}
      aria-hidden="true"
    >
      <div
        className={`border-l-2 h-full ${lineClass} transition-colors duration-200`}
      />
    </div>
  );
};

export default TimelineConnector;
