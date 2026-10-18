'use client';

/**
 * 设置中心「视觉审阅」面板。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §7.2（六段结构）与
 * §6.4（设置键与区间）、§4.12（`enabled` 的精确语义）。
 *
 * 与 `AgentToolkitSettingsPanel.tsx` 刻意同构：加载中只有 `role="status"`；
 * 加载失败只有 `role="alert"` + 重试，且**不**渲染表单；保存结果走
 * `aria-live`；忙碌态用 `<fieldset disabled>`。落库走同一个
 * `/api/system-settings/agent_vision` 批量 PUT，`updated_by` 由后端写
 * `LOCAL_OWNER_NAME`（客户端不发这个字段，与 toolkit 面板一致）。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import {
  getCategorySettings, updateCategorySettings,
} from '@/lib/api/systemSettings';
import {
  clearVisionCache, fetchAgentVisionCapabilities, fetchAgentVisionUsage,
} from '@/lib/api/agentVision';
import type { VisionCapabilities, VisionUsage } from '@/types/agentVision';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import SettingsSectionCard from './components/SettingsSectionCard';

const CATEGORY = 'agent_vision';

type VisionCopyKey = Exclude<keyof Translations['agentVision'], 'errors' | 'lint'>;
type SwitchKey = 'enabled' | 'probe_enabled' | 'visual_spot_check';
type NumericKey =
  | 'max_image_side_px' | 'max_images_per_call' | 'max_image_bytes'
  | 'frame_sample_count' | 'daily_call_cap' | 'daily_image_cap'
  | 'request_timeout_seconds' | 'cache_ttl_days';

interface VisionSettings {
  enabled: boolean;
  probe_enabled: boolean;
  visual_spot_check: boolean;
  max_images_per_call: number;
  max_image_side_px: number;
  max_image_bytes: number;
  frame_sample_count: number;
  daily_call_cap: number;
  daily_image_cap: number;
  request_timeout_seconds: number;
  cache_ttl_days: number;
}

type UpdateSetting = <K extends keyof VisionSettings>(
  key: K, value: VisionSettings[K],
) => void;

/** 默认值与 spec §6.4 逐行对应（后端之外的本地兜底）。 */
const DEFAULTS: VisionSettings = {
  enabled: true,
  probe_enabled: true,
  visual_spot_check: true,
  max_images_per_call: 4,
  max_image_side_px: 1280,
  max_image_bytes: 409600,
  frame_sample_count: 4,
  daily_call_cap: 120,
  daily_image_cap: 400,
  request_timeout_seconds: 45,
  cache_ttl_days: 7,
};

const SWITCHES: SwitchKey[] = ['enabled', 'probe_enabled', 'visual_spot_check'];

/** 逐键区间（spec §6.4）；`label` 是 `agentVision` 命名空间里的标签键。 */
const LIMITS: Record<NumericKey, {
  min: number; max: number; label: VisionCopyKey;
}> = {
  max_images_per_call: { min: 1, max: 6, label: 'maxImagesPerCall' },
  max_image_side_px: { min: 512, max: 1600, label: 'maxImageSidePx' },
  max_image_bytes: { min: 102400, max: 1572864, label: 'maxImageBytes' },
  frame_sample_count: { min: 1, max: 6, label: 'frameSampleCount' },
  daily_call_cap: { min: 1, max: 2000, label: 'dailyCallCap' },
  daily_image_cap: { min: 1, max: 5000, label: 'dailyImageCap' },
  request_timeout_seconds: {
    min: 10, max: 120, label: 'requestTimeoutSeconds',
  },
  cache_ttl_days: { min: 0, max: 30, label: 'cacheTtlDays' },
};

const BUDGET_KEYS: NumericKey[] = [
  'max_images_per_call', 'max_image_bytes', 'frame_sample_count',
  'daily_call_cap', 'daily_image_cap', 'request_timeout_seconds',
  'cache_ttl_days',
];
const NUMERIC_KEYS: NumericKey[] = [...BUDGET_KEYS, 'max_image_side_px'];
/** 后端枚举是 512–1600；只暴露 spec 列出的五档。 */
const IMAGE_SIDES = [512, 768, 1024, 1280, 1600];

const BUTTON = 'rounded-md border border-border px-3 py-2 text-sm '
  + 'hover:bg-accent focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-primary disabled:opacity-50';
const INPUT = 'block w-full rounded border border-border bg-background '
  + 'px-3 py-2 text-sm disabled:opacity-50';

function numberFrom(raw: Record<string, unknown>, key: NumericKey): number {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value : DEFAULTS[key];
}

function switchFrom(raw: Record<string, unknown>, key: SwitchKey): boolean {
  const value = raw[key];
  return typeof value === 'boolean' ? value : DEFAULTS[key];
}

function settingsValues(raw: Record<string, unknown>): VisionSettings {
  return {
    enabled: switchFrom(raw, 'enabled'),
    probe_enabled: switchFrom(raw, 'probe_enabled'),
    visual_spot_check: switchFrom(raw, 'visual_spot_check'),
    max_images_per_call: numberFrom(raw, 'max_images_per_call'),
    max_image_side_px: numberFrom(raw, 'max_image_side_px'),
    max_image_bytes: numberFrom(raw, 'max_image_bytes'),
    frame_sample_count: numberFrom(raw, 'frame_sample_count'),
    daily_call_cap: numberFrom(raw, 'daily_call_cap'),
    daily_image_cap: numberFrom(raw, 'daily_image_cap'),
    request_timeout_seconds: numberFrom(raw, 'request_timeout_seconds'),
    cache_ttl_days: numberFrom(raw, 'cache_ttl_days'),
  };
}

/** 只提交真正变化的键（后端按类别校验，多提交无害但 diff 更干净）。 */
function savePayload(
  values: VisionSettings, original: VisionSettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of SWITCHES) {
    if (values[key] !== original[key]) payload[key] = values[key];
  }
  for (const key of NUMERIC_KEYS) {
    if (values[key] !== original[key]) payload[key] = values[key];
  }
  return payload;
}

function isOutOfRange(key: NumericKey, value: number): boolean {
  const { min, max } = LIMITS[key];
  return !Number.isInteger(value) || value < min || value > max;
}

function hasRangeError(values: VisionSettings): boolean {
  return NUMERIC_KEYS.some((key) => isOutOfRange(key, values[key]));
}

/** `save()` 的结果：失败时带回原始错误，供 `saveErrorMessage` 分流文案。 */
type SaveOutcome = { ok: true } | { ok: false; error: unknown };

/** 只从错误对象上取白名单里的错误码，其余一律按内部错误处理。 */
function errorCodeOf(error: unknown): string {
  const code = (error as { errorCode?: unknown } | null | undefined)?.errorCode;
  return typeof code === 'string' && code ? code : 'internal_error';
}

/** 保存失败文案：`setting_out_of_range` 与就地校验共用同一句话。 */
function saveErrorMessage(
  error: unknown, copy: Translations['agentVision'],
): string {
  return errorCodeOf(error) === 'setting_out_of_range'
    ? copy.invalidSetting : copy.saveFailed;
}

// ── 状态读取 ──────────────────────────────────────────────────────────────

function useVisionSettings() {
  const [values, setValues] = useState<VisionSettings>(DEFAULTS);
  const original = useRef<VisionSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCategorySettings(CATEGORY);
      if (!result.success || !Array.isArray(result.settings)) {
        throw new Error('settings_load_failed');
      }
      const raw: Record<string, unknown> = {};
      for (const item of result.settings) raw[item.key] = item.value;
      const next = settingsValues(raw);
      setValues(next);
      original.current = next;
      setLoadError(false);
    } catch {
      // 读失败必须区别于「成功但为空」的类别。
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const updateSetting: UpdateSetting = useCallback((key, value) => {
    setValues((previous) => ({ ...previous, [key]: value }));
  }, []);

  const payload = savePayload(values, original.current);
  const isDirty = Object.keys(payload).length > 0;

  /**
   * 保存并把**失败原因**交回调用方；只有实际成功才更新 diff 基线。
   *
   * 只回 boolean 的话，服务端的 `setting_out_of_range`（AC-20 点名要映射的
   * 那条）到不了界面：用户看到"保存失败，请检查高亮字段"，却没有任何字段
   * 被高亮。
   */
  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (saving || !isDirty) return { ok: false, error: null };
    setSaving(true);
    try {
      const result = await updateCategorySettings(CATEGORY, payload);
      if (!result.success) {
        const code = (result as { error_code?: unknown }).error_code;
        return {
          ok: false,
          error: typeof code === 'string' ? { errorCode: code } : null,
        };
      }
      original.current = values;
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    } finally {
      setSaving(false);
    }
  }, [saving, isDirty, payload, values]);

  return {
    values, updateSetting, loading, loadError, saving, save, isDirty,
    rangesInvalid: hasRangeError(values), reload,
  };
}

/** 能力 / 用量（两个端点各自失败，互不牵连）。 */
function useVisionResources() {
  const [capabilities, setCapabilities] =
    useState<VisionCapabilities | null>(null);
  const [usage, setUsage] = useState<VisionUsage | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setCapabilities(await fetchAgentVisionCapabilities());
      setFailed(false);
    } catch {
      setCapabilities(null);
      setFailed(true);
    }
    try {
      setUsage(await fetchAgentVisionUsage());
    } catch {
      setUsage(null);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return { capabilities, usage, failed, refresh };
}

// ── 分节 ──────────────────────────────────────────────────────────────────

type StatusKind = 'loading' | 'available' | 'disabled' | 'unconfigured';

const STATUS_BADGE: Record<StatusKind, string> = {
  loading: 'border-border bg-muted text-muted-foreground',
  available: 'border-green-600/40 bg-green-600/10 text-green-700 '
    + 'dark:text-green-400',
  disabled: 'border-border bg-muted text-muted-foreground',
  unconfigured: 'border-amber-500/40 bg-amber-500/10 text-amber-700 '
    + 'dark:text-amber-400',
};

/**
 * `capabilities === null` 有两种含义：**还在读** 与 **读失败**。
 *
 * 两者都当成 `unconfigured` 会在每次打开面板时先闪一句
 * role="alert"「没有配置视觉模型」——即使配置得好好的。读失败由 `failed`
 * 单独展示，所以这里必须先区分出 `loading`。
 */
function statusOf(
  capabilities: VisionCapabilities | null, failed: boolean,
): StatusKind {
  if (!capabilities) return failed ? 'unconfigured' : 'loading';
  if (!capabilities.vision.available) return 'unconfigured';
  return capabilities.vision.enabled ? 'available' : 'disabled';
}

function StatusSection({ capabilities, failed, onRefresh, onOpenModels }: {
  capabilities: VisionCapabilities | null;
  failed: boolean;
  onRefresh: () => void;
  onOpenModels?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const kind = statusOf(capabilities, failed);
  const label = kind === 'available' ? copy.statusAvailable
    : kind === 'disabled' ? copy.statusDisabled : copy.notConfigured;
  const badgeText = kind === 'loading' ? copy.loading
    : kind === 'unconfigured' ? copy.statusUnavailable
      : kind === 'available' ? copy.statusAvailable : copy.statusDisabled;
  return (
    <SettingsSectionCard title={copy.sectionStatus}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-block rounded border px-2 py-1 text-xs
          font-medium ${STATUS_BADGE[kind]}`}>
          {badgeText}
        </span>
        <button type="button" className={BUTTON} onClick={onRefresh}>
          {copy.refresh}
        </button>
      </div>
      {kind === 'disabled' && (
        <p role="status" className="text-sm text-muted-foreground">{label}</p>
      )}
      {/* 读失败时只说"读取失败"：两句话同时报同一件事只会制造噪音。 */}
      {kind === 'unconfigured' && !failed && (
        <p role="alert" className="text-sm text-muted-foreground">{label}</p>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {copy.loadFailed}
        </p>
      )}
      {kind === 'unconfigured' && !failed && onOpenModels && (
        <button type="button" className={BUTTON} onClick={onOpenModels}>
          {copy.openModelSettings}
        </button>
      )}
    </SettingsSectionCard>
  );
}

/** 一个能力开关 + 一句"关掉之后 Agent 会怎样"。 */
function SwitchRow({ id, label, hint, checked, onChange }: {
  id: string; label: string; hint: string; checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1" checked={checked}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.checked)} />
      <span className="min-w-0">
        <label htmlFor={id} className="text-sm">{label}</label>
        <span id={`${id}-hint`}
          className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </div>
  );
}

function CapabilitySection({ values, update }: {
  values: VisionSettings; update: UpdateSetting;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const hints: Record<SwitchKey, VisionCopyKey> = {
    enabled: 'enabledHint',
    probe_enabled: 'probeEnabledHint',
    visual_spot_check: 'visualSpotCheckHint',
  };
  const labels: Record<SwitchKey, VisionCopyKey> = {
    enabled: 'enabled',
    probe_enabled: 'probeEnabled',
    visual_spot_check: 'visualSpotCheck',
  };
  return (
    <SettingsSectionCard title={copy.sectionCapabilities}>
      {SWITCHES.map((key) => (
        <SwitchRow key={key} id={`agent-vision-${key}`}
          label={copy[labels[key]]} hint={copy[hints[key]]}
          checked={values[key]} onChange={(checked) => update(key, checked)} />
      ))}
      {/* spec §4.12 / §7.2：这句固定文案不可省略，否则用户会以为
          "关掉视觉 = 关掉自检"。 */}
      <p role="note" className="rounded-md border border-border bg-muted/40 p-3
        text-xs text-muted-foreground">
        {copy.lintAlwaysOn}
      </p>
    </SettingsSectionCard>
  );
}

function ResolvedModel({ capabilities }: {
  capabilities: VisionCapabilities | null;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const model = capabilities?.vision.model ?? null;
  if (!model) {
    return (
      <p className="text-sm text-muted-foreground">{copy.notConfigured}</p>
    );
  }
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-muted-foreground">{`${copy.modelResolved}:`}</span>
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">
        {`${model.provider} / ${model.model}`}
      </code>
      <span className="text-xs text-muted-foreground">
        {model.source === 'database' ? copy.sourceDatabase
          : copy.sourceEnvironment}
      </span>
    </p>
  );
}

function ModelSection({ capabilities, value, onSelect, onOpenModels }: {
  capabilities: VisionCapabilities | null;
  value: number;
  onSelect: (value: number) => void;
  onOpenModels?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const id = 'agent-vision-max_image_side_px';
  return (
    <SettingsSectionCard title={copy.sectionModel}>
      <ResolvedModel capabilities={capabilities} />
      {!capabilities?.vision.model && onOpenModels && (
        <button type="button" className={BUTTON} onClick={onOpenModels}>
          {copy.openModelSettings}
        </button>
      )}
      {/* 出口披露：隐私文案不可折叠到 tooltip（spec §4.13.1）。 */}
      <p role="note" className="text-xs text-muted-foreground">
        {copy.egressNote}
      </p>
      <div className="space-y-1">
        <label htmlFor={id} className="text-sm">{copy.maxImageSidePx}</label>
        <select id={id} className={INPUT} value={value}
          onChange={(event) => onSelect(Number(event.target.value))}>
          {IMAGE_SIDES.map((side) => (
            <option key={side} value={side}>{`${side} px`}</option>
          ))}
        </select>
      </div>
    </SettingsSectionCard>
  );
}

function LimitField({ settingKey, value, onChange }: {
  settingKey: NumericKey;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useLocale();
  const { min, max, label } = LIMITS[settingKey];
  const invalid = isOutOfRange(settingKey, value);
  const id = `agent-vision-${settingKey}`;
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">{t.agentVision[label]}</label>
      <input id={id} type="number" min={min} max={max} step={1}
        value={Number.isFinite(value) ? value : ''}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => onChange(event.target.value === ''
          ? Number.NaN : Number(event.target.value))}
        className={INPUT} />
      {invalid && (
        <p id={errorId} className="text-xs text-destructive">
          {t.agentVision.invalidSetting}
        </p>
      )}
    </div>
  );
}

function LimitsSection({ values, update }: {
  values: VisionSettings; update: UpdateSetting;
}) {
  const { t } = useLocale();
  return (
    <SettingsSectionCard title={t.agentVision.sectionLimits}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {BUDGET_KEYS.map((key) => (
          <LimitField key={key} settingKey={key} value={values[key]}
            onChange={(value) => update(key, value)} />
        ))}
      </div>
    </SettingsSectionCard>
  );
}

/** 纯 CSS 迷你柱状图：只画已有的数字，缺数据就不造柱子。 */
function MiniBars({ values, label }: { values: number[]; label: string }) {
  const peak = Math.max(...values, 1);
  return (
    <div role="img" aria-label={label}
      className="mt-1 flex h-10 items-end gap-1">
      {values.map((value, index) => (
        <div key={`${index}-${value}`}
          className="w-3 rounded-t bg-primary/70"
          style={{ height: `${Math.max(2, Math.round((value / peak) * 40))}px` }}
          title={`${value}`} />
      ))}
    </div>
  );
}

/**
 * 近 7 天的每日调用数。
 *
 * 只读 `usage` 上的字段：后端若已按天返回（`history` / `by_day`）就取前 7 项，
 * 否则退化成"只有今天这一根柱子"——**不**用 0 补齐其余 6 天，那会把"没记录"
 * 画成"没有调用"。
 */
function dailyCalls(usage: VisionUsage | null): number[] {
  if (!usage) return [];
  const raw = usage as unknown as Record<string, unknown>;
  const list = Array.isArray(raw.history) ? raw.history
    : Array.isArray(raw.by_day) ? raw.by_day : [];
  const values: number[] = [];
  for (const item of list.slice(0, 7)) {
    const value = typeof item === 'number' ? item
      : item && typeof item === 'object'
        ? (item as Record<string, unknown>).calls : null;
    if (typeof value === 'number' && Number.isFinite(value)) values.push(value);
  }
  return values.length > 0 ? values : [usage.calls];
}

function UsageSection({ usage, onClear }: {
  usage: VisionUsage | null;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const counters: Array<{ key: VisionCopyKey; value: number }> = [
    { key: 'usageCalls', value: usage?.calls ?? 0 },
    { key: 'usageImages', value: usage?.images ?? 0 },
    { key: 'visionCached', value: usage?.cached_calls ?? 0 },
    { key: 'usageFailures', value: usage?.failures ?? 0 },
  ];
  const bars = dailyCalls(usage);
  return (
    <SettingsSectionCard title={copy.sectionUsage}>
      {usage && <p className="text-xs text-muted-foreground">{usage.day}</p>}
      <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {counters.map(({ key, value }) => (
          <li key={key} className="rounded-md border border-border p-2">
            <span className="block text-xs text-muted-foreground">
              {copy[key]}
            </span>
            <span className="tabular-nums">
              {usage ? String(value) : '—'}
            </span>
          </li>
        ))}
      </ul>
      {bars.length > 0 && <MiniBars values={bars} label={copy.usageCalls} />}
      <button type="button" className={BUTTON} onClick={onClear}>
        {copy.cacheClear}
      </button>
    </SettingsSectionCard>
  );
}

function RulesSection() {
  const { t } = useLocale();
  const copy = t.agentVision;
  return (
    <SettingsSectionCard title={copy.sectionRules}>
      <p className="text-sm">{copy.rulesWhy}</p>
    </SettingsSectionCard>
  );
}

// 组件主体只有 JSX 组合与一个确认框；逻辑都在上面的 hook / 子组件里。
export default function AgentVisionSettingsPanel({ onOpenModels }: {
  onOpenModels?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const panel = useVisionSettings();
  const resources = useVisionResources();
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [clearing, setClearing] = useState(false);

  const submit = async () => {
    const outcome = await panel.save();
    setNoticeError(!outcome.ok);
    setNotice(outcome.ok ? copy.saved : saveErrorMessage(outcome.error, copy));
    // 能力开关可能已改变：成功后刷新状态徽标与用量。
    if (outcome.ok) void resources.refresh();
  };

  const clearCache = async () => {
    setClearing(false);
    try {
      await clearVisionCache();
      setNoticeError(false);
      setNotice(copy.cacheCleared);
      void resources.refresh();
    } catch (error) {
      setNoticeError(true);
      setNotice(saveErrorMessage(error, copy));
    }
  };

  if (panel.loading) return <p role="status" className="p-6">{copy.loading}</p>;
  if (panel.loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-sm text-destructive">
          {copy.loadFailed}
        </p>
        <button type="button" className={BUTTON}
          onClick={() => void panel.reload()}>{copy.retry}</button>
      </div>
    );
  }

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-background text-foreground">
      <fieldset disabled={panel.saving} className="mx-auto min-w-0 max-w-3xl
        space-y-5 p-4 sm:p-8 motion-reduce:[&_*]:!transition-none">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {copy.description}
            </p>
          </div>
          <button type="button" className={BUTTON}
            disabled={panel.saving || !panel.isDirty || panel.rangesInvalid}
            onClick={() => void submit()}>
            {panel.saving ? copy.saving : t.adminSettings.save}
          </button>
        </header>
        <div aria-live={noticeError ? 'assertive' : 'polite'}
          role={noticeError ? 'alert' : 'status'} className={noticeError
            ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {notice}
        </div>

        <StatusSection capabilities={resources.capabilities}
          failed={resources.failed} onRefresh={() => void resources.refresh()}
          onOpenModels={onOpenModels} />
        <CapabilitySection values={panel.values} update={panel.updateSetting} />
        <ModelSection capabilities={resources.capabilities}
          value={panel.values.max_image_side_px}
          onSelect={(value) => panel.updateSetting('max_image_side_px', value)}
          onOpenModels={onOpenModels} />
        <LimitsSection values={panel.values} update={panel.updateSetting} />
        <UsageSection usage={resources.usage}
          onClear={() => setClearing(true)} />
        <RulesSection />
      </fieldset>

      <ConfirmationDialog isOpen={clearing}
        title={copy.cacheClearConfirm} message={copy.cacheClearConfirmBody}
        confirmText={copy.cacheClear}
        onConfirm={() => void clearCache()}
        onCancel={() => setClearing(false)} />
    </div>
  );
}
