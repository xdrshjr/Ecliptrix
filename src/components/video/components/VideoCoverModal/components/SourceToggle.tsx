'use client';

import React from 'react';

import type { ImageSource } from '../types';
import { useLocale } from '@/contexts/LocaleContext';

interface SourceToggleProps {
  value: ImageSource;
  onChange: (next: ImageSource) => void;
  disabled?: boolean;
  /** When the timeline has no video items the "frame" radio is locked. */
  frameDisabled?: boolean;
}

/**
 * Mutually-exclusive radio between "Frame" (scrub a frame from the
 * timeline) and "Upload" (use a locally uploaded image). Switching one way
 * clears the other side's state — the parent ``VideoCoverModal`` performs
 * the actual reset (per spec §2.2.D).
 */
export const SourceToggle: React.FC<SourceToggleProps> = ({
  value,
  onChange,
  disabled,
  frameDisabled,
}) => {
  const { t } = useLocale();
  const labels = t.videoCoverModal?.source ?? {
    label: 'Source',
    frame: 'Frame',
    upload: 'Upload',
  };

  return (
    <fieldset
      className="flex items-center gap-2 text-xs"
      disabled={disabled}
    >
      <legend className="sr-only">{labels.label}</legend>
      <span className="text-muted-foreground">{labels.label}:</span>
      <RadioPill
        label={labels.frame}
        active={value === 'frame'}
        disabled={!!frameDisabled}
        onClick={() => onChange('frame')}
      />
      <RadioPill
        label={labels.upload}
        active={value === 'upload'}
        onClick={() => onChange('upload')}
      />
    </fieldset>
  );
};

interface RadioPillProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const RadioPill: React.FC<RadioPillProps> = ({ label, active, disabled, onClick }) => (
  <button
    type="button"
    aria-pressed={active}
    disabled={disabled}
    onClick={onClick}
    className={[
      'px-2 py-1 rounded-full border',
      active
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border text-muted-foreground hover:border-primary/60',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
    ].join(' ')}
  >
    {label}
  </button>
);

export default SourceToggle;
