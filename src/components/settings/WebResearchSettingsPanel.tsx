'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { ApiError, RateLimitError, TimeoutError } from '@/lib/api/http-client';
import { resolveResearchStatus } from '@/lib/webResearchStatus';
import {
  getWebResearchCapabilities, saveResearchCredentials,
  saveWebResearchSettings, testResearchConnection,
} from '@/lib/api/webResearch';
import type { WebResearchCapabilities, WebResearchSettings }
  from '@/types/webResearch';
import SettingsSectionCard from './components/SettingsSectionCard';
import { SwitchField } from './components/SettingsFieldHelpers';
import { useSettingsPanel } from './components/useSettingsPanel';

const DEFAULTS: WebResearchSettings = {
  enabled: true, browser_enabled: true, downloads_enabled: true,
  respect_robots: true, use_research_model: false,
  // v2 R-V2-04：默认与 agent.ts 历史硬编码 128000 持平。
  context_window_tokens: 128000,
  // v2 R-V2-03：研究窗口 32768 与整合输入推导上限匹配。
  research_context_window_tokens: 32768,
  global_concurrency: 3, max_sources: 4,
  proxy_mode: 'auto', custom_proxy_url: '',
  artifact_retention_days: 7,
};
type SegmentKey = 'search' | 'browser' | 'downloads';
const SEGMENTS: SegmentKey[] = ['search', 'browser', 'downloads'];
const PROXY_MODES = ['auto', 'direct', 'custom'] as const;
const EGRESS_KEYS = {
  settings: 'egressSettings', env: 'egressEnv', system: 'egressSystem',
  direct: 'egressDirect', invalid: 'egressInvalid',
} as const;
const BUTTON = 'rounded-md border border-border px-3 py-2 text-sm ' +
  'hover:bg-accent focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-primary disabled:opacity-50';
const LIMITS = {
  context_window_tokens: [16384, 1048576, 'mainContext'],
  research_context_window_tokens: [4096, 1048576, 'researchContext'],
  global_concurrency: [1, 3, 'concurrency'],
  max_sources: [2, 5, 'sources'],
  artifact_retention_days: [1, 30, 'retention'],
} as const;

function settingsValues(settings: Record<string, unknown>) {
  // GET 中凭证只有脱敏状态，不能把它写回普通批量端点。
  return Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) =>
    [key, settings[key] ?? value])) as unknown as WebResearchSettings;
}

function BudgetField({ settingKey, value, disabled, onChange }: {
  settingKey: keyof typeof LIMITS; value: number; disabled: boolean;
  onChange: (value: number) => void;
}) {
  const { t } = useLocale();
  const [min, max, label] = LIMITS[settingKey];
  const invalid = !Number.isInteger(value) || value < min || value > max;
  const id = `research-${settingKey}`;
  return <div className="space-y-1">
    <label htmlFor={id} className="text-sm">{t.webResearch[label]}</label>
    <input id={id} type="number" min={min} max={max} step={1}
      value={Number.isNaN(value) ? '' : value} disabled={disabled}
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? `${id}-error` : undefined}
      onChange={event => onChange(event.target.value === ''
        ? NaN : Number(event.target.value))}
      className="block w-full rounded border border-border bg-background px-3 py-2 text-sm disabled:opacity-50" />
    {invalid && <p id={`${id}-error`} className="text-xs text-destructive">
      {t.webResearch.invalidNumber.replace('{min}', String(min))
        .replace('{max}', String(max))}
    </p>}
  </div>;
}

export default function WebResearchSettingsPanel({ onOpenModels }: {
  onOpenModels?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.webResearch;
  const panel = useSettingsPanel('web_research');
  const [capabilities, setCapabilities] =
    useState<WebResearchCapabilities | null>(null);
  const [capabilityFailed, setCapabilityFailed] = useState(false);
  const capabilityRequest = useRef(0);
  const [keys, setKeys] = useState('');
  const [keyCount, setKeyCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [hasError, setHasError] = useState(false);
  const [keyError, setKeyError] = useState(false);
  const [testCooldown, setTestCooldown] = useState(false);
  const [testing, setTesting] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const values = settingsValues(panel.settings);
  // 代理地址仅 http(s)://host:port，可含认证 userinfo（本地保存，不回显）。
  const proxyUrlInvalid = values.proxy_mode === 'custom' &&
    !/^https?:\/\/[^\s@]+@[^\s@]+:\d{1,5}$/.test(values.custom_proxy_url) &&
    !/^https?:\/\/[^\s@]+:\d{1,5}$/.test(values.custom_proxy_url);
  const refreshCapabilities = useCallback(async () => {
    const request = ++capabilityRequest.current;
    try {
      const result = await getWebResearchCapabilities();
      if (request !== capabilityRequest.current) return;
      setCapabilities(result);
      setKeyCount(result.search.key_count ??
        (result.search.configured ? 1 : 0));
      setCapabilityFailed(false);
    } catch {
      if (request === capabilityRequest.current) {
        setCapabilities(null);
        setCapabilityFailed(true);
      }
    }
  }, []);
  useEffect(() => {
    void refreshCapabilities();
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, [refreshCapabilities]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice('');
    setHasError(false);
    try { await action(); }
    catch { setHasError(true); setNotice(copy.failed); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveCredentials = (clear: boolean) => {
    const entries = clear ? [] : keys.split(/[,\n]+/).map(k => k.trim())
      .filter(Boolean);
    if (!clear && (!entries.length || entries.length > 5 ||
      entries.some(k => k.length > 512))) {
      setKeyError(true);
      return;
    }
    setKeyError(false);
    void run(async () => {
      const status = await saveResearchCredentials(entries);
      setKeys('');
      await refreshCapabilities();
      setKeyCount(status.key_count);
      setNotice(clear ? copy.credentialsCleared : copy.credentialsSaved);
    });
  };
  const saveSettings = () => void run(async () => {
    const result = await saveWebResearchSettings(values);
    if (!result.success) throw new Error('settings_save_failed');
    await panel.refetch();
    await refreshCapabilities();
    setNotice(copy.saved);
  });
  const resetSettings = () => void run(async () => {
    if (!await panel.resetToDefaults()) throw new Error('reset_failed');
    setKeys('');
    setKeyError(false);
    await refreshCapabilities();
    setNotice(copy.resetDone);
  });
  const testConnection = () => {
    if (testCooldown || busyRef.current) return;
    setTesting(true);
    setTestCooldown(true);
    cooldownTimer.current = setTimeout(() => setTestCooldown(false), 5000);
    void run(async () => {
      setNotice(copy.testing);
      try {
        const result = await testResearchConnection();
        setHasError(!result.reachable);
        const status = resolveResearchStatus({
          error_code: result.error_code, success: result.reachable,
        });
        setNotice(result.reachable ? copy.connected :
          !result.configured ? copy.saveCredentialsFirst :
            copy[status?.key ?? 'searchConnectionFailed']);
      } catch (error) {
        const code = error instanceof RateLimitError ||
          (error instanceof ApiError && error.status === 429)
          ? 'research_busy' : error instanceof TimeoutError ? 'upstream_timeout' :
            error instanceof ApiError && error.status !== 0
              ? error.code : 'upstream_error';
        setHasError(true);
        const status = resolveResearchStatus({ error_code: code, status: 'error' });
        setNotice(copy[status?.key ?? 'searchConnectionFailed']);
      } finally {
        setTesting(false);
      }
    });
  };
  const focusCredentials = () => {
    const input = document.getElementById('research-new-keys');
    if (!input) return;
    if (typeof input.scrollIntoView === 'function') {
      input.scrollIntoView({ block: 'center' });
    }
    input.focus();
  };
  // 三段状态：可用 / 未配置（含入口）/ 不可用（含原因）/ 关闭（用户意愿），§13-1/2。
  const segmentEnabled = (key: SegmentKey) => key === 'browser'
    ? Boolean(values.browser_enabled)
    : key === 'downloads' ? Boolean(values.downloads_enabled) : true;
  const capabilityText = (key: SegmentKey) => {
    const capability = capabilities?.[key];
    if (capabilityFailed) return copy.capabilityUnavailable;
    if (!values.enabled) return copy.disabled;
    if (!segmentEnabled(key) || capability?.enabled === false) return copy.segmentOff;
    // §13-1 的唯一三段词汇：可用 / 未配置（含入口）/ 不可用（含原因）。
    if (capability?.available) return copy.available;
    if (key === 'search' && capability?.configured === false) {
      return copy.searchNotConfigured;
    }
    // 宿主缺失 ≠ 研究不可用：只降级这一段（§13-2）。
    if (capability?.error_code === 'browser_unavailable') {
      return copy.capabilityEnvironmentUnavailable;
    }
    const status = resolveResearchStatus({ error_code: capability?.error_code });
    return status ? copy[status.key] : copy.unavailable;
  };
  const proxy = capabilities?.proxy;
  const egressKey = proxy
    ? EGRESS_KEYS[proxy.resolved_from as keyof typeof EGRESS_KEYS] ?? 'egressDirect'
    : 'egressDirect';
  const egressText = !proxy ? copy.capabilityUnavailable
    : copy[egressKey] + (proxy.target ? ` · ${proxy.target}` : '');
  // WAI-ARIA radio group: one tab stop, arrows move the selection (§6).
  const onProxyKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = PROXY_MODES.indexOf(values.proxy_mode);
    const next = PROXY_MODES[(index + step + PROXY_MODES.length) % PROXY_MODES.length];
    panel.updateSetting('proxy_mode', next);
    document.getElementById('research-proxy-' + next)?.focus();
  };
  const invalid = Object.entries(LIMITS).some(([key, [min, max]]) => {
    const value = values[key as keyof typeof LIMITS];
    return !Number.isInteger(value) || value < min || value > max;
  }) || proxyUrlInvalid;
  if (panel.loading) return <p role="status" className="p-6">{copy.loading}</p>;
  if (panel.loadError) return <div className="space-y-3 p-6">
    <p role="alert" className="text-sm text-destructive">{copy.settingsLoadFailed}</p>
    <button type="button" className={BUTTON}
      onClick={() => void panel.refetch()}>{copy.retry}</button>
  </div>;
  return <div className="h-full min-w-0 overflow-y-auto bg-background text-foreground">
    <fieldset disabled={busy && !testing} className="mx-auto min-w-0 max-w-3xl space-y-5 p-4 sm:p-8 motion-reduce:[&_*]:!transition-none">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">{copy.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p></div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} disabled={busy}
            onClick={resetSettings}>{copy.reset}</button>
          <button type="button" className={BUTTON}
            disabled={busy || !panel.isDirty || invalid}
            onClick={saveSettings}>{busy ? copy.saving : copy.save}</button>
        </div>
      </header>
      <p className="text-xs text-muted-foreground">{copy.resetHelp}</p>
      <div aria-live="polite" role={hasError ? 'alert' : 'status'}
        className={hasError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
        {notice}
      </div>
      {(!values.enabled || capabilityFailed) && <p role="status"
        className="rounded-md border border-border p-3 text-sm">
        {!values.enabled ? copy.disabled : copy.capabilityUnavailable}
      </p>}
      <ul className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3" aria-live="polite">
        {SEGMENTS.map(key =>
          <li key={key} className="rounded-md border border-border p-3">
            <span className="font-medium">{copy[key]}</span>{' · '}
            {capabilityText(key)}
            {key === 'search' && !capabilityFailed && values.enabled &&
              capabilities?.search?.configured === false &&
              <button type="button" onClick={focusCredentials}
                className="mt-2 block underline underline-offset-2">
                {copy.configureKeys}</button>}
          </li>)}
      </ul>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {copy.egress}: {egressText}
      </p>
      <button type="button" className={BUTTON} disabled={busy}
        onClick={() => void refreshCapabilities()}>{copy.refreshStatus}</button>
      <SettingsSectionCard title={copy.credentials} description={copy.credentialsHelp}>
        <p className="text-sm" role="status">{capabilityFailed
          ? copy.capabilityUnavailable : keyCount > 0
            ? copy.configured.replace('{count}', String(keyCount))
            : copy.notConfigured}{!capabilityFailed && keyCount > 0 &&
            <span aria-hidden="true" className="ml-2 tracking-widest">••••••••</span>}</p>
        <form onSubmit={event => {
          event.preventDefault(); saveCredentials(false);
        }} className="space-y-3">
          <label htmlFor="research-new-keys" className="block text-sm">{copy.newKeys}</label>
          <input id="research-new-keys" type="password" value={keys}
            autoComplete="new-password" spellCheck={false}
            aria-invalid={keyError || undefined}
            aria-describedby={keyError ? 'research-key-error' : undefined}
            onChange={event => { setKeys(event.target.value); setKeyError(false); }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          {keyError && <p id="research-key-error" role="alert"
            className="text-xs text-destructive">{copy.invalidKeys}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !keys.trim()} className={BUTTON}>
              {copy.updateCredentials}</button>
            <button type="button" disabled={busy} className={BUTTON}
              onClick={() => saveCredentials(true)}>{copy.clearCredentials}</button>
            <button type="button" aria-disabled={busy || testCooldown}
              className={`${BUTTON} aria-disabled:opacity-50`}
              onClick={testConnection}>{copy.test}</button>
          </div>
        </form>
      </SettingsSectionCard>
      <SettingsSectionCard title={copy.browsing} description={copy.browserLimits}>
        <SwitchField label={copy.enabled} checked={values.enabled}
          onChange={value => panel.updateSetting('enabled', value)} />
        <SwitchField label={copy.browserEnabled} checked={values.browser_enabled}
          onChange={value => panel.updateSetting('browser_enabled', value)} />
        <SwitchField label={copy.downloadsEnabled} checked={values.downloads_enabled}
          onChange={value => panel.updateSetting('downloads_enabled', value)} />
        <SwitchField label={copy.robots} checked={values.respect_robots}
          onChange={value => panel.updateSetting('respect_robots', value)} />
        <fieldset className="space-y-2">
          <legend className="text-sm">{copy.proxyMode}</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup"
            aria-label={copy.proxyMode} onKeyDown={onProxyKeyDown}>
            {PROXY_MODES.map(mode =>
              <button key={mode} type="button" role="radio"
                id={'research-proxy-' + mode}
                tabIndex={values.proxy_mode === mode ? 0 : -1}
                aria-checked={values.proxy_mode === mode}
                disabled={busy && !testing}
                onClick={() => panel.updateSetting('proxy_mode', mode)}
                className={`${BUTTON} ${values.proxy_mode === mode
                  ? 'border-primary bg-accent' : ''}`}>
                {copy[`proxy_${mode}`]}
              </button>)}
          </div>
          <p className="text-xs text-muted-foreground">{copy.proxyHelp}</p>
          {values.proxy_mode !== 'direct' && <div className="space-y-1">
            <label htmlFor="research-custom-proxy" className="text-sm">
              {copy.customProxyUrl}
            </label>
            <input id="research-custom-proxy" type="text"
              value={values.custom_proxy_url}
              placeholder="http://127.0.0.1:7890"
              aria-invalid={proxyUrlInvalid || undefined}
              aria-describedby={proxyUrlInvalid
                ? 'research-proxy-error' : undefined}
              onChange={event =>
                panel.updateSetting('custom_proxy_url', event.target.value)}
              className="block w-full rounded border border-border bg-background px-3 py-2 text-sm" />
            {proxyUrlInvalid && <p id="research-proxy-error" role="alert"
              className="text-xs text-destructive">{copy.invalidProxyUrl}</p>}
          </div>}
        </fieldset>
      </SettingsSectionCard>
      <SettingsSectionCard title={copy.model} description={copy.modelFallback}>
        <SwitchField label={copy.useModel} checked={values.use_research_model}
          onChange={value => panel.updateSetting('use_research_model', value)} />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {!values.use_research_model ? copy.mainModel :
            `${copy.modelSource}: ${capabilities?.research_model?.model_name ?? copy.unavailable}`}
          {values.use_research_model && capabilities?.research_model?.source
            ? ` (${capabilities.research_model.source})` : ''}
        </p>
        {onOpenModels && <button type="button" className={BUTTON}
          onClick={onOpenModels}>{copy.configureModel}</button>}
      </SettingsSectionCard>
      <details className="rounded-lg border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-medium">{copy.advanced}</summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(Object.keys(LIMITS) as Array<keyof typeof LIMITS>).map(key =>
            <BudgetField key={key} settingKey={key} value={values[key]}
              disabled={key === 'research_context_window_tokens' &&
                !values.use_research_model}
              onChange={value => panel.updateSetting(key, value)} />)}
        </div>
      </details>
    </fieldset>
  </div>;
}
