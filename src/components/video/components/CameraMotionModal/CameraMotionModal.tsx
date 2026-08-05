'use client';

/**
 * CameraMotionModal — the 2D / 3D 运镜 panel.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §6.2.
 *
 * Non-destructive by construction: the whole edit lives in local state and only
 * `Apply` reaches the store, so a session of slider-dragging collapses into ONE
 * undo step and `Esc` / `Cancel` restores the clip exactly. That is why the
 * component owns a `draft` instead of writing through on every change.
 *
 * Accessibility: focus is trapped for as long as the dialog is open, `Esc`
 * closes, focus returns to whatever opened it, and the preset grid is a proper
 * radiogroup (see `PresetGallery`).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  isMotionRenderable,
  motionFromPreset,
  CUSTOM_PRESET_ID,
  type CameraMotion,
} from '../../playback';
import PresetGallery, { presetLabel } from './PresetGallery';
import MotionInspector from './MotionInspector';
import MotionPreviewThumb from './MotionPreviewThumb';

/** Preset chosen when the panel opens on a clip that has no motion yet. */
const DEFAULT_PRESET_ID = 'zoom-in';

const LARGE_PREVIEW_WIDTH = 320;
const LARGE_PREVIEW_HEIGHT = 180;

/**
 * Canvas the renderability check is judged against.
 *
 * Only the ASPECT changes the verdict — the projection scales with the canvas —
 * so a nominal 16:9 frame stands in for the project canvas the panel does not
 * receive. Every shipped preset clears this by a wide margin; it exists for the
 * advanced sliders, where `intensity` can push a hand-typed dolly or yaw past
 * the pinhole and fold the picture inside out.
 */
const GUARD_CANVAS = { width: 1920, height: 1080 };

export interface CameraMotionModalProps {
  isOpen: boolean;
  /** Display name of the clip being edited. */
  clipName: string;
  /** Clip duration in seconds, for the header subtitle. */
  clipDuration: number;
  /** Clip poster used by every preview canvas. */
  thumbnailUrl?: string;
  /** The clip's current motion, or null when it has none. */
  motion: CameraMotion | null;
  /** Commit — one history entry. `null` clears the motion. */
  onApply: (motion: CameraMotion | null) => void;
  onClose: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function formatDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return minutes > 0
    ? `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
    : `${rest.toFixed(1)}s`;
}

const CameraMotionModal: React.FC<CameraMotionModalProps> = ({
  isOpen,
  clipName,
  clipDuration,
  thumbnailUrl,
  motion,
  onApply,
  onClose,
}) => {
  const { t } = useLocale();
  const copy = t.timeline.cameraMotion;
  const presetLabels = copy.presets as unknown as Record<string, string>;
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState<CameraMotion | null>(motion);

  // Re-seed the draft each time the dialog opens so a previous cancel never
  // leaks into the next clip's edit.
  useEffect(() => {
    if (!isOpen) return;
    setDraft(motion ?? motionFromPreset(DEFAULT_PRESET_ID));
    restoreFocusRef.current =
      typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  }, [isOpen, motion]);

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      // Wrap at both ends — without this, Tab escapes into the timeline behind
      // the dialog, which is exactly what `aria-modal` promises it will not do.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  const headerSubtitle = useMemo(
    () => copy.subtitle.replace('{name}', clipName).replace('{duration}', formatDuration(clipDuration)),
    [copy.subtitle, clipName, clipDuration],
  );

  // Block the commit rather than silently rewriting the numbers the user typed:
  // a rejected Apply with a reason is honest, a quietly clamped yaw is not.
  const isDraftRenderable = useMemo(
    () => (draft ? isMotionRenderable(draft, GUARD_CANVAS) : true),
    [draft],
  );

  if (!isOpen || !draft) return null;

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm
        duration-200 animate-in fade-in-0"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-motion-title"
        onKeyDown={handleKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[88vh] w-[min(920px,94vw)] flex-col overflow-hidden rounded-2xl border
          border-border bg-card text-card-foreground shadow-2xl duration-200
          animate-in fade-in-0 zoom-in-95"
      >
        <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 id="camera-motion-title" className="text-sm font-semibold text-foreground">
              {copy.title}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{headerSubtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.cancel}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted
              hover:text-foreground focus-visible:outline-none focus-visible:ring-2
              focus-visible:ring-primary/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-5 md:grid-cols-[1fr_340px]">
          <PresetGallery
            selectedId={draft.presetId}
            onSelect={(next) =>
              // Switching presets keeps the user's window + intensity: those are
              // "how much / when", independent of "which move".
              setDraft({
                ...next,
                startRatio: draft.startRatio,
                endRatio: draft.endRatio,
                intensity: draft.intensity,
              })
            }
            imageSrc={thumbnailUrl}
          />

          <div className="space-y-4">
            <div className="space-y-1.5">
              <MotionPreviewThumb
                motion={draft}
                imageSrc={thumbnailUrl}
                width={LARGE_PREVIEW_WIDTH}
                height={LARGE_PREVIEW_HEIGHT}
                active
                className="w-full border border-border"
              />
              <p className="text-center text-[11px] text-muted-foreground">
                {presetLabel(presetLabels, draft.presetId)}
                {draft.presetId === CUSTOM_PRESET_ID ? '' : ` · ${draft.space.toUpperCase()}`}
              </p>
            </div>
            <MotionInspector motion={draft} onChange={setDraft} />
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={() => onApply(null)}
            disabled={!motion}
            className="rounded-md px-3 py-1.5 text-xs text-destructive transition-colors
              hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            {copy.remove}
          </button>
          <div className="flex items-center gap-2">
            {!isDraftRenderable && (
              <p
                id="camera-motion-unrenderable"
                role="alert"
                className="max-w-[26rem] text-right text-[11px] leading-snug text-destructive"
              >
                {copy.unrenderable}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-3.5 py-1.5 text-xs text-foreground
                transition-colors hover:bg-muted focus-visible:outline-none
                focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              onClick={() => onApply(draft)}
              disabled={!isDraftRenderable}
              aria-describedby={isDraftRenderable ? undefined : 'camera-motion-unrenderable'}
              className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground
                transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {copy.apply}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default CameraMotionModal;
