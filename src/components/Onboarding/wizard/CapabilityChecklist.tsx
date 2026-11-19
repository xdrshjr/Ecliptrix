'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import { CHECKLIST_GROUP_ORDER, checklistGroupOf } from './integrationGroups';
import StatusPill, { type Tone } from './StatusPill';
import { TEXT_LINK } from './wizardStyles';

interface CapabilityChecklistProps {
  capabilities: CapabilityStatus[];
  optOuts: readonly CapabilityId[];
  /** Include the model name + source badge (done step). */
  showDetails?: boolean;
  /**
   * Offered on rows the relay has switched off: move that capability to the
   * user's own configuration. Rejects when the write fails.
   */
  onUseOwnConfig?: (capability: CapabilityId) => Promise<void>;
}

function toneFor(capability: CapabilityStatus, optedOut: boolean): Tone {
  if (optedOut) return 'neutral';
  switch (capability.state) {
    case 'ready':
      return 'good';
    case 'missing':
    case 'unavailable':
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
  onUseOwnConfig?: (capability: CapabilityId) => Promise<void>;
}

/** A ready row served by the relay reads "Ready · via SkillRouter". */
function pillLabel(
  copy: ReturnType<typeof useLocale>['t']['setupWizard'],
  capability: CapabilityStatus,
  optedOut: boolean,
): string {
  if (optedOut) return copy.state.optedOut;
  if (capability.state === 'ready' && capability.source === 'router') {
    return copy.state.readyRouter;
  }
  return copy.state[capability.state];
}

/** The relay switched the capability off: one button hands it back to the user. */
const UseOwnConfigButton: React.FC<{
  capability: CapabilityStatus;
  onUseOwnConfig: (capability: CapabilityId) => Promise<void>;
}> = ({ capability, onUseOwnConfig }) => {
  const copy = useLocale().t.setupWizard;
  const [phase, setPhase] = useState<'idle' | 'busy' | 'failed'>('idle');
  const name = copy.cap[capability.id].name;

  const run = async () => {
    setPhase('busy');
    try {
      await onUseOwnConfig(capability.id);
    } catch {
      setPhase('failed');
    }
  };

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => void run()}
        disabled={phase === 'busy'}
        aria-busy={phase === 'busy'}
        aria-label={`${copy.routedByRouter.useOwn}: ${name}`}
        className={TEXT_LINK}
      >
        {phase === 'busy' ? copy.routedByRouter.useOwnBusy : copy.routedByRouter.useOwn}
      </button>
      <span role="status" aria-live="polite" className="ml-2 text-xs text-destructive">
        {phase === 'failed' ? copy.routedByRouter.useOwnFailed : ''}
      </span>
    </div>
  );
};

/** One capability: name + hint on the left, a status pill on the right. */
const CapabilityRow: React.FC<RowProps> = ({
  capability,
  optedOut,
  showDetails,
  onUseOwnConfig,
}) => {
  const copy = useLocale().t.setupWizard;
  const tone = toneFor(capability, optedOut);
  const info = copy.cap[capability.id] ?? { name: capability.id, desc: '' };
  const source = capability.source === 'none' ? null : copy.source[capability.source];
  const isUnavailable = capability.state === 'unavailable' && !optedOut;
  const description = isUnavailable
    ? copy.routedByRouter.unavailableDesc
    : showDetails && capability.modelName
      ? `${capability.modelName}${source ? ` · ${source}` : ''}`
      : info.desc;
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{info.name}</div>
        <div className="truncate text-xs text-muted-foreground">{description}</div>
        {isUnavailable && onUseOwnConfig && (
          <UseOwnConfigButton capability={capability} onUseOwnConfig={onUseOwnConfig} />
        )}
      </div>
      <StatusPill tone={tone} label={pillLabel(copy, capability, optedOut)} />
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
  onUseOwnConfig,
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
                  onUseOwnConfig={onUseOwnConfig}
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
