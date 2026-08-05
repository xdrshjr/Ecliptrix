'use client';

/**
 * PresetGallery — the 2D / 3D preset picker.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §6.2.
 *
 * A single `radiogroup` per space with roving-tabindex arrow navigation, which
 * is the pattern screen-reader users expect from a grid of mutually exclusive
 * choices — and which keeps the whole panel operable without a mouse (M6).
 *
 * Only the cards near the pointer/focus animate: `MAX_ANIMATED_CARDS` caps how
 * many mini canvases run at once, because sixteen simultaneous rAF loops would
 * starve the main preview (L8). `prefers-reduced-motion` reduces that to zero
 * until a card is hovered or focused.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  CAMERA_MOTION_PRESETS_2D,
  CAMERA_MOTION_PRESETS_3D,
  motionFromPreset,
  type CameraMotion,
  type CameraMotionPreset,
} from '../../playback';
import MotionPreviewThumb from './MotionPreviewThumb';

/** Hard cap on simultaneously animating mini canvases. */
const MAX_ANIMATED_CARDS = 8;

const THUMB_WIDTH = 92;
const THUMB_HEIGHT = 52;

/** Preset id → i18n key. Exported so the timeline badge names presets too. */
export const PRESET_LABEL_KEYS: Record<string, string> = {
  'zoom-in': 'zoomIn',
  'zoom-out': 'zoomOut',
  'pan-left': 'panLeft',
  'pan-right': 'panRight',
  'tilt-up': 'tiltUp',
  'tilt-down': 'tiltDown',
  'rotate-in': 'rotateIn',
  'ken-burns': 'kenBurns',
  'orbit-left': 'orbitLeft',
  'orbit-right': 'orbitRight',
  dive: 'dive',
  'crane-up': 'craneUp',
  'swing-in': 'swingIn',
  'dolly-in-3d': 'dollyIn3d',
  boom: 'boom',
  spiral: 'spiral',
};

/**
 * Human-readable preset name in the active locale.
 *
 * @param presets The `t.timeline.cameraMotion.presets` bundle.
 * @param presetId Preset identifier.
 * @returns The localized name, falling back to "Custom" for unknown ids.
 */
export function presetLabel(
  presets: Record<string, string>,
  presetId: string,
): string {
  const key = PRESET_LABEL_KEYS[presetId];
  return (key && presets[key]) || presets.custom || presetId;
}

export interface PresetGalleryProps {
  /** Currently selected preset id (`'custom'` when hand-tuned). */
  selectedId: string;
  onSelect: (motion: CameraMotion) => void;
  /** Clip thumbnail used by every card so the demo shows the real footage. */
  imageSrc?: string;
}

interface GroupProps extends PresetGalleryProps {
  label: string;
  presets: readonly CameraMotionPreset[];
  animatedIds: ReadonlySet<string>;
  onHover: (presetId: string | null) => void;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

const PresetGroup: React.FC<GroupProps> = ({
  label,
  presets,
  selectedId,
  onSelect,
  imageSrc,
  animatedIds,
  onHover,
}) => {
  const { t } = useLocale();
  const labels = t.timeline.cameraMotion.presets as unknown as Record<string, string>;
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      // A 4-wide grid: horizontal keys step by 1, vertical keys step by a row.
      const step =
        event.key === 'ArrowRight' ? 1
          : event.key === 'ArrowLeft' ? -1
            : event.key === 'ArrowDown' ? 4
              : event.key === 'ArrowUp' ? -4
                : 0;
      let next = index + step;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = presets.length - 1;
      next = Math.max(0, Math.min(presets.length - 1, next));
      const motion = motionFromPreset(presets[next].id);
      if (motion) onSelect(motion);
      const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
      buttons?.[next]?.focus();
    },
    [presets, onSelect],
  );

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      <div
        ref={containerRef}
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-4 gap-2"
      >
        {presets.map((preset, index) => {
          const checked = preset.id === selectedId;
          const motion = motionFromPreset(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked || (selectedId === 'custom' && index === 0) ? 0 : -1}
              onClick={() => motion && onSelect(motion)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onMouseEnter={() => onHover(preset.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(preset.id)}
              onBlur={() => onHover(null)}
              className={`group flex flex-col items-center gap-1 rounded-lg border p-1.5 transition-all
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                ${checked
                  ? 'border-primary bg-primary/10 shadow-sm'
                  : 'border-border bg-muted/30 hover:border-foreground/25 hover:bg-muted/60'
                }`}
            >
              {motion && (
                <MotionPreviewThumb
                  motion={motion}
                  imageSrc={imageSrc}
                  width={THUMB_WIDTH}
                  height={THUMB_HEIGHT}
                  active={animatedIds.has(preset.id)}
                />
              )}
              <span
                className={`w-full truncate text-center text-[11px] leading-tight ${
                  checked ? 'text-primary font-medium' : 'text-muted-foreground'
                }`}
              >
                {presetLabel(labels, preset.id)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

const PresetGallery: React.FC<PresetGalleryProps> = ({ selectedId, onSelect, imageSrc }) => {
  const { t } = useLocale();
  const reducedMotion = usePrefersReducedMotion();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const animatedIds = useMemo(() => {
    // Reduced motion: nothing loops until the user actively points at a card,
    // which keeps the feature discoverable without imposing the animation.
    if (reducedMotion) return new Set(hoveredId ? [hoveredId] : []);
    const ordered = [...CAMERA_MOTION_PRESETS_2D, ...CAMERA_MOTION_PRESETS_3D];
    const ids = new Set<string>();
    if (hoveredId) ids.add(hoveredId);
    if (selectedId) ids.add(selectedId);
    for (const preset of ordered) {
      if (ids.size >= MAX_ANIMATED_CARDS) break;
      ids.add(preset.id);
    }
    return ids;
  }, [reducedMotion, hoveredId, selectedId]);

  const shared = { selectedId, onSelect, imageSrc, animatedIds, onHover: setHoveredId };

  return (
    <div className="space-y-4">
      <PresetGroup
        {...shared}
        label={t.timeline.cameraMotion.group2d}
        presets={CAMERA_MOTION_PRESETS_2D}
      />
      <PresetGroup
        {...shared}
        label={t.timeline.cameraMotion.group3d}
        presets={CAMERA_MOTION_PRESETS_3D}
      />
    </div>
  );
};

export default PresetGallery;
