'use client';

/**
 * PresetGrid — the camera-motion preset picker (spec §4.5.2).
 *
 * A real `role="radiogroup"` with roving-tabindex arrow navigation, so the whole
 * grid is one tab stop and the arrows move the selection the way a native radio
 * group does. Each card carries a tiny SVG diagram of what the motion does —
 * animated by default, static arrows under `prefers-reduced-motion: reduce`.
 */

import React, { useCallback, useMemo, useRef } from 'react';
import type { CameraMotionMode } from '@/components/video/playback/camera';
import { presetsForMode } from '@/components/video/playback/camera';
import { presetLabel } from './presetLabels';
import type { Translations } from '@/lib/i18n';

type PresetLabels = Translations['timeline']['cameraMotion']['presets'];

interface PresetGridProps {
  mode: CameraMotionMode;
  selectedPresetId: string;
  onSelect: (presetId: string) => void;
  labels: PresetLabels;
  groupLabel: string;
  reducedMotion: boolean;
}

/** Card ids in display order — 'none' always leads the grid. */
function cardIds(mode: CameraMotionMode): string[] {
  return ['none', ...presetsForMode(mode).map((preset) => preset.id)];
}

/**
 * The mini diagram: a viewfinder frame moving over a still. Purely decorative
 * (`aria-hidden`) — the accessible name comes from the card's own label.
 */
const PresetDiagram: React.FC<{ presetId: string; reducedMotion: boolean }> = ({
  presetId,
  reducedMotion,
}) => {
  const animation = reducedMotion ? undefined : PRESET_ANIMATION[presetId];
  return (
    <svg viewBox="0 0 48 30" className="w-full h-[30px]" aria-hidden="true">
      <rect x="0.5" y="0.5" width="47" height="29" rx="2.5"
        className="fill-muted stroke-border" strokeWidth="1" />
      {presetId === 'none' ? (
        <line x1="16" y1="15" x2="32" y2="15" className="stroke-muted-foreground" strokeWidth="1.5"
          strokeLinecap="round" />
      ) : (
        <rect
          x="14" y="8" width="20" height="14" rx="1.5"
          className="fill-primary/10 stroke-primary" strokeWidth="1.25"
          style={animation ? { transformOrigin: '24px 15px', animation } : undefined}
        />
      )}
    </svg>
  );
};

/**
 * Per-preset CSS animation shorthand. The keyframes live in the modal's scoped
 * <style> block so this stays a plain data table.
 */
const PRESET_ANIMATION: Record<string, string> = {
  'push-in': 'ecx-cam-push 2.4s ease-in-out infinite',
  'pull-out': 'ecx-cam-pull 2.4s ease-in-out infinite',
  'pan-left': 'ecx-cam-left 2.4s ease-in-out infinite',
  'pan-right': 'ecx-cam-right 2.4s ease-in-out infinite',
  'pan-up': 'ecx-cam-up 2.4s ease-in-out infinite',
  'pan-down': 'ecx-cam-down 2.4s ease-in-out infinite',
  'zoom-pan-diagonal': 'ecx-cam-diagonal 2.4s ease-in-out infinite',
  'roll-slight': 'ecx-cam-roll 2.4s ease-in-out infinite',
  'dolly-in-3d': 'ecx-cam-push 2.4s ease-in-out infinite',
  'dolly-out-3d': 'ecx-cam-pull 2.4s ease-in-out infinite',
  'orbit-left': 'ecx-cam-orbit-left 2.4s ease-in-out infinite',
  'orbit-right': 'ecx-cam-orbit-right 2.4s ease-in-out infinite',
  'tilt-down': 'ecx-cam-tilt-down 2.4s ease-in-out infinite',
  'tilt-up': 'ecx-cam-tilt-up 2.4s ease-in-out infinite',
  'parallax-push': 'ecx-cam-diagonal 2.4s ease-in-out infinite',
  'sway-3d': 'ecx-cam-orbit-right 2.4s ease-in-out infinite',
};

const PresetGrid: React.FC<PresetGridProps> = ({
  mode,
  selectedPresetId,
  onSelect,
  labels,
  groupLabel,
  reducedMotion,
}) => {
  const ids = useMemo(() => cardIds(mode), [mode]);
  const containerRef = useRef<HTMLDivElement>(null);

  // Roving tabindex: only the checked card is tabbable, arrows move + select.
  const activeIndex = Math.max(0, ids.indexOf(selectedPresetId));

  const focusCard = useCallback((index: number) => {
    const root = containerRef.current;
    if (!root) return;
    const buttons = root.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[index]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step =
        event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const next = (activeIndex + step + ids.length) % ids.length;
      onSelect(ids[next]);
      focusCard(next);
    },
    [activeIndex, ids, onSelect, focusCard],
  );

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label={groupLabel}
      onKeyDown={handleKeyDown}
      className="grid grid-cols-3 gap-2"
    >
      {ids.map((id, index) => {
        const checked = id === selectedPresetId;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={index === activeIndex ? 0 : -1}
            onClick={() => onSelect(id)}
            className={`group flex flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition-all
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
              ${checked
                ? 'border-primary bg-primary/5 ring-2 ring-primary'
                : 'border-border bg-card hover:border-primary/40 hover:bg-muted'}`}
          >
            <PresetDiagram presetId={id} reducedMotion={reducedMotion} />
            <span
              className={`text-[11px] leading-tight ${checked ? 'text-primary font-medium' : 'text-muted-foreground'}`}
            >
              {presetLabel(id, labels)}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default PresetGrid;
