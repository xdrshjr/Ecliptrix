'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import { CHECKLIST_GROUP_ORDER, checklistGroupOf } from './integrationGroups';
import StatusPill, { type Tone } from './StatusPill';

interface CapabilityChecklistProps {
  capabilities: CapabilityStatus[];
  optOuts: readonly CapabilityId[];
  /** Include the model name + source badge (done step). */
  showDetails?: boolean;
}

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

interface RowProps {
  capability: CapabilityStatus;
  optedOut: boolean;
  showDetails: boolean;
}

/** One capability: name + hint on the left, a status pill on the right. */
const CapabilityRow: React.FC<RowProps> = ({ capability, optedOut, showDetails }) => {
  const copy = useLocale().t.setupWizard;
  const tone = toneFor(capability, optedOut);
  const label = optedOut ? copy.state.optedOut : copy.state[capability.state];
  const info = copy.cap[capability.id] ?? { name: capability.id, desc: '' };
  const source = capability.source === 'none' ? null : copy.source[capability.source];
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{info.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {showDetails && capability.modelName
            ? `${capability.modelName}${source ? ` · ${source}` : ''}`
            : info.desc}
        </div>
      </div>
      <StatusPill tone={tone} label={label} />
    </li>
  );
};

/**
 * Capabilities grouped by what the user thinks they are configuring (models /
 * voice / AI generation / libraries / search), one status pill per row. Colour
 * is never the only signal: every pill carries an icon and a text label
 * (WCAG 1.4.1).
 */
const CapabilityChecklist: React.FC<CapabilityChecklistProps> = ({
  capabilities,
  optOuts,
  showDetails = false,
}) => {
  const copy = useLocale().t.setupWizard;

  return (
    <div className="space-y-4">
      {CHECKLIST_GROUP_ORDER.map((group) => {
        const rows = capabilities.filter((item) => checklistGroupOf(item.id) === group);
        if (rows.length === 0) return null;
        const headingId = `setup-checklist-${group}`;
        return (
          <section key={group} aria-labelledby={headingId}>
            <h3
              id={headingId}
              className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {copy.group[group].title}
            </h3>
            <ul className="divide-y divide-border rounded-xl border border-border">
              {rows.map((capability) => (
                <CapabilityRow
                  key={capability.id}
                  capability={capability}
                  optedOut={optOuts.includes(capability.id) && capability.state !== 'ready'}
                  showDetails={showDetails}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

export default CapabilityChecklist;
