import React from 'react';

export type Tone = 'good' | 'neutral' | 'warn' | 'bad';

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-green-500/10 text-green-700 dark:text-green-400',
  neutral: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
};

const StatusIcon: React.FC<{ tone: Tone }> = ({ tone }) => (
  <svg
    className="h-3.5 w-3.5 flex-shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {tone === 'good' && <path d="M3.5 8.5l3 3 6-7" />}
    {tone === 'neutral' && <path d="M4 8h8" />}
    {(tone === 'warn' || tone === 'bad') && <path d="M8 4v5M8 12v.01" />}
  </svg>
);

interface StatusPillProps {
  tone: Tone;
  label: string;
}

/** Status chip used by the checklist and the integration group rows. */
const StatusPill: React.FC<StatusPillProps> = ({ tone, label }) => (
  <span
    className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}
  >
    <StatusIcon tone={tone} />
    {label}
  </span>
);

export default StatusPill;
