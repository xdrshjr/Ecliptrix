'use client';

/**
 * CameraMotionModal — the 2D / 3D camera-motion panel (spec §4.5.2).
 *
 * Built on the shared `Modal` (Esc close, focus trap, focus return). Two-column
 * on desktop: presets on the left, live stage + parameters on the right.
 *
 * Non-invasive by contract: opening the panel does NOT pause the main preview
 * and does NOT touch the store. Everything is local draft state until 「应用」,
 * so Cancel is always a true cancel. Closing with unapplied edits asks first,
 * so a stray backdrop click cannot silently discard work.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { useLocale } from '@/contexts/LocaleContext';
import {
  Camera3DRenderer,
  applyPreset,
  cameraMotionFingerprint,
  cameraMotionConstants,
  emptyCameraMotion,
  hasClampedComponent,
  isIdentityCameraMotion,
  reverseCameraMotion,
  type CameraMotion,
  type CameraMotionMode,
} from '@/components/video/playback/camera';
import PresetGrid from './PresetGrid';
import MotionPreviewStage from './MotionPreviewStage';
import ParameterControls from './ParameterControls';
import { presetLabel } from './presetLabels';
import { markCameraMotionPanelOpen } from './panelPresence';

const TITLE_ID = 'camera-motion-modal-title';
const DESC_ID = 'camera-motion-modal-desc';

/** Aspect used for the panel's own hints — the stage is a 16:9 surface. */
const STAGE_ASPECT = 16 / 9;

export interface CameraMotionModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Apply to the given item ids. `null` clears the motion. */
  onApply: (itemIds: string[], motion: CameraMotion | null) => void;
  /** The clip that opened the panel (its name / poster / duration drive the UI). */
  clipName: string;
  clipDuration: number;
  clipThumbnailUrl?: string;
  /** The motion already on that clip, if any. */
  initialMotion?: CameraMotion;
  /** The clip that opened the panel, plus any other eligible selected clips. */
  targetItemIds: string[];
}

/** Keyframe animations for the preset cards — scoped to this panel. */
const PRESET_KEYFRAMES = `
@keyframes ecx-cam-push { 0%,100% { transform: scale(1); } 50% { transform: scale(1.28); } }
@keyframes ecx-cam-pull { 0%,100% { transform: scale(1.28); } 50% { transform: scale(1); } }
@keyframes ecx-cam-left { 0%,100% { transform: translateX(5px); } 50% { transform: translateX(-5px); } }
@keyframes ecx-cam-right { 0%,100% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }
@keyframes ecx-cam-up { 0%,100% { transform: translateY(3px); } 50% { transform: translateY(-3px); } }
@keyframes ecx-cam-down { 0%,100% { transform: translateY(-3px); } 50% { transform: translateY(3px); } }
@keyframes ecx-cam-diagonal { 0%,100% { transform: translate(4px,2px) scale(1); } 50% { transform: translate(-4px,-2px) scale(1.2); } }
@keyframes ecx-cam-roll { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
@keyframes ecx-cam-orbit-left { 0%,100% { transform: perspective(80px) rotateY(14deg); } 50% { transform: perspective(80px) rotateY(-14deg); } }
@keyframes ecx-cam-orbit-right { 0%,100% { transform: perspective(80px) rotateY(-14deg); } 50% { transform: perspective(80px) rotateY(14deg); } }
@keyframes ecx-cam-tilt-down { 0%,100% { transform: perspective(80px) rotateX(-14deg); } 50% { transform: perspective(80px) rotateX(14deg); } }
@keyframes ecx-cam-tilt-up { 0%,100% { transform: perspective(80px) rotateX(14deg); } 50% { transform: perspective(80px) rotateX(-14deg); } }
`;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    }
    return undefined;
  }, []);
  return reduced;
}

const CameraMotionModal: React.FC<CameraMotionModalProps> = ({
  isOpen,
  onClose,
  onApply,
  clipName,
  clipDuration,
  clipThumbnailUrl,
  initialMotion,
  targetItemIds,
}) => {
  const { t } = useLocale();
  const labels = t.timeline.cameraMotion;
  const reducedMotion = usePrefersReducedMotion();

  const [mode, setMode] = useState<CameraMotionMode>(initialMotion?.mode ?? '2d');
  const [draft, setDraft] = useState<CameraMotion>(() => initialMotion ?? emptyCameraMotion('2d'));
  const [applyToAll, setApplyToAll] = useState(true);
  const [webglDegraded, setWebglDegraded] = useState(false);
  // Stage transport (§4.5.2). `prefers-reduced-motion` starts frozen at the
  // midpoint — the single most informative still of a motion — instead of
  // looping at someone who asked the OS for less movement.
  const [stagePlaying, setStagePlaying] = useState(!reducedMotion);
  const [stageProgress, setStageProgress] = useState(reducedMotion ? 0.5 : 0);

  // Re-seed the draft each time the panel opens on a (possibly different) clip.
  useEffect(() => {
    if (!isOpen) return;
    const seed = initialMotion ?? emptyCameraMotion('2d');
    setDraft(seed);
    setMode(seed.mode);
    setApplyToAll(true);
    setWebglDegraded(!Camera3DRenderer.isSupported());
    setStagePlaying(!reducedMotion);
    setStageProgress(reducedMotion ? 0.5 : 0);
  }, [isOpen, initialMotion, reducedMotion]);

  // Dragging the scrub bar IS the pause gesture: nobody drags a slider hoping
  // the thing keeps running away from them.
  const handleStageScrub = useCallback((u: number) => {
    setStagePlaying(false);
    setStageProgress(u);
  }, []);

  const handleStageToggle = useCallback(() => {
    setStagePlaying((playing) => !playing);
  }, []);

  // Tell the preview badge to stand down while this panel (and its own WebGL
  // badge) is on screen — one message about one thing (D29).
  useEffect(() => {
    if (!isOpen) return undefined;
    return markCameraMotionPanelOpen();
  }, [isOpen]);

  const baselineFingerprint = useMemo(
    () => (initialMotion ? cameraMotionFingerprint(initialMotion) : ''),
    [initialMotion],
  );
  const draftFingerprint = useMemo(
    () => (isIdentityCameraMotion(draft) ? '' : cameraMotionFingerprint(draft)),
    [draft],
  );
  const isDirty = baselineFingerprint !== draftFingerprint;

  const isNone = isIdentityCameraMotion(draft);

  // Quality hints (§4.5.2). Cheap: both constants are memoized per motion.
  const hints = useMemo(() => {
    if (isNone) return [] as string[];
    const out: string[] = [];
    const constants = cameraMotionConstants(draft, STAGE_ASPECT);
    if (constants.coverScale > 1.6) out.push(labels.qualityHintCover);
    if (constants.rollPad > 1.2) out.push(labels.qualityHintRoll);
    if (hasClampedComponent(draft)) out.push(labels.qualityHintClamped);
    return out;
  }, [draft, isNone, labels]);

  const handleSelectPreset = useCallback((presetId: string) => {
    setDraft((prev) => {
      if (presetId === 'none') {
        return { ...emptyCameraMotion(prev.mode), intensity: prev.intensity, easing: prev.easing };
      }
      const next = applyPreset(presetId, prev.mode);
      // Keep the user's intensity / easing / window across preset switches —
      // re-dialling them on every card click would be tedious.
      return {
        ...next,
        intensity: prev.intensity,
        easing: prev.easing,
        startOffset: prev.startOffset,
        duration: prev.duration,
      };
    });
  }, []);

  const handleModeChange = useCallback((nextMode: CameraMotionMode) => {
    setMode(nextMode);
    setDraft((prev) => ({
      ...emptyCameraMotion(nextMode),
      intensity: prev.intensity,
      easing: prev.easing,
      startOffset: prev.startOffset,
      duration: prev.duration,
    }));
  }, []);

  const handleReverse = useCallback(() => {
    setDraft((prev) => reverseCameraMotion(prev));
  }, []);

  const itemIds = useMemo(
    () => (applyToAll ? targetItemIds : targetItemIds.slice(0, 1)),
    [applyToAll, targetItemIds],
  );

  const handleApply = useCallback(() => {
    onApply(itemIds, isNone ? null : draft);
    onClose();
  }, [onApply, itemIds, isNone, draft, onClose]);

  const handleReset = useCallback(() => {
    setDraft(emptyCameraMotion(mode));
  }, [mode]);

  const handleRequestClose = useCallback(() => {
    if (isDirty && typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(labels.discardConfirm)) return;
    }
    onClose();
  }, [isDirty, labels.discardConfirm, onClose]);

  if (!isOpen) return null;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors
     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
     ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted'}`;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      labelledBy={TITLE_ID}
      describedBy={DESC_ID}
      contentClassName="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-xl border border-border bg-card shadow-2xl flex flex-col"
    >
      <style>{PRESET_KEYFRAMES}</style>

      {/* Header ---------------------------------------------------------- */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 id={TITLE_ID} className="text-sm font-semibold text-foreground">
            {labels.title}
          </h2>
          <p id={DESC_ID} className="mt-0.5 truncate text-xs text-muted-foreground">
            {labels.clipLabel.replace('{name}', clipName)}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRequestClose}
          aria-label={labels.cancel}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body ------------------------------------------------------------ */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row">
        {/* Left: mode tabs + preset grid */}
        <div className="w-full shrink-0 space-y-3 border-b border-border p-4 lg:w-[46%] lg:border-b-0 lg:border-r">
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={labels.title}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === '2d'}
              onClick={() => handleModeChange('2d')}
              className={tabClass(mode === '2d')}
            >
              {labels.tab2d}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === '3d'}
              onClick={() => handleModeChange('3d')}
              className={tabClass(mode === '3d')}
            >
              {labels.tab3d}
            </button>
          </div>

          <PresetGrid
            mode={mode}
            selectedPresetId={isNone ? 'none' : draft.presetId}
            onSelect={handleSelectPreset}
            labels={labels.presets}
            groupLabel={labels.presetsLabel}
            reducedMotion={reducedMotion}
          />
        </div>

        {/* Right: stage + parameters */}
        <div className="min-w-0 flex-1 space-y-3 p-4">
          <div className="relative">
            <MotionPreviewStage
              motion={isNone ? null : draft}
              clipDuration={clipDuration}
              posterUrl={clipThumbnailUrl}
              playing={stagePlaying}
              progress={stageProgress}
              onProgressChange={handleStageScrub}
              onTogglePlaying={handleStageToggle}
              labels={{
                scrub: labels.stageScrub,
                scrubValue: labels.stageScrubValue,
                play: labels.stagePlay,
                pause: labels.stagePause,
              }}
              onDegraded={() => setWebglDegraded(true)}
            />
            {mode === '3d' && webglDegraded && (
              <div className="absolute right-2 top-2 rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow-sm">
                {labels.webglDegraded}
              </div>
            )}
          </div>

          {hints.length > 0 && (
            <ul className="space-y-0.5">
              {hints.map((hint) => (
                <li key={hint} className="text-[11px] text-muted-foreground">• {hint}</li>
              ))}
            </ul>
          )}

          <ParameterControls
            motion={draft}
            clipDuration={clipDuration}
            labels={labels}
            onChange={setDraft}
            onReverse={handleReverse}
            disabled={isNone}
          />
        </div>
      </div>

      {/* Footer ---------------------------------------------------------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {targetItemIds.length > 1 && (
            <>
              <span>{labels.multiSelected.replace('{count}', String(targetItemIds.length))}</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-foreground">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={applyToAll}
                  onChange={(e) => setApplyToAll(e.target.checked)}
                />
                {labels.applyToAllSelected}
              </label>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground
              transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {labels.reset}
          </button>
          <button
            type="button"
            onClick={handleRequestClose}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground
              transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded-md bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-sm
              transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            {labels.apply}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export { presetLabel };
export default CameraMotionModal;
