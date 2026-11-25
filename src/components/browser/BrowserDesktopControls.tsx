'use client';

/**
 * BrowserDesktopControls — the settings-page parts that only exist in the desktop
 * app (spec §4.7): per-user Agent consent (view + revoke), "clear all browsing
 * data", and the diagnostics block. Consent is NEVER written through system
 * settings (R1-4) — it is read from the bridge state and revoked over IPC.
 * Every control is hidden when its bridge METHOD is missing (F15).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import {
  bridgeCan, getBrowserBridge, getBrowserDiagnostics, type BrowserWorkspaceDiagnostics,
} from '@/lib/api/browserBridge';
import type { BrowserProfileInfo } from '@/types/browserWorkspace';
import SettingsSectionCard from '@/components/settings/components/SettingsSectionCard';

const BUTTON = 'rounded-md border border-border px-3 py-2 text-sm hover:bg-accent '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

function useProfiles(): BrowserProfileInfo[] | null {
  const [profiles, setProfiles] = useState<BrowserProfileInfo[] | null>(null);
  useEffect(() => {
    const bridge = getBrowserBridge();
    if (!bridge) return undefined;
    let cancelled = false;
    bridge.state?.().then((state) => { if (!cancelled) setProfiles(state.profiles); }).catch(() => {});
    const off = bridge.onStateChanged?.((state) => setProfiles(state.profiles));
    return () => { cancelled = true; off?.(); };
  }, []);
  return profiles;
}

function Diagnostics() {
  const { t } = useLocale();
  const copy = t.browserWorkspace.settings;
  const [info, setInfo] = useState<BrowserWorkspaceDiagnostics | null>(null);
  const refresh = useCallback(() => {
    getBrowserDiagnostics().then(setInfo).catch(() => setInfo({ reachable: false }));
  }, []);
  useEffect(refresh, [refresh]);
  return (
    <SettingsSectionCard title={copy.sectionDiagnostics}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm" aria-live="polite">
        <dt className="text-muted-foreground">{copy.diagReachable}</dt>
        <dd>{info === null ? '…' : info.reachable ? copy.diagOk : copy.diagDown}</dd>
        {info?.reachable && <>
          <dt className="text-muted-foreground">{copy.diagVersion}</dt><dd>{info.version ?? '—'}</dd>
          <dt className="text-muted-foreground">{copy.diagProfiles}</dt><dd>{info.profiles ?? '—'}</dd>
          <dt className="text-muted-foreground">{copy.diagTabs}</dt><dd>{info.tabs ?? '—'}</dd>
        </>}
      </dl>
      <button type="button" className={BUTTON} onClick={refresh}>{copy.diagRefresh}</button>
    </SettingsSectionCard>
  );
}

export default function BrowserDesktopControls() {
  const { t } = useLocale();
  const copy = t.browserWorkspace.settings;
  const profiles = useProfiles();
  const [confirmingClear, setConfirmingClear] = useState(false);
  const bridge = getBrowserBridge();
  if (!bridge) {
    return <p className="text-xs text-muted-foreground" role="note">{copy.desktopOnly}</p>;
  }
  const authorised = (profiles ?? []).filter((profile) => profile.agentConsent);
  const clearAll = async () => {
    for (const profile of profiles ?? []) await bridge.profiles?.clearData?.(profile.id);
    setConfirmingClear(false);
  };

  return (
    <>
      <SettingsSectionCard title={copy.consentTitle}>
        {authorised.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.consentNone}</p>
        ) : (
          <ul className="space-y-2">
            {authorised.map((profile) => (
              <li key={profile.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{profile.name} · <span className="text-muted-foreground">{copy.consentGranted}</span></span>
                {bridgeCan(bridge, 'revokeConsent') && (
                  <button type="button" className={BUTTON}
                    onClick={() => void bridge.revokeConsent?.(profile.id)}>
                    {copy.consentRevoke}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {bridgeCan(bridge, 'profiles.clearData') && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">{copy.dataNote}</p>
            {confirmingClear ? (
              <div role="group" className="space-y-2">
                <p className="text-sm">{copy.clearAllConfirm}</p>
                <div className="flex gap-2">
                  <button type="button" className={`${BUTTON} text-destructive`}
                    onClick={() => void clearAll()}>{t.browserWorkspace.profile.confirm}</button>
                  <button type="button" className={BUTTON}
                    onClick={() => setConfirmingClear(false)}>{t.browserWorkspace.profile.cancel}</button>
                </div>
              </div>
            ) : (
              <button type="button" className={BUTTON} onClick={() => setConfirmingClear(true)}>
                {copy.clearAll}
              </button>
            )}
          </div>
        )}
      </SettingsSectionCard>
      <Diagnostics />
    </>
  );
}
