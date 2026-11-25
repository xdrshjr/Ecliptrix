'use client';

/**
 * Settings → 浏览器 (`browser_workspace` category, spec §4.7).
 *
 * Same shape as WebResearchSettingsPanel: one fetch, a dirty-tracked form, an
 * explicit Save that also fires `notifySetupConfigUpdated()` (clears the Agent's
 * blocked-call memory and refreshes the Dock's own preferences). The safety rows
 * are labelled as PREFERENCES — the real boundaries (consent, approvals, port
 * blocking) live in the desktop main process and are not editable here.
 */

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { fillCopy } from '@/lib/browserWorkspaceCopy';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import BrowserDesktopControls from '@/components/browser/BrowserDesktopControls';
import SettingsSectionCard from './components/SettingsSectionCard';
import { NumberField, SelectField, SwitchField } from './components/SettingsFieldHelpers';
import { useSettingsPanel } from './components/useSettingsPanel';

const BUTTON = 'rounded-md border border-border px-3 py-2 text-sm hover:bg-accent '
  + 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50';

export const BROWSER_SETTING_DEFAULTS = {
  enabled: true, agent_enabled: true, agent_profile_mode: 'shared', follow_agent: true,
  confirm_risky_actions: true, agent_deny_hosts: [] as string[], agent_allow_private_network: false,
  session_cookie_ttl_days: 30, max_tabs: 8, agent_max_tabs: 3, max_elements: 60,
  max_actions_per_run: 150, idle_release_seconds: 45, search_engine: 'bing',
};
type Values = typeof BROWSER_SETTING_DEFAULTS;
type NumericKey = 'session_cookie_ttl_days' | 'max_tabs' | 'agent_max_tabs' | 'max_elements'
  | 'max_actions_per_run' | 'idle_release_seconds';

/** [min, max] per numeric key — mirrors the backend clamp (§4.7 table). */
export const BROWSER_LIMITS: Record<NumericKey, readonly [number, number]> = {
  session_cookie_ttl_days: [0, 90], max_tabs: [2, 12], agent_max_tabs: [1, 5],
  max_elements: [20, 120], max_actions_per_run: [10, 500], idle_release_seconds: [15, 300],
};
const MAX_DENY_HOSTS = 100;

/** Pure: one host per line → trimmed, lower-cased, de-duplicated, capped. */
export function parseHostLines(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const host = line.trim().toLowerCase();
    if (host) seen.add(host);
  }
  return Array.from(seen).slice(0, MAX_DENY_HOSTS);
}

function valuesFrom(settings: Record<string, unknown>): Values {
  return Object.fromEntries(Object.entries(BROWSER_SETTING_DEFAULTS).map(
    ([key, fallback]) => [key, settings[key] ?? fallback])) as unknown as Values;
}

export default function BrowserWorkspaceSettingsPanel() {
  const { t } = useLocale();
  const copy = t.browserWorkspace.settings;
  const panel = useSettingsPanel('browser_workspace');
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const values = valuesFrom(panel.settings);
  const set = (key: keyof Values, value: unknown) => { setNotice(null); panel.updateSetting(key, value); };

  const save = async () => {
    const ok = await panel.saveSettings();
    if (ok) notifySetupConfigUpdated();
    setNotice({ text: ok ? copy.saved : copy.saveFailed, error: !ok });
  };
  const reset = async () => {
    const ok = await panel.resetToDefaults();
    if (ok) notifySetupConfigUpdated();
    setNotice({ text: ok ? copy.saved : copy.saveFailed, error: !ok });
  };
  const numberField = (key: NumericKey, label: string) => (
    <NumberField key={key} label={label} value={Number(values[key])}
      min={BROWSER_LIMITS[key][0]} max={BROWSER_LIMITS[key][1]}
      onChange={(value) => set(key, value)} />
  );

  if (panel.loading) return <p role="status" className="p-6">{copy.loading}</p>;
  if (panel.loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-sm text-destructive">{copy.loadFailed}</p>
        <button type="button" className={BUTTON} onClick={() => void panel.refetch()}>{copy.retry}</button>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto min-w-0 max-w-3xl space-y-5 p-4 sm:p-8 motion-reduce:[&_*]:!transition-none">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} disabled={panel.saving}
              onClick={() => void reset()}>{copy.reset}</button>
            <button type="button" className={BUTTON} disabled={panel.saving || !panel.isDirty}
              onClick={() => void save()}>{panel.saving ? copy.saving : copy.save}</button>
          </div>
        </header>
        <div aria-live="polite" role={notice?.error ? 'alert' : 'status'}
          className={notice?.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {notice?.text}
        </div>

        <SettingsSectionCard title={copy.sectionGeneral}>
          <SwitchField label={copy.enabled} checked={Boolean(values.enabled)}
            onChange={(value) => set('enabled', value)} />
          <SwitchField label={copy.agentEnabled} checked={Boolean(values.agent_enabled)}
            onChange={(value) => set('agent_enabled', value)} />
          <SelectField label={copy.agentProfileMode} value={String(values.agent_profile_mode)}
            options={[{ value: 'shared', label: copy.modeShared }, { value: 'anonymous', label: copy.modeAnonymous }]}
            onChange={(value) => set('agent_profile_mode', value)} />
          <SwitchField label={copy.followAgent} checked={Boolean(values.follow_agent)}
            onChange={(value) => set('follow_agent', value)} />
          <SelectField label={copy.searchEngine} value={String(values.search_engine)}
            options={['bing', 'google', 'baidu', 'duckduckgo'].map((id) => ({ value: id, label: id }))}
            onChange={(value) => set('search_engine', value)} />
        </SettingsSectionCard>

        <SettingsSectionCard title={copy.sectionSafety} description={copy.safetyNote}>
          <SwitchField label={copy.confirmRisky} checked={Boolean(values.confirm_risky_actions)}
            onChange={(value) => set('confirm_risky_actions', value)} />
          <SwitchField label={copy.allowPrivate} checked={Boolean(values.agent_allow_private_network)}
            onChange={(value) => set('agent_allow_private_network', value)} />
          <div className="space-y-1">
            <label htmlFor="bw-deny-hosts" className="text-sm">{copy.denyHosts}</label>
            <textarea id="bw-deny-hosts" rows={3} spellCheck={false}
              defaultValue={(values.agent_deny_hosts ?? []).join('\n')}
              onChange={(event) => set('agent_deny_hosts', parseHostLines(event.target.value))}
              className="block w-full rounded border border-border bg-background px-3 py-2 text-sm" />
            <p className="text-xs text-muted-foreground">{copy.denyHostsHint}</p>
          </div>
        </SettingsSectionCard>

        <SettingsSectionCard title={copy.sectionSession}
          description={fillCopy(t.browserWorkspace.privacy.cookie, { days: values.session_cookie_ttl_days })}>
          {numberField('session_cookie_ttl_days', copy.cookieTtl)}
          <p className="text-xs text-muted-foreground">{copy.cookieTtlHint}</p>
        </SettingsSectionCard>

        <SettingsSectionCard title={copy.sectionLimits}>
          {numberField('max_tabs', copy.maxTabs)}
          {numberField('agent_max_tabs', copy.agentMaxTabs)}
          {numberField('max_elements', copy.maxElements)}
          {numberField('max_actions_per_run', copy.maxActions)}
          {numberField('idle_release_seconds', copy.idleRelease)}
        </SettingsSectionCard>

        <BrowserDesktopControls />
      </div>
    </div>
  );
}
