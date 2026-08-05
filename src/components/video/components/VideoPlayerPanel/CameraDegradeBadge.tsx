'use client';

/**
 * CameraDegradeBadge — "that 3D frame was drawn as 2D" (camera-motion-stills
 * §4.3.5 / G5).
 *
 * The panel already has a badge for "this machine has no WebGL", answered by a
 * STATIC probe while the user picks a preset. This one answers a different
 * question, at a different moment: the frame that just went past really did
 * degrade — including the run-time projection degrades (a corner swinging behind
 * the camera, a context that dies after creation) that a static probe cannot
 * see, on machines that have perfectly good WebGL.
 *
 * The half-sentence that matters is "export is still full 3D": without it a user
 * redesigns a motion that would have exported perfectly. That is also why this
 * is a quiet pill and not a toast — a degrade is information, not an error, and
 * it must never interrupt playback (D29 / R23).
 */

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  cameraMotionPanelClosedSnapshot,
  isCameraMotionPanelOpen,
  subscribeCameraMotionPanel,
} from '../CameraMotionModal/panelPresence';

export interface CameraDegradeBadgeProps {
  /** The compositor reported a degrade (one-shot signal, D20). */
  degraded: boolean;
  className?: string;
}

const CameraDegradeBadge: React.FC<CameraDegradeBadgeProps> = ({
  degraded,
  className,
}) => {
  const { t } = useLocale();
  const labels = t.timeline.cameraMotion;
  const [dismissed, setDismissed] = useState(false);
  // Same-screen dedup (D29): the panel's own badge already speaks for it.
  const suppressed = useSyncExternalStore(
    subscribeCameraMotionPanel,
    isCameraMotionPanelOpen,
    cameraMotionPanelClosedSnapshot,
  );

  // Dismissal lasts for this mount only — deliberately not persisted. A degrade
  // on the next session is news again.
  useEffect(() => {
    if (!degraded) setDismissed(false);
  }, [degraded]);

  if (!degraded || dismissed || suppressed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        className ??
        `absolute right-2 top-2 z-10 flex max-w-[min(92%,22rem)] items-center gap-1.5
         rounded-full border border-border/70 bg-background/90 px-2.5 py-1
         text-[10px] leading-tight text-muted-foreground shadow-sm backdrop-blur-sm`
      }
    >
      <svg className="h-3 w-3 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2 1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v5h2v-5z" />
      </svg>
      <span className="min-w-0">{labels.degradedBadge}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={labels.degradedBadgeDismiss}
        title={labels.degradedBadgeDismiss}
        className="ml-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors
          hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2
          focus-visible:ring-ring"
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
        </svg>
      </button>
    </div>
  );
};

export default CameraDegradeBadge;
