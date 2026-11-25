'use client';

/**
 * BrowserUnavailable — shown inside an open Dock when the workspace cannot run
 * (spec §4.8): turned off in settings, or the main process does not answer.
 * It always offers a way forward (open settings) rather than a dead end.
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { Globe } from './browserIcons';

export default function BrowserUnavailable({ reason, onOpenSettings }: {
  reason: 'disabled' | 'unavailable';
  onOpenSettings?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.browserWorkspace.unavailable;
  return (
    <div className="bw-unavailable" role="status" data-native-inflow="true">
      <Globe size={28} strokeWidth={1.25} />
      <p className="bw-state-title">{reason === 'disabled' ? copy.disabled : copy.title}</p>
      {reason === 'unavailable' && <p className="bw-state-body">{copy.body}</p>}
      {onOpenSettings && (
        <button type="button" className="bw-btn" onClick={onOpenSettings}>{copy.openSettings}</button>
      )}
    </div>
  );
}
