'use client';

import React, { useCallback, useId, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  ROUTER_LLM_SLOTS,
  describeRouterFailure,
  fillTemplate,
  formatLocalClock,
  testSkillRouterSlot,
  type RouterLlmSlot,
  type RouterModel,
  type SkillRouterCatalog,
  type SkillRouterPatch,
  type SkillRouterStatus,
} from '@/lib/api/skillrouter';
import type { LoadState, SaveResult } from './useSkillRouter';
import { buildSlotModelOptions } from './visionModelOptions';

export interface RouterModelSlotsProps {
  status: SkillRouterStatus;
  catalog: SkillRouterCatalog | null;
  catalogState: LoadState;
  onSave: (patch: SkillRouterPatch) => Promise<SaveResult>;
  /** `true` bypasses the 60 s cache (the "refresh models" button). */
  onRefreshCatalog: (force: boolean) => Promise<void>;
}

type SlotTest =
  | { state: 'running' }
  | { state: 'done'; ok: boolean; message: string; model: string | null; latencyMs: number | null };

interface SlotTestResultProps {
  test: SlotTest | undefined;
  fallbackModel: string;
}

/** Live region: a screen reader hears the verdict of a test it just started. */
const SlotTestResult: React.FC<SlotTestResultProps> = ({ test, fallbackModel }) => {
  const copy = useLocale().t.skillrouter.slots;
  return (
    <div role="status" aria-live="polite" className="sr-text-xs mt-2 min-h-4">
      {test?.state === 'done' && (
        <span style={{ color: test.ok ? 'var(--sr-accent)' : 'var(--sr-danger)' }}>
          <span aria-hidden="true">{test.ok ? '✓' : '✕'}</span>{' '}
          {test.ok
            ? fillTemplate(copy.testOk, {
                ms: String(test.latencyMs ?? 0),
                model: test.model ?? fallbackModel,
              })
            : `${copy.testFailed} ${test.message}`.trim()}
        </span>
      )}
    </div>
  );
};

interface SlotRowProps {
  slot: RouterLlmSlot;
  models: RouterModel[];
  selected: string;
  recommended: string | undefined;
  saving: boolean;
  test: SlotTest | undefined;
  onSelect: (slot: RouterLlmSlot, model: RouterModel) => void;
  onTest: (slot: RouterLlmSlot) => void;
}

/** The test sends a real (tiny) chat request, so it needs a model to ask. */
const SlotRow: React.FC<SlotRowProps> = ({
  slot,
  models,
  selected,
  recommended,
  saving,
  test,
  onSelect,
  onTest,
}) => {
  const { t } = useLocale();
  const copy = t.skillrouter.slots;
  const selectId = useId();
  const name = t.setupWizard.cap[slot].name;
  const known = models.some((model) => model.id === selected);
  const { options, selectedIncompatible } = buildSlotModelOptions(slot, models, selected);
  const warningId = `${selectId}-warning`;
  return (
    <li className="py-3" style={{ borderTop: '1px solid var(--sr-border)' }}>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={selectId} className="sr-text-sm w-28 flex-none font-medium">
          {name}
        </label>
        <select
          id={selectId}
          className="sr-input min-w-0 flex-1 font-mono"
          value={selected}
          disabled={saving}
          aria-busy={saving || undefined}
          aria-describedby={selectedIncompatible ? warningId : undefined}
          onChange={(event) => {
            const model = models.find((candidate) => candidate.id === event.target.value);
            if (model) onSelect(slot, model);
          }}
        >
          {!known && selected && <option value={selected}>{selected}</option>}
          {!selected && <option value="">{copy.choose}</option>}
          {options.map(({ model, disabled }) => (
            <option key={model.id} value={model.id} disabled={disabled}>
              {model.label}
              {model.id === recommended ? ` · ${copy.recommended}` : ''}
              {disabled ? ` · ${copy.chatOnly}` : ''}
            </option>
          ))}
        </select>
        {selected !== '' && selected === recommended && (
          <span className="sr-pill sr-pill--ok">{copy.recommended}</span>
        )}
        <button
          type="button"
          className="sr-btn flex-none"
          disabled={!selected || test?.state === 'running'}
          aria-busy={test?.state === 'running' || undefined}
          onClick={() => onTest(slot)}
        >
          {test?.state === 'running' ? copy.testing : copy.test}
        </button>
      </div>
      {selectedIncompatible && (
        <p id={warningId} className="sr-text-xs mt-2" style={{ color: 'var(--sr-warn)' }}>
          ▲ {copy.visionIncompatible}
        </p>
      )}
      <SlotTestResult test={test} fallbackModel={selected} />
    </li>
  );
};

const SlotsSkeleton: React.FC = () => (
  <div aria-hidden="true" className="space-y-3">
    {ROUTER_LLM_SLOTS.map((slot) => (
      <div key={slot} className="sr-skeleton h-9 w-full" />
    ))}
  </div>
);

interface CatalogProblemProps {
  title: string;
  hint: string;
  retryLabel: string;
  onRetry: () => void;
}

const CatalogProblem: React.FC<CatalogProblemProps> = ({ title, hint, retryLabel, onRetry }) => (
  <div role="status" className="sr-card text-center">
    <p className="sr-text-sm font-medium">{title}</p>
    <p className="sr-text-xs sr-muted mt-1">{hint}</p>
    <button type="button" className="sr-btn mt-3" onClick={onRetry}>
      {retryLabel}
    </button>
  </div>
);

/** Saving a pick and running a slot test, with per-slot progress. */
function useSlotActions(onSave: RouterModelSlotsProps['onSave']) {
  const { t } = useLocale();
  const [tests, setTests] = useState<Partial<Record<RouterLlmSlot, SlotTest>>>({});
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState<string | null>(null);

  const select = useCallback(
    async (slot: RouterLlmSlot, model: RouterModel) => {
      setSaveError(null);
      setSaving((current) => new Set(current).add(slot));
      const protocol = model.protocol === 'route' ? undefined : model.protocol;
      const result = await onSave({
        slotModels: { [slot]: model.id },
        ...(protocol ? { slotProtocols: { [slot]: protocol } } : {}),
      });
      setSaving((current) => {
        const next = new Set(current);
        next.delete(slot);
        return next;
      });
      if (!result.ok) setSaveError(describeRouterFailure(result.error, t).title);
    },
    [onSave, t],
  );

  const runTest = useCallback(
    async (slot: RouterLlmSlot) => {
      setTests((current) => ({ ...current, [slot]: { state: 'running' } }));
      try {
        const outcome = await testSkillRouterSlot(slot);
        setTests((current) => ({ ...current, [slot]: { state: 'done', ...outcome } }));
      } catch (failure) {
        const message = describeRouterFailure(failure, t).title;
        setTests((current) => ({
          ...current,
          [slot]: { state: 'done', ok: false, message, model: null, latencyMs: null },
        }));
      }
    },
    [t],
  );

  return { tests, saving, saveError, select, runTest };
}

/**
 * One model dropdown per LLM slot. Slots without a saved model show the
 * gateway's recommendation (what the backend would pick at runtime); choosing
 * one saves it together with its protocol so chat never needs the catalogue.
 */
const RouterModelSlots: React.FC<RouterModelSlotsProps> = ({
  status,
  catalog,
  catalogState,
  onSave,
  onRefreshCatalog,
}) => {
  const { t } = useLocale();
  const copy = t.skillrouter.slots;
  const { tests, saving, saveError, select, runTest } = useSlotActions(onSave);
  const models = catalog?.models ?? [];

  const refresh = () => void onRefreshCatalog(true);
  const defaults = catalog?.defaults ?? status.defaults;

  return (
    <div className="sr-scope">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="sr-text-xs sr-muted">
          {catalog?.stale && catalog.fetchedAt
            ? fillTemplate(copy.staleAt, { time: formatLocalClock(catalog.fetchedAt) })
            : copy.hint}
        </p>
        <button
          type="button"
          className="sr-btn"
          disabled={catalogState === 'loading'}
          aria-busy={catalogState === 'loading' || undefined}
          onClick={refresh}
        >
          {copy.refresh}
        </button>
      </div>

      {catalogState === 'loading' && !catalog && <SlotsSkeleton />}
      {catalogState === 'error' && !catalog && (
        <CatalogProblem
          title={copy.loadFailed}
          hint={copy.loadFailedHint}
          retryLabel={copy.retry}
          onRetry={refresh}
        />
      )}
      {catalog && models.length === 0 && (
        <CatalogProblem
          title={copy.emptyTitle}
          hint={copy.emptyHint}
          retryLabel={copy.retry}
          onRetry={refresh}
        />
      )}
      {models.length > 0 && (
        <ul>
          {ROUTER_LLM_SLOTS.map((slot) => (
            <SlotRow
              key={slot}
              slot={slot}
              models={models}
              selected={status.slotModels[slot] ?? defaults[slot] ?? ''}
              recommended={defaults[slot]}
              saving={saving.has(slot)}
              test={tests[slot]}
              onSelect={(target, model) => void select(target, model)}
              onTest={(target) => void runTest(target)}
            />
          ))}
        </ul>
      )}
      {saveError && (
        <p role="alert" className="sr-text-xs mt-2" style={{ color: 'var(--sr-danger)' }}>
          ✕ {saveError}
        </p>
      )}
    </div>
  );
};

export default RouterModelSlots;
