'use client';

/**
 * SaveStatusIndicator — project persistence state only (spec §3.2). AI
 * generation results never show here: "project saved" and "AI finished" are
 * different facts. Fixed width so the label swap never shifts the top bar.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from './icons';
import { useLocale } from '@/contexts/LocaleContext';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SaveStatusIndicatorProps {
  status: SaveStatus;
  lastSavedAt: number | null;
  onRetry(): void;
}

const ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true } as const;

const SaveStatusIndicator: React.FC<SaveStatusIndicatorProps> = ({ status, lastSavedAt, onRetry }) => {
  const { t } = useLocale();
  const copy = t.workbench.topBar;

  if (status === 'error') {
    // The polite status region below unmounts on error; role="alert" keeps
    // the failure announced to screen readers.
    return (
      <span role="alert">
        <button type="button" className="ws-save-status ws-btn--ghost" data-status="error"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
          title={copy.saveErrorRetry} aria-label={copy.saveErrorRetry} onClick={onRetry}>
          <AlertTriangle {...ICON} />
          <span>{copy.saveError}</span>
        </button>
      </span>
    );
  }

  const savedTitle = status === 'saved' && lastSavedAt
    ? copy.savedAt.replace('{time}', new Date(lastSavedAt).toLocaleTimeString())
    : undefined;
  return (
    <span className="ws-save-status" data-status={status} role="status" aria-live="polite"
      title={savedTitle}>
      {status === 'saving' && <Loader2 {...ICON} className="animate-spin" />}
      {status === 'saved' && <CheckCircle2 {...ICON} />}
      {status === 'idle' && <Circle {...ICON} />}
      <span>
        {status === 'saving' && copy.saving}
        {status === 'saved' && copy.saved}
        {status === 'idle' && copy.idle}
      </span>
    </span>
  );
};

export default SaveStatusIndicator;
