'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';

interface CapabilityChecklistProps {
  capabilities: CapabilityStatus[];
  optOuts: readonly CapabilityId[];
  /** Include the model name + source badge (done step). */
  showDetails?: boolean;
}

type Tone = 'good' | 'neutral' | 'warn' | 'bad';

const TONE_CLASS: Record<Tone, string> = {
  good: 'bg-green-500/10 text-green-700 dark:text-green-400',
  neutral: 'bg-muted text-muted-foreground',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  bad: 'bg-destructive/10 text-destructive',
};

function toneFor(capability: CapabilityStatus, optedOut: boolean): Tone {
  if (optedOut) return 'neutral';
  switch (capability.state) {
    case 'ready':
      return 'good';
    case 'missing':
      return 'warn';
    case 'invalid':
      return 'bad';
    default:
      return 'neutral';
  }
}

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

/**
 * One row per capability with a status pill. Colour is never the only signal:
 * every pill carries an icon and a text label (WCAG 1.4.1).
 */
const CapabilityChecklist: React.FC<CapabilityChecklistProps> = ({
  capabilities,
  optOuts,
  showDetails = false,
}) => {
  const { t } = useLocale();
  const copy = t.setupWizard;

  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {capabilities.map((capability) => {
        const optedOut = optOuts.includes(capability.id) && capability.state !== 'ready';
        const tone = toneFor(capability, optedOut);
        const label = optedOut ? copy.state.optedOut : copy.state[capability.state];
        const info = copy.cap[capability.id];
        const source = capability.source === 'none' ? null : copy.source[capability.source];
        return (
          <li key={capability.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{info.name}</div>
              <div className="truncate text-xs text-muted-foreground">
                {showDetails && capability.modelName
                  ? `${capability.modelName}${source ? ` · ${source}` : ''}`
                  : info.desc}
              </div>
            </div>
            <span
              className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}
            >
              <StatusIcon tone={tone} />
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export default CapabilityChecklist;
