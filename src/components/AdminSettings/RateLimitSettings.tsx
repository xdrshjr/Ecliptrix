'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import { NumberField, SwitchField } from './components/SettingsFieldHelpers';
import {
  getConfig,
  updateConfig,
  resetConfig,
  getStatus,
  type RateLimitConfig,
  type RateLimitStatus,
  type RateLimitMetaKey,
} from '@/lib/api/rateLimitSettings';

/**
 * Admin panel for the backend rate-limit configuration (TODO 04).
 *
 * Renders directly from the backend contract: the global `enabled` toggle +
 * `window_seconds` + the 5 flat `limits` keys, each bounded by `config.meta`.
 * Save → PUT (subset of the 7 flat keys); Reset → POST /reset. A read-only
 * status panel shows the live process counters from GET /status.
 *
 * Panel-level admin gating is inherited from the AdminSettings entry point
 * (`canManageUsers`); the backend `require_admin` is the real guard. No extra
 * FE role check here per spec §2.1.
 */

/** The five numeric limit keys, in display order. */
const LIMIT_KEYS = [
  'default_per_user_per_min',
  'default_per_ip_per_min',
  'ai_generation_per_min',
  'auth_per_ip_per_min',
  'media_serving_per_min',
] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];

const RateLimitSettings: React.FC = () => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();

  const [config, setConfig] = useState<RateLimitConfig | null>(null);
  const [status, setStatus] = useState<RateLimitStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  // Working copy of the editable values (the 5 limits + enabled + window).
  const [enabled, setEnabled] = useState(true);
  const [windowSeconds, setWindowSeconds] = useState(60);
  const [limits, setLimits] = useState<Record<LimitKey, number>>({
    default_per_user_per_min: 300,
    default_per_ip_per_min: 300,
    ai_generation_per_min: 30,
    auth_per_ip_per_min: 10,
    media_serving_per_min: 6000,
  });

  const applyConfig = useCallback((c: RateLimitConfig) => {
    setConfig(c);
    setEnabled(c.enabled);
    setWindowSeconds(c.window_seconds);
    setLimits({
      default_per_user_per_min: c.limits.default_per_user_per_min,
      default_per_ip_per_min: c.limits.default_per_ip_per_min,
      ai_generation_per_min: c.limits.ai_generation_per_min,
      auth_per_ip_per_min: c.limits.auth_per_ip_per_min,
      media_serving_per_min: c.limits.media_serving_per_min,
    });
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getStatus();
      setStatus(s);
    } catch {
      // Status is best-effort observability; a failure here must not break the
      // editable form. Leave the prior value (or null) in place.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const c = await getConfig();
        if (!cancelled) applyConfig(c);
        await loadStatus();
      } catch {
        if (!cancelled) showError(t.adminSettings.rlLoadError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pull min/max/description for a key from the backend meta. */
  const metaFor = (key: RateLimitMetaKey) => config?.meta?.[key];
  const minFor = (key: RateLimitMetaKey): number | undefined => {
    const m = metaFor(key)?.min;
    return typeof m === 'number' ? m : undefined;
  };
  const maxFor = (key: RateLimitMetaKey): number | undefined => {
    const m = metaFor(key)?.max;
    return typeof m === 'number' ? m : undefined;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Submit the full editable set (subset PUT is allowed; sending all is
      // simplest and the backend validates+echoes the effective config).
      const next = await updateConfig({
        enabled,
        window_seconds: windowSeconds,
        ...limits,
      });
      applyConfig(next);
      await loadStatus();
      showSuccess(t.adminSettings.rlSaveSuccess);
    } catch {
      // ApiError (incl. 422 out-of-range / 403) → friendly error toast. The
      // form keeps the user's values so they can correct and retry.
      showError(t.adminSettings.rlSaveError);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      const next = await resetConfig();
      applyConfig(next);
      await loadStatus();
      showSuccess(t.adminSettings.rlResetSuccess);
    } catch {
      showError(t.adminSettings.rlResetError);
    } finally {
      setResetting(false);
    }
  };

  const handleRefreshStatus = async () => {
    setStatusRefreshing(true);
    try {
      await loadStatus();
    } finally {
      setStatusRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-muted-foreground">{t.adminSettings.loading}</div>
      </div>
    );
  }

  const busy = saving || resetting;

  const limitLabels: Record<LimitKey, string> = {
    default_per_user_per_min: t.adminSettings.rlDefaultPerUser,
    default_per_ip_per_min: t.adminSettings.rlDefaultPerIp,
    ai_generation_per_min: t.adminSettings.rlAiGeneration,
    auth_per_ip_per_min: t.adminSettings.rlAuthPerIp,
    media_serving_per_min: t.adminSettings.rlMediaServing,
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-4xl">
        {/* Header + actions */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">{t.adminSettings.rlPageTitle}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.adminSettings.rlPageDesc}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium rounded-md border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetting ? t.adminSettings.settingsResetting : t.adminSettings.settingsRestoreDefaults}
            </button>
            <button
              onClick={handleSave}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t.adminSettings.saving : t.adminSettings.save}
            </button>
          </div>
        </div>

        {/* Global section */}
        <SettingsSectionCard
          title={t.adminSettings.rlGlobalSection}
          description={t.adminSettings.rlGlobalSectionDesc}
        >
          <SwitchField
            label={t.adminSettings.rlEnabled}
            checked={enabled}
            onChange={setEnabled}
          />
          <NumberField
            label={t.adminSettings.rlWindowSeconds}
            value={windowSeconds}
            onChange={setWindowSeconds}
            min={minFor('window_seconds')}
            max={maxFor('window_seconds')}
          />
        </SettingsSectionCard>

        {/* Per-category limits — greyed out + hint when disabled */}
        <SettingsSectionCard
          title={t.adminSettings.rlLimitsSection}
          description={t.adminSettings.rlLimitsSectionDesc}
        >
          {!enabled && (
            <p className="text-xs text-amber-500">{t.adminSettings.rlDisabledHint}</p>
          )}
          <div
            className={
              !enabled ? 'space-y-4 opacity-50 pointer-events-none select-none' : 'space-y-4'
            }
            aria-disabled={!enabled}
          >
            {LIMIT_KEYS.map((key) => (
              <NumberField
                key={key}
                label={limitLabels[key]}
                value={limits[key]}
                onChange={(v) => setLimits((prev) => ({ ...prev, [key]: v }))}
                min={minFor(key)}
                max={maxFor(key)}
              />
            ))}
          </div>
        </SettingsSectionCard>

        {/* Read-only live status */}
        <SettingsSectionCard
          title={t.adminSettings.rlStatusSection}
          description={t.adminSettings.rlStatusSectionDesc}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t.adminSettings.rlStatusEnabled}</span>
            <span className="text-sm font-medium text-foreground">
              {status
                ? status.enabled
                  ? t.adminSettings.rlStatusOn
                  : t.adminSettings.rlStatusOff
                : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t.adminSettings.rlStatusActiveKeys}</span>
            <span className="text-sm font-medium text-foreground">{status?.active_keys ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t.adminSettings.rlStatusTotalChecked}</span>
            <span className="text-sm font-medium text-foreground">{status?.total_checked ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">{t.adminSettings.rlStatusTotalBlocked}</span>
            <span className="text-sm font-medium text-foreground">{status?.total_blocked ?? '—'}</span>
          </div>
          <div className="pt-2">
            <button
              onClick={handleRefreshStatus}
              disabled={statusRefreshing}
              className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.adminSettings.rlRefreshStatus}
            </button>
          </div>
        </SettingsSectionCard>
      </div>
    </div>
  );
};

export default RateLimitSettings;
