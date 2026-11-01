'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { IntegrationId, IntegrationStatus } from '@/lib/api/integrations';
import type { CapabilityId } from '@/lib/api/setupStatus';
import IntegrationCard from '@/components/integrations/IntegrationCard';
import { useIntegrations } from '@/components/integrations/useIntegrations';
import {
  INTEGRATION_GROUPS,
  type IntegrationGroupId,
} from './integrationGroups';
import StatusPill, { type Tone } from './StatusPill';
import StepHeading from './StepHeading';
import type { SetupWizardState } from './useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY, TEXT_LINK } from './wizardStyles';

interface IntegrationGroupStepProps {
  wizard: SetupWizardState;
  group: IntegrationGroupId;
}

type RowState = 'ready' | 'missing' | 'invalid' | 'optedOut';

/** Partially filled = some required field is set but not all of them. */
function isPartial(item: IntegrationStatus): boolean {
  const required = item.fields.filter((field) => field.required);
  const filled = required.filter((field) => field.configured);
  return filled.length > 0 && filled.length < required.length;
}

function rowState(item: IntegrationStatus, optOuts: readonly CapabilityId[]): RowState {
  if (item.usable) return 'ready';
  if (item.capabilities.every((id) => optOuts.includes(id))) return 'optedOut';
  return isPartial(item) ? 'invalid' : 'missing';
}

const ROW_TONE: Record<RowState, Tone> = {
  ready: 'good',
  missing: 'warn',
  invalid: 'bad',
  optedOut: 'neutral',
};

const isUnresolved = (state: RowState) => state === 'missing' || state === 'invalid';

interface GroupRowProps {
  item: IntegrationStatus;
  state: RowState;
  expanded: boolean;
  wizard: SetupWizardState;
  onToggle: () => void;
  onChanged: () => Promise<void>;
  onSettled: () => void;
}

const Chevron: React.FC<{ open: boolean }> = ({ open }) => (
  <svg
    className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3.5l4.5 4.5L6 12.5" />
  </svg>
);

// Over the 50-line function guideline on purpose: the row is one JSX tree
// (summary + actions + panel); splitting it would only move markup around.
/** One accordion row: summary (toggle + status + actions) and, open, the card. */
const GroupRow: React.FC<GroupRowProps> = ({
  item,
  state,
  expanded,
  wizard,
  onToggle,
  onChanged,
  onSettled,
}) => {
  const { t } = useLocale();
  const copy = t.integrations;
  const panelId = `integration-panel-${item.id}`;
  const info = copy[item.id];
  const canExpand = state !== 'ready' || wizard.mode === 'manual';
  const { reportIntegrationDraft } = wizard;

  const reportDraft = useCallback(
    (hasDraft: boolean) => reportIntegrationDraft(item.id, hasDraft),
    [reportIntegrationDraft, item.id],
  );
  // A card that unmounts (step change, collapse) takes its draft with it.
  useEffect(() => () => reportIntegrationDraft(item.id, false), [reportIntegrationDraft, item.id]);

  const summary = (
    <>
      {canExpand && <Chevron open={expanded} />}
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium text-foreground">{info.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {state === 'ready' && item.source !== 'none'
            ? `${info.desc} · ${copy.source[item.source]}`
            : info.desc}
        </span>
      </span>
    </>
  );

  return (
    <li className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        {canExpand ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {summary}
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">{summary}</div>
        )}
        <StatusPill tone={ROW_TONE[state]} label={t.setupWizard.state[state]} />
        <RowActions item={item} state={state} expanded={expanded} wizard={wizard} onToggle={onToggle} />
      </div>
      {expanded && (
        <div id={panelId} role="region" aria-label={info.name} className="border-t border-border px-4 py-4">
          <IntegrationCard
            integration={item}
            onChanged={onChanged}
            onDraftChange={reportDraft}
            onContinueAnyway={onSettled}
            autoFocus
          />
        </div>
      )}
    </li>
  );
};

interface RowActionsProps {
  item: IntegrationStatus;
  state: RowState;
  expanded: boolean;
  wizard: SetupWizardState;
  onToggle: () => void;
}

/** Right-hand buttons of a row; which ones show depends on the row's state. */
const RowActions: React.FC<RowActionsProps> = ({ item, state, expanded, wizard, onToggle }) => {
  const copy = useLocale().t.integrations.action;
  const name = useLocale().t.integrations[item.id].name;

  if (state === 'optedOut') {
    return (
      <button
        type="button"
        onClick={() => {
          wizard.reenable(item.capabilities);
          if (!expanded) onToggle();
        }}
        aria-label={`${copy.configure} ${name}`}
        className={TEXT_LINK}
      >
        {copy.configure}
      </button>
    );
  }
  if (state === 'ready') {
    return wizard.mode === 'manual' && !expanded ? (
      <button type="button" onClick={onToggle} aria-label={`${copy.change} ${name}`} className={TEXT_LINK}>
        {copy.change}
      </button>
    ) : null;
  }
  return (
    <span className="flex items-center gap-3">
      {!expanded && (
        <button type="button" onClick={onToggle} aria-label={`${copy.configure} ${name}`} className={TEXT_LINK}>
          {copy.configure}
        </button>
      )}
      <button
        type="button"
        onClick={() => wizard.optOut(item.capabilities)}
        aria-label={`${copy.skip} ${name}`}
        className={`${TEXT_LINK} text-muted-foreground`}
      >
        {copy.skip}
      </button>
    </span>
  );
};

/**
 * One wizard step for a family of related credentials (voice, AI generation,
 * material libraries): a single-open accordion of {@link IntegrationCard}s.
 * Every optional item must be configured or explicitly declined, never skipped
 * by accident, but a "later" exit keeps the step from becoming a trap.
 *
 * Over the 50-line function guideline on purpose: the derived row states and the
 * accordion handlers share one closure over the loaded list.
 */
const IntegrationGroupStep: React.FC<IntegrationGroupStepProps> = ({ wizard, group }) => {
  const { t } = useLocale();
  const copy = t.integrations;
  const { integrations, loadState, reload } = useIntegrations();
  const [expanded, setExpanded] = useState<IntegrationId | null | undefined>(undefined);

  const items = INTEGRATION_GROUPS[group]
    .map((id) => integrations.find((candidate) => candidate.id === id))
    .filter((item): item is IntegrationStatus => item !== undefined);
  const states = new Map(items.map((item) => [item.id, rowState(item, wizard.optOuts)]));
  const unresolved = items.filter((item) => isUnresolved(states.get(item.id) as RowState));

  /** The first unresolved row other than `except`, or none. */
  const nextGap = (except?: IntegrationId): IntegrationId | null =>
    unresolved.find((item) => item.id !== except)?.id ?? null;

  useEffect(() => {
    if (loadState !== 'ready' || expanded !== undefined) return;
    const focused = items.find((item) => item.id === wizard.focus);
    setExpanded(focused ? focused.id : unresolved[0]?.id ?? null);
  }, [loadState, expanded, items, unresolved, wizard.focus]);

  const toggle = (id: IntegrationId) =>
    setExpanded((current) => (current === id ? null : id));

  const skipGroup = () => {
    wizard.optOut(unresolved.flatMap((item) => item.capabilities));
    setExpanded(null);
  };

  const info = t.setupWizard.group[group];

  return (
    <div>
      <StepHeading title={info.title} description={info.desc} />

      {loadState === 'loading' && (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          {copy.panel.loading}
        </p>
      )}
      {loadState === 'error' && (
        <div role="alert" className="mt-6 flex items-center gap-3 text-sm text-destructive">
          {copy.panel.loadFailed}
          <button type="button" onClick={() => void reload()} className={TEXT_LINK}>
            {copy.panel.retry}
          </button>
        </div>
      )}

      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <GroupRow
            key={item.id}
            item={item}
            state={states.get(item.id) as RowState}
            expanded={expanded === item.id}
            wizard={wizard}
            onToggle={() => toggle(item.id)}
            onChanged={reload}
            onSettled={() => setExpanded(nextGap(item.id))}
          />
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={wizard.goBack} className={BUTTON_GHOST}>
          {t.setupWizard.back}
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {unresolved.length > 0 && (
            <button type="button" onClick={skipGroup} className={BUTTON_GHOST}>
              {copy.action.skipGroup}
            </button>
          )}
          <button type="button" onClick={wizard.goNext} className={BUTTON_PRIMARY}>
            {unresolved.length > 0 ? copy.action.continueLater : copy.action.continueNext}
          </button>
        </div>
      </div>
    </div>
  );
};

export default IntegrationGroupStep;
