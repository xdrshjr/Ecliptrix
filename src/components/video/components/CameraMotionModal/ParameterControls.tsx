'use client';

/**
 * ParameterControls — intensity / easing / window / advanced keyframes
 * (spec §4.5.2, camera-motion-keyframe-curves §4.5.3).
 *
 * Every control is a real form element (range, select, radio, number) so the
 * whole panel is keyboard- and screen-reader-navigable without any custom
 * widget semantics. Touching an advanced field flips `presetId` to `'custom'`,
 * because the values no longer describe a named preset.
 *
 * The number fields are NOT superseded by the stage's direct framing — the stage
 * is an accelerator, these are the precise and fully accessible channel, and
 * both write through the same `setKeyframeComponent` gate.
 *
 * With two keyframes this renders exactly what it always did: a "start" group
 * and an "end" group. Only once a curve exists does it switch to editing the
 * selected keyframe, so a user who never adds a third keyframe cannot tell this
 * release happened (G4's interaction surface).
 */

import React from 'react';
import type {
  CameraKeyframe,
  CameraKeyframeStop,
  CameraMotion,
} from '@/components/video/playback/camera';
import { CAMERA_RANGES, expandStops } from '@/components/video/playback/camera';
import type { Translations } from '@/lib/i18n';

type Labels = Translations['timeline']['cameraMotion'];

interface ParameterControlsProps {
  motion: CameraMotion;
  clipDuration: number;
  labels: Labels;
  onChange: (next: CameraMotion) => void;
  /** Sets one component on one keyframe — the shared curve write gate. */
  onKeyframeComponent: (index: number, key: keyof CameraKeyframe, value: number) => void;
  /** Index of the keyframe the curve editor is focused on. */
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onReverse: () => void;
  disabled: boolean;
}

const EASING_OPTIONS: Array<{ value: CameraMotion['easing']; labelKey: keyof Labels }> = [
  { value: 'linear', labelKey: 'easingLinear' },
  { value: 'easeIn', labelKey: 'easingEaseIn' },
  { value: 'easeOut', labelKey: 'easingEaseOut' },
  { value: 'easeInOut', labelKey: 'easingEaseInOut' },
];

const KEYS_2D: Array<{ key: keyof CameraKeyframe; labelKey: keyof Labels; step: number }> = [
  { key: 'scale', labelKey: 'fieldScale', step: 0.01 },
  { key: 'x', labelKey: 'fieldX', step: 0.01 },
  { key: 'y', labelKey: 'fieldY', step: 0.01 },
  { key: 'roll', labelKey: 'fieldRoll', step: 0.5 },
];

const KEYS_3D: Array<{ key: keyof CameraKeyframe; labelKey: keyof Labels; step: number }> = [
  ...KEYS_2D,
  { key: 'rotateX', labelKey: 'fieldRotateX', step: 0.5 },
  { key: 'rotateY', labelKey: 'fieldRotateY', step: 0.5 },
  { key: 'dolly', labelKey: 'fieldDolly', step: 0.01 },
];

const inputClass =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const ParameterControls: React.FC<ParameterControlsProps> = ({
  motion,
  clipDuration,
  labels,
  onChange,
  onKeyframeComponent,
  selectedIndex,
  onSelectIndex,
  onReverse,
  disabled,
}) => {
  const isCustomWindow = motion.duration != null || (motion.startOffset ?? 0) !== 0;
  const fields = motion.mode === '3d' ? KEYS_3D : KEYS_2D;
  const stops: CameraKeyframeStop[] = expandStops(motion);
  const hasCurve = stops.length > 2;
  const selected = Math.min(Math.max(selectedIndex, 0), stops.length - 1);

  const patch = (partial: Partial<CameraMotion>) => onChange({ ...motion, ...partial });

  return (
    <div className="space-y-3">
      {/* Intensity ------------------------------------------------------- */}
      <div className="flex items-center gap-3">
        <label htmlFor="camera-motion-intensity" className="w-16 shrink-0 text-xs text-muted-foreground">
          {labels.intensity}
        </label>
        <input
          id="camera-motion-intensity"
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={motion.intensity}
          disabled={disabled}
          aria-valuetext={labels.intensityValue.replace('{value}', motion.intensity.toFixed(2))}
          onChange={(e) => patch({ intensity: Number(e.target.value) })}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        />
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-foreground">
          {labels.intensityValue.replace('{value}', motion.intensity.toFixed(2))}
        </span>
      </div>

      {/* Easing ----------------------------------------------------------
          Hidden once a curve exists: every segment owns its own easing on the
          keyframe strip then, and two controls claiming to set "the" easing
          would just leave the user guessing which one wins. */}
      {!hasCurve && (
        <div className="flex items-center gap-3">
          <label htmlFor="camera-motion-easing" className="w-16 shrink-0 text-xs text-muted-foreground">
            {labels.easing}
          </label>
          <select
            id="camera-motion-easing"
            value={motion.easing}
            disabled={disabled}
            onChange={(e) => patch({ easing: e.target.value as CameraMotion['easing'] })}
            className={`${inputClass} flex-1`}
          >
            {EASING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {labels[option.labelKey] as string}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Window ---------------------------------------------------------- */}
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1 text-xs text-muted-foreground">{labels.range}</legend>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
            <input
              type="radio"
              name="camera-motion-range"
              className="accent-primary"
              checked={!isCustomWindow}
              onChange={() => patch({ startOffset: undefined, duration: undefined })}
            />
            {labels.rangeWholeClip}
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
            <input
              type="radio"
              name="camera-motion-range"
              className="accent-primary"
              checked={isCustomWindow}
              onChange={() =>
                patch({
                  startOffset: motion.startOffset ?? 0,
                  duration: motion.duration ?? Math.max(0.05, clipDuration),
                })
              }
            />
            {labels.rangeCustom}
          </label>
        </div>
        {isCustomWindow && (
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[11px] text-muted-foreground">
                {labels.startOffset} ({labels.seconds})
              </span>
              <input
                type="number"
                step={0.1}
                min={0}
                max={Math.max(0, clipDuration - 0.05)}
                value={motion.startOffset ?? 0}
                onChange={(e) => patch({ startOffset: Number(e.target.value) })}
                className={inputClass}
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[11px] text-muted-foreground">
                {labels.windowDuration} ({labels.seconds})
              </span>
              <input
                type="number"
                step={0.1}
                min={0.05}
                max={Math.max(0.05, clipDuration)}
                value={motion.duration ?? Math.max(0.05, clipDuration)}
                onChange={(e) => patch({ duration: Number(e.target.value) })}
                className={inputClass}
              />
            </label>
          </div>
        )}
      </fieldset>

      {/* Advanced -------------------------------------------------------- */}
      <details className="rounded-md border border-border bg-muted/30 px-2 py-1.5">
        <summary className="cursor-pointer text-xs text-muted-foreground select-none">
          {labels.advanced}
        </summary>
        <div className="mt-2 space-y-2">
          {hasCurve ? (
            // Curve: one group, editing whichever keyframe is selected. A field
            // per keyframe would put 8 x 7 inputs on screen; the strip is the
            // selector, this is the editor.
            <div>
              <div className="mb-1 flex items-center gap-2">
                <label
                  htmlFor="camera-motion-keyframe-index"
                  className="text-[11px] font-medium text-foreground"
                >
                  {labels.keyframeCounter
                    .replace('{index}', String(selected + 1))
                    .replace('{count}', String(stops.length))}
                </label>
                <select
                  id="camera-motion-keyframe-index"
                  value={selected}
                  disabled={disabled}
                  aria-label={labels.keyframeEditing.replace('{index}', String(selected + 1))}
                  onChange={(e) => onSelectIndex(Number(e.target.value))}
                  className={`${inputClass} w-auto py-0.5 text-[10px]`}
                >
                  {stops.map((stop, index) => (
                    <option key={index} value={index}>
                      #{index + 1} · {Math.round(stop.at * 100)}%
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {fields.map((field) => (
                  <label key={field.key} className="space-y-0.5">
                    <span className="block text-[10px] text-muted-foreground">
                      {labels[field.labelKey] as string}
                    </span>
                    <input
                      type="number"
                      step={field.step}
                      min={CAMERA_RANGES[field.key].min}
                      max={CAMERA_RANGES[field.key].max}
                      value={stops[selected][field.key]}
                      disabled={disabled}
                      onChange={(e) => onKeyframeComponent(selected, field.key, Number(e.target.value))}
                      className={`${inputClass} px-1.5`}
                    />
                  </label>
                ))}
              </div>
            </div>
          ) : (
            (['start', 'end'] as const).map((edge, edgeIndex) => (
              <div key={edge}>
                <div className="mb-1 text-[11px] font-medium text-foreground">
                  {edge === 'start' ? labels.keyframeStart : labels.keyframeEnd}
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {fields.map((field) => (
                    <label key={field.key} className="space-y-0.5">
                      <span className="block text-[10px] text-muted-foreground">
                        {labels[field.labelKey] as string}
                      </span>
                      <input
                        type="number"
                        step={field.step}
                        min={CAMERA_RANGES[field.key].min}
                        max={CAMERA_RANGES[field.key].max}
                        value={motion[edge][field.key]}
                        disabled={disabled}
                        onChange={(e) => onKeyframeComponent(edgeIndex, field.key, Number(e.target.value))}
                        className={`${inputClass} px-1.5`}
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </details>

      <button
        type="button"
        onClick={onReverse}
        disabled={disabled}
        aria-label={labels.reverseAria}
        className="rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground
          transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        {labels.reverse}
      </button>
    </div>
  );
};

export default ParameterControls;
