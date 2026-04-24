'use client';

import React, { useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  STORYBOARD_BATCH_SIZE,
  STORYBOARD_MAX_SCENE_COUNT,
  STORYBOARD_MIN_SCENE_COUNT,
} from '@/types';

interface SceneCountInputProps {
  value: number;
  onChange: (sceneCount: number) => void;
  disabled?: boolean;
}

/**
 * Numeric input for total storyboard scene count (1..16).
 *
 * Post-refactor the storyboard generator always uses 2×2 batches internally
 * and chains ceil(N/4) calls to Seedream together, so the user only picks the
 * total scene count — no grid preset buttons. The helper text below the input
 * makes the batch decomposition explicit so users understand why the control
 * caps at 16.
 */
const SceneCountInput: React.FC<SceneCountInputProps> = ({ value, onChange, disabled }) => {
  const { t } = useLocale();
  const copy = t.sceneCountInput;

  const clamped = Math.max(STORYBOARD_MIN_SCENE_COUNT, Math.min(STORYBOARD_MAX_SCENE_COUNT, value));
  const batchCount = Math.ceil(clamped / STORYBOARD_BATCH_SIZE);

  const handleChange = useCallback(
    (raw: string) => {
      // Empty string → keep current value so the user can freely edit; a
      // committed invalid value falls back to the min bound.
      if (raw === '') {
        return;
      }
      const num = parseInt(raw, 10);
      if (Number.isNaN(num)) {
        onChange(STORYBOARD_MIN_SCENE_COUNT);
        return;
      }
      if (num < STORYBOARD_MIN_SCENE_COUNT) {
        onChange(STORYBOARD_MIN_SCENE_COUNT);
        return;
      }
      if (num > STORYBOARD_MAX_SCENE_COUNT) {
        onChange(STORYBOARD_MAX_SCENE_COUNT);
        return;
      }
      onChange(num);
    },
    [onChange],
  );

  const exceeded = value > STORYBOARD_MAX_SCENE_COUNT;

  return (
    <div>
      <label className="block text-sm font-medium text-foreground mb-2">{copy.label}</label>
      <input
        type="number"
        min={STORYBOARD_MIN_SCENE_COUNT}
        max={STORYBOARD_MAX_SCENE_COUNT}
        step={1}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled}
        className="w-full border border-border rounded-md px-3 py-2 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
        placeholder={copy.placeholder}
      />
      <p className="text-xs text-muted-foreground mt-2">
        {copy.batchesHint
          .replace('{count}', String(clamped))
          .replace('{batches}', String(batchCount))
          .replace('{batchSize}', String(STORYBOARD_BATCH_SIZE))}
      </p>
      {exceeded && (
        <p className="text-xs text-destructive mt-1">
          {copy.maxScenesExceededTip.replace('{max}', String(STORYBOARD_MAX_SCENE_COUNT))}
        </p>
      )}
    </div>
  );
};

export default SceneCountInput;
