'use client';

/**
 * MotionInspector — the parameter side of the camera-motion panel.
 *
 * Plan: docs/plans/timeline-camera-motion/experiment-plan.md §6.2.
 *
 * Progressive disclosure: the four controls that shape a move for 95% of edits
 * (intensity / easing / range / reverse) sit in the open, while the raw
 * scale-offset-roll-yaw-pitch-dolly numbers live behind a collapsed "advanced"
 * section. Touching an advanced field re-labels the motion as `custom`, so the
 * preset chip never claims a framing the numbers no longer describe.
 *
 * Every slider carries an `aria-valuetext` in the active locale — a bare
 * "1.15" tells a screen-reader user nothing about what it scales.
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  CUSTOM_PRESET_ID,
  reverseMotion,
  type CameraMotion,
  type CameraMotionEasing,
  type CameraMotionState,
} from '../../playback';

export interface MotionInspectorProps {
  motion: CameraMotion;
  onChange: (motion: CameraMotion) => void;
}

const EASINGS: CameraMotionEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

/** Advanced numeric fields, with the range and step each one is edited at. */
const ADVANCED_FIELDS: Array<{
  key: keyof CameraMotionState;
  labelKey: string;
  min: number;
  max: number;
  step: number;
  /** 3D-only fields are hidden for planar moves to keep the panel honest. */
  spatial?: boolean;
}> = [
  { key: 'scale', labelKey: 'scale', min: 0.5, max: 3, step: 0.01 },
  { key: 'offsetX', labelKey: 'offsetX', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'offsetY', labelKey: 'offsetY', min: -0.5, max: 0.5, step: 0.005 },
  { key: 'roll', labelKey: 'roll', min: -45, max: 45, step: 0.5 },
  { key: 'yaw', labelKey: 'yaw', min: -45, max: 45, step: 0.5, spatial: true },
  { key: 'pitch', labelKey: 'pitch', min: -45, max: 45, step: 0.5, spatial: true },
  { key: 'dolly', labelKey: 'dolly', min: 0.4, max: 2.5, step: 0.01, spatial: true },
];

const labelClass = 'text-xs font-medium text-muted-foreground';
const sliderClass =
  'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

const MotionInspector: React.FC<MotionInspectorProps> = ({ motion, onChange }) => {
  const { t } = useLocale();
  const copy = t.timeline.cameraMotion;
  const advancedLabels = copy as unknown as Record<string, string>;

  const patch = (changes: Partial<CameraMotion>) => onChange({ ...motion, ...changes });

  const patchEndpoint = (
    endpoint: 'from' | 'to',
    key: keyof CameraMotionState,
    value: number,
  ) => {
    onChange({
      ...motion,
      presetId: CUSTOM_PRESET_ID,
      [endpoint]: { ...motion[endpoint], [key]: value },
    });
  };

  const easingLabel = (easing: CameraMotionEasing): string => {
    if (easing === 'ease-in') return copy.easingIn;
    if (easing === 'ease-out') return copy.easingOut;
    if (easing === 'ease-in-out') return copy.easingInOut;
    return copy.easingLinear;
  };

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="camera-motion-intensity" className={labelClass}>
            {copy.intensity}
          </label>
          <span className="text-xs tabular-nums text-foreground">
            {motion.intensity.toFixed(2)}
          </span>
        </div>
        <input
          id="camera-motion-intensity"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={motion.intensity}
          aria-valuetext={`${copy.intensity} ${motion.intensity.toFixed(2)}`}
          onChange={(e) => patch({ intensity: Number(e.target.value) })}
          className={sliderClass}
        />
      </div>

      <div className="space-y-1.5">
        <span className={labelClass} id="camera-motion-easing-label">
          {copy.easing}
        </span>
        <div
          className="grid grid-cols-2 gap-1.5"
          role="radiogroup"
          aria-labelledby="camera-motion-easing-label"
        >
          {EASINGS.map((easing) => (
            <button
              key={easing}
              type="button"
              role="radio"
              aria-checked={motion.easing === easing}
              onClick={() => patch({ easing })}
              className={`rounded-md border px-2 py-1.5 text-xs transition-colors
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40
                ${motion.easing === easing
                  ? 'border-primary bg-primary/10 text-primary font-medium'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/70'
                }`}
            >
              {easingLabel(easing)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className={labelClass}>{copy.range}</span>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="camera-motion-start" className="w-10 text-[11px] text-muted-foreground">
              {copy.rangeStart}
            </label>
            <input
              id="camera-motion-start"
              type="range"
              min={0}
              max={0.95}
              step={0.05}
              value={motion.startRatio}
              aria-valuetext={`${copy.rangeStart} ${Math.round(motion.startRatio * 100)}%`}
              onChange={(e) =>
                // Keep the window non-empty: an inverted range would freeze the
                // move and the backend rejects it outright.
                patch({
                  startRatio: Math.min(Number(e.target.value), motion.endRatio - 0.05),
                })
              }
              className={sliderClass}
            />
            <span className="w-10 text-right text-[11px] tabular-nums text-foreground">
              {Math.round(motion.startRatio * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="camera-motion-end" className="w-10 text-[11px] text-muted-foreground">
              {copy.rangeEnd}
            </label>
            <input
              id="camera-motion-end"
              type="range"
              min={0.05}
              max={1}
              step={0.05}
              value={motion.endRatio}
              aria-valuetext={`${copy.rangeEnd} ${Math.round(motion.endRatio * 100)}%`}
              onChange={(e) =>
                patch({ endRatio: Math.max(Number(e.target.value), motion.startRatio + 0.05) })
              }
              className={sliderClass}
            />
            <span className="w-10 text-right text-[11px] tabular-nums text-foreground">
              {Math.round(motion.endRatio * 100)}%
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onChange(reverseMotion(motion))}
        className="w-full rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs
          text-foreground transition-colors hover:bg-muted/70
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {copy.reverse}
      </button>

      <details className="group rounded-md border border-border bg-muted/20">
        <summary
          className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground
            transition-colors hover:text-foreground
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="inline-block transition-transform group-open:rotate-90">▸</span>{' '}
          {copy.advanced}
        </summary>
        <div className="space-y-3 border-t border-border px-3 py-3">
          {(['from', 'to'] as const).map((endpoint) => (
            <div key={endpoint} className="space-y-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {endpoint === 'from' ? copy.rangeStart : copy.rangeEnd}
              </span>
              {ADVANCED_FIELDS.filter((f) => !f.spatial || motion.space === '3d').map((field) => (
                <div key={field.key} className="flex items-center gap-2">
                  <label
                    htmlFor={`camera-motion-${endpoint}-${field.key}`}
                    className="w-16 shrink-0 text-[11px] text-muted-foreground"
                  >
                    {advancedLabels[field.labelKey]}
                  </label>
                  <input
                    id={`camera-motion-${endpoint}-${field.key}`}
                    type="range"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={motion[endpoint][field.key]}
                    aria-valuetext={`${advancedLabels[field.labelKey]} ${motion[endpoint][
                      field.key
                    ].toFixed(2)}`}
                    onChange={(e) =>
                      patchEndpoint(endpoint, field.key, Number(e.target.value))
                    }
                    className={sliderClass}
                  />
                  <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                    {motion[endpoint][field.key].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};

export default MotionInspector;
