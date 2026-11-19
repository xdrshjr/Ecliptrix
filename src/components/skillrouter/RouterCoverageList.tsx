'use client';

import React, { useCallback, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { CapabilityId } from '@/lib/api/setupStatus';
import {
  GATEWAY_CAPABILITY_OF,
  MANUAL_ONLY_CAPABILITIES,
  ROUTED_CAPABILITIES,
  describeRouterFailure,
  type ManualOnlyCapabilityId,
  type RoutedCapabilityId,
  type RouterCapabilityStatus,
  type SkillRouterPatch,
  type SkillRouterStatus,
} from '@/lib/api/skillrouter';
import RouterQuotaMeter from './RouterQuotaMeter';
import type { SaveResult } from './useSkillRouter';

export interface RouterCoverageListProps {
  status: SkillRouterStatus;
  /** Gateway capabilities (availability + quota), from the catalogue. */
  capabilities: RouterCapabilityStatus[];
  /** Optimistic save from `useSkillRouter`; a failed save rolls itself back. */
  onSave: (patch: SkillRouterPatch) => Promise<SaveResult>;
}

type SourceChoice = 'router' | 'manual';
type ListedCapability = RoutedCapabilityId | ManualOnlyCapabilityId;

interface CapabilityGroup {
  id: 'models' | 'voice' | 'generation' | 'media' | 'search';
  items: ListedCapability[];
}

/** Same grouping the setup wizard uses, so both screens read alike. */
const GROUPS: readonly CapabilityGroup[] = [
  { id: 'models', items: ['chat', 'fast', 'video_cut', 'vision', 'research'] },
  { id: 'voice', items: ['tts', 'asr', 'voice_clone'] },
  { id: 'generation', items: ['ai_image', 'ai_video'] },
  { id: 'media', items: ['video_library', 'image_library', 'audio_library'] },
  { id: 'search', items: ['web_search'] },
];

const MANUAL_ONLY_SET: ReadonlySet<string> = new Set(MANUAL_ONLY_CAPABILITIES);

function isManualOnly(id: ListedCapability): id is ManualOnlyCapabilityId {
  return MANUAL_ONLY_SET.has(id);
}

interface SourceSwitchProps {
  name: string;
  value: SourceChoice;
  disabled: boolean;
  busy: boolean;
  onChange: (next: SourceChoice) => void;
}

const CHOICES: readonly SourceChoice[] = ['router', 'manual'];

/** Two-option radio group: arrow keys move and select, Tab leaves the row. */
const SourceSwitch: React.FC<SourceSwitchProps> = ({ name, value, disabled, busy, onChange }) => {
  const copy = useLocale().t.skillrouter.coverage;
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const arrows = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (disabled || busy || !arrows.includes(event.key)) return;
    event.preventDefault();
    const next = value === 'router' ? 'manual' : 'router';
    onChange(next);
    (event.currentTarget.parentElement?.querySelector(
      `[data-choice="${next}"]`,
    ) as HTMLButtonElement | null)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={`${name} · ${copy.sourceLabel}`}
      aria-busy={busy || undefined}
      className="sr-seg flex-none"
    >
      {CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          data-choice={choice}
          aria-checked={value === choice}
          tabIndex={value === choice ? 0 : -1}
          disabled={disabled || busy}
          onClick={() => value !== choice && onChange(choice)}
          onKeyDown={onKeyDown}
        >
          {copy.source[choice]}
        </button>
      ))}
    </div>
  );
};

interface RowStatusProps {
  routed: boolean;
  manualOnly: boolean;
  entry: RouterCapabilityStatus | undefined;
}

/** Icon + sentence for one row; colour only reinforces it. */
const RowStatus: React.FC<RowStatusProps> = ({ routed, manualOnly, entry }) => {
  const copy = useLocale().t.skillrouter.coverage;
  if (manualOnly) return <span className="sr-muted">{copy.manualOnlyNote}</span>;
  if (!routed) return <span className="sr-muted">{copy.usingOwn}</span>;
  if (entry && !entry.available) {
    return (
      <span style={{ color: 'var(--sr-warn)' }}>
        <span aria-hidden="true">▲</span> {copy.unavailable}
        {entry.unavailableReason ? ` (${entry.unavailableReason})` : ''}
      </span>
    );
  }
  return (
    <span style={{ color: 'var(--sr-accent)' }}>
      <span aria-hidden="true">✓</span> {copy.viaRouter}
    </span>
  );
};

interface RowProps {
  id: ListedCapability;
  routed: boolean;
  entry: RouterCapabilityStatus | undefined;
  busy: boolean;
  error: string | null;
  onChange: (id: RoutedCapabilityId, next: SourceChoice) => void;
}

const CapabilityRow: React.FC<RowProps> = ({ id, routed, entry, busy, error, onChange }) => {
  const { t } = useLocale();
  const manualOnly = isManualOnly(id);
  const name = t.setupWizard.cap[id as CapabilityId].name;
  return (
    <li className="py-3" style={{ borderTop: '1px solid var(--sr-border)' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="sr-text-sm font-medium">{name}</p>
          <p className="sr-text-xs mt-0.5">
            <RowStatus routed={routed} manualOnly={manualOnly} entry={entry} />
          </p>
        </div>
        <SourceSwitch
          name={name}
          value={routed ? 'router' : 'manual'}
          disabled={manualOnly}
          busy={busy}
          onChange={(next) => !manualOnly && onChange(id as RoutedCapabilityId, next)}
        />
      </div>
      {routed && !manualOnly && <RouterQuotaMeter quota={entry?.quota} className="mt-2" />}
      {error && (
        <p role="alert" className="sr-text-xs mt-2" style={{ color: 'var(--sr-danger)' }}>
          ✕ {error}
        </p>
      )}
    </li>
  );
};

/** Keep the stored list in a stable order so equal choices serialise equally. */
function withCapability(
  current: readonly RoutedCapabilityId[],
  id: RoutedCapabilityId,
  useOwn: boolean,
): RoutedCapabilityId[] {
  const rest = current.filter((item) => item !== id);
  const next = useOwn ? [...rest, id] : rest;
  return ROUTED_CAPABILITIES.filter((item) => next.includes(item));
}

/**
 * Per-capability source switch (relay | own configuration). Each change is
 * saved immediately through `onSave`; on failure the row reverts and shows why.
 */
const RouterCoverageList: React.FC<RouterCoverageListProps> = ({ status, capabilities, onSave }) => {
  const { t } = useLocale();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const change = useCallback(
    async (id: RoutedCapabilityId, next: SourceChoice) => {
      setPending((current) => new Set(current).add(id));
      setErrors((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      const manualCapabilities = withCapability(status.manualCapabilities, id, next === 'manual');
      const result = await onSave({ manualCapabilities });
      setPending((current) => {
        const copy = new Set(current);
        copy.delete(id);
        return copy;
      });
      if (!result.ok) {
        const message = describeRouterFailure(result.error, t).title;
        setErrors((current) => ({ ...current, [id]: message }));
      }
    },
    [onSave, status.manualCapabilities, t],
  );

  return (
    <div className="sr-scope space-y-6">
      {GROUPS.map((group) => (
        <section key={group.id} aria-label={t.setupWizard.group[group.id].title}>
          <h4 className="sr-text-xs sr-muted mb-1 font-semibold uppercase tracking-wider">
            {t.setupWizard.group[group.id].title}
          </h4>
          <ul>
            {group.items.map((id) => {
              const gatewayId = isManualOnly(id) ? undefined : GATEWAY_CAPABILITY_OF[id];
              return (
                <CapabilityRow
                  key={id}
                  id={id}
                  routed={!isManualOnly(id) && !status.manualCapabilities.includes(id)}
                  entry={gatewayId ? capabilities.find((c) => c.id === gatewayId) : undefined}
                  busy={pending.has(id)}
                  error={errors[id] ?? null}
                  onChange={change}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default RouterCoverageList;
