'use client';

import React, { useId, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import GetCredentialLink from '@/components/integrations/GetCredentialLink';
import type { SkillRouterStatus, SkillRouterVerifyResult } from '@/lib/api/skillrouter';
import RouterVerifyResult from './RouterVerifyResult';
import { useRouterConnect, type ConnectPhase } from './useRouterConnect';

export interface RouterConnectCardProps {
  status: SkillRouterStatus;
  /** Called with the saved status once `mode: 'router'` is persisted. */
  onSaved: (status: SkillRouterStatus) => void;
  /** Verify automatically ~600 ms after a paste (default true). */
  autoVerify?: boolean;
  onVerified?: (result: SkillRouterVerifyResult) => void;
  /** Fires when an unsaved key appears or is cleared. */
  onDraftChange?: (hasDraft: boolean) => void;
}

const KEY_PREFIX = 'ar-';

interface KeyFieldProps {
  inputId: string;
  describedBy: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onPaste: () => void;
}

/** Masked by default; the toggle only changes the local display. */
const KeyField: React.FC<KeyFieldProps> = ({
  inputId,
  describedBy,
  value,
  placeholder,
  invalid,
  disabled,
  onChange,
  onPaste,
}) => {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={inputId}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onPaste={onPaste}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={`sr-input font-mono ${invalid ? 'sr-input--invalid' : ''}`}
      />
      <button
        type="button"
        className="sr-btn flex-none"
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? t.setupWizard.hideKey : t.setupWizard.showKey}
      </button>
    </div>
  );
};

interface AdvancedBaseUrlProps {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

const AdvancedBaseUrl: React.FC<AdvancedBaseUrlProps> = ({ value, disabled, onChange }) => {
  const copy = useLocale().t.skillrouter.connect;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="mt-3">
      <button
        type="button"
        className="sr-link"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? '▾' : '▸'} {copy.advanced}
      </button>
      {open && (
        <div id={panelId} className="mt-2">
          <label className="sr-text-xs sr-muted mb-1 block" htmlFor={`${panelId}-input`}>
            {copy.baseUrlLabel}
          </label>
          <input
            id={`${panelId}-input`}
            type="url"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            className="sr-input font-mono"
          />
          <p className="sr-text-xs sr-muted mt-1">{copy.baseUrlHint}</p>
        </div>
      )}
    </div>
  );
};

/** Outcomes where saving first and checking later is a sensible choice. */
const SAVE_LATER_OUTCOMES: ReadonlySet<string> = new Set([
  'unreachable',
  'upstream_error',
  'unverifiable',
]);

interface ActionsProps {
  phase: ConnectPhase;
  canVerify: boolean;
  outcome: SkillRouterVerifyResult['outcome'] | null;
  hasInput: boolean;
  onVerify: () => void;
  onSave: () => void;
}

const ConnectActions: React.FC<ActionsProps> = ({
  phase,
  canVerify,
  outcome,
  hasInput,
  onVerify,
  onSave,
}) => {
  const copy = useLocale().t.skillrouter.connect;
  const busy = phase !== 'idle';
  const canSaveLater = outcome !== null && SAVE_LATER_OUTCOMES.has(outcome);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {outcome === 'ok' ? (
        <button
          type="button"
          className="sr-btn-primary"
          disabled={busy}
          aria-busy={phase === 'saving'}
          onClick={onSave}
        >
          {phase === 'saving' ? copy.saving : copy.saveAndUse}
        </button>
      ) : (
        <button
          type="button"
          className="sr-btn-primary"
          disabled={busy || !canVerify}
          aria-busy={phase === 'verifying'}
          onClick={onVerify}
        >
          {phase === 'verifying' ? copy.verifying : hasInput ? copy.verify : copy.verifySaved}
        </button>
      )}
      {canSaveLater && (
        <button type="button" className="sr-btn" disabled={busy} onClick={onSave}>
          {copy.saveLater}
        </button>
      )}
    </div>
  );
};

const ConnectHeader: React.FC<{ titleId: string }> = ({ titleId }) => {
  const copy = useLocale().t.skillrouter.connect;
  return (
    <header>
      <h3 id={titleId} className="sr-heading">
        {copy.title}
      </h3>
      <p className="sr-text-sm sr-muted mt-1">{copy.noAccount}</p>
      <GetCredentialLink
        id="skillrouter_register"
        label={copy.register}
        showDocs={false}
        showActivation={false}
        className="mt-2"
      />
      <p className="sr-text-xs sr-muted mt-1">{copy.registerHint}</p>
    </header>
  );
};

interface KeySectionProps {
  idPrefix: string;
  status: SkillRouterStatus;
  connect: ReturnType<typeof useRouterConnect>;
}

const KeySection: React.FC<KeySectionProps> = ({ idPrefix, status, connect }) => {
  const copy = useLocale().t.skillrouter.connect;
  const busy = connect.phase !== 'idle';
  const softPrefixHint = connect.key !== '' && !connect.key.startsWith(KEY_PREFIX);
  return (
    <div>
      <label htmlFor={`${idPrefix}-key`} className="sr-text-sm mb-1 block font-medium">
        {copy.keyLabel}
      </label>
      {connect.hasSavedKey && connect.key === '' && (
        <p className="sr-text-xs sr-muted mb-1">
          {copy.savedKey} {status.keyHint}
        </p>
      )}
      <KeyField
        inputId={`${idPrefix}-key`}
        describedBy={`${idPrefix}-key-hint`}
        value={connect.key}
        placeholder={copy.keyPlaceholder}
        invalid={connect.error !== null}
        disabled={busy}
        onChange={connect.setKey}
        onPaste={connect.markPasted}
      />
      <p id={`${idPrefix}-key-hint`} className="sr-text-xs sr-muted mt-1">
        {softPrefixHint ? copy.prefixHint : copy.keyHint}
      </p>
      <AdvancedBaseUrl value={connect.baseUrl} disabled={busy} onChange={connect.setBaseUrl} />
    </div>
  );
};

/**
 * Sign-up pointer, masked key field, zero-cost verification and the save that
 * switches the app to the AI relay. Shared by the setup wizard and settings.
 */
const RouterConnectCard: React.FC<RouterConnectCardProps> = ({
  status,
  onSaved,
  autoVerify = true,
  onVerified,
  onDraftChange,
}) => {
  const copy = useLocale().t.skillrouter.connect;
  const ids = useId();
  const connect = useRouterConnect({ status, onSaved, onVerified, autoVerify, onDraftChange });

  return (
    <section className="sr-scope" aria-labelledby={`${ids}-title`}>
      <div className="sr-card space-y-4">
        <ConnectHeader titleId={`${ids}-title`} />
        <KeySection idPrefix={ids} status={status} connect={connect} />
        {connect.error && (
          <div role="alert" className="sr-text-sm" style={{ color: 'var(--sr-danger)' }}>
            <p className="font-medium">✕ {connect.error.title}</p>
            <p className="sr-muted mt-1">{connect.error.hint}</p>
          </div>
        )}
        {connect.result && <RouterVerifyResult result={connect.result} />}
        <ConnectActions
          phase={connect.phase}
          canVerify={connect.canVerify}
          outcome={connect.result?.outcome ?? null}
          hasInput={connect.key !== ''}
          onVerify={() => void connect.verify()}
          onSave={() => void connect.save()}
        />
        <p className="sr-text-xs sr-muted">{copy.privacy}</p>
      </div>
    </section>
  );
};

export default RouterConnectCard;
