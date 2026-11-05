'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import {
  getCategorySettings, updateCategorySettings,
} from '@/lib/api/systemSettings';
import { ApiError } from '@/lib/api/http-client';
import { isKnownAgentHostCode } from '@/lib/agentHostStatus';
import SettingsSectionCard from './components/SettingsSectionCard';

/**
 * 设置中心「本机与网络访问」面板（`agent_host` 分类，18 个键）。
 *
 * 设计基线：docs/plans/agent-general-assistant/spec.md §4.9 / §5.2 / §12.2-3。
 * 结构与 `AgentToolkitSettingsPanel.tsx` 同构，刻意**不**复用共享
 * `useSettingsPanel`：它发整表并带「恢复默认」，而本面板只发脏键（AC-G19），
 * 本版也没有恢复默认按钮。加载态只有 `role="status"`，保存结果走
 * `aria-live`，忙碌态用 `<fieldset disabled>`。
 */

const CATEGORY = 'agent_host';
const MAX_PATTERNS = 50;
const MAX_PORTS = 20;
const MAX_ROOTS = 10;

type CopyKey = keyof Omit<Translations['agentHost'], 'errors'>;
type Scope = 'workspace' | 'host';
type EgressMode = 'strict' | 'balanced' | 'open';
type BooleanKey = 'enabled' | 'shell_enabled' | 'fs_enabled' | 'egress_enabled';
type NumericKey =
  | 'shell_timeout_s' | 'shell_max_output_kb' | 'fs_max_bytes'
  | 'egress_max_bytes' | 'egress_max_per_turn' | 'egress_max_per_minute'
  | 'audit_log_retention_days';
type ListKey =
  | 'egress_allow_hosts' | 'egress_deny_hosts' | 'egress_allow_ports'
  | 'host_read_roots' | 'host_write_roots';

/** 后端 `agent_host` 分类的 18 个键（§4.9 表格逐行对应）。 */
interface AgentHostSettings {
  enabled: boolean;
  shell_enabled: boolean;
  shell_scope: Scope;
  shell_timeout_s: number;
  shell_max_output_kb: number;
  fs_enabled: boolean;
  fs_max_bytes: number;
  egress_enabled: boolean;
  egress_mode: EgressMode;
  egress_allow_hosts: string[];
  egress_deny_hosts: string[];
  egress_allow_ports: number[];
  egress_max_bytes: number;
  egress_max_per_turn: number;
  egress_max_per_minute: number;
  host_read_roots: string[];
  host_write_roots: string[];
  audit_log_retention_days: number;
}

type UpdateSetting = <K extends keyof AgentHostSettings>(
  key: K, value: AgentHostSettings[K],
) => void;

/** 出厂值（§4.9 表格「出厂」列）；后端读不到时的本地兜底。 */
const DEFAULTS: AgentHostSettings = {
  enabled: true,
  shell_enabled: true,
  shell_scope: 'workspace',
  shell_timeout_s: 120,
  shell_max_output_kb: 64,
  fs_enabled: true,
  fs_max_bytes: 32768,
  egress_enabled: true,
  egress_mode: 'balanced',
  egress_allow_hosts: [],
  egress_deny_hosts: [],
  egress_allow_ports: [],
  egress_max_bytes: 8388608,
  egress_max_per_turn: 60,
  egress_max_per_minute: 120,
  host_read_roots: [],
  host_write_roots: [],
  audit_log_retention_days: 30,
};

const BOOLEAN_KEYS: BooleanKey[] = [
  'enabled', 'shell_enabled', 'fs_enabled', 'egress_enabled',
];
const NUMERIC_KEYS: NumericKey[] = [
  'shell_timeout_s', 'shell_max_output_kb', 'fs_max_bytes', 'egress_max_bytes',
  'egress_max_per_turn', 'egress_max_per_minute', 'audit_log_retention_days',
];
const LIST_KEYS: ListKey[] = [
  'egress_allow_hosts', 'egress_deny_hosts', 'egress_allow_ports',
  'host_read_roots', 'host_write_roots',
];
const SCOPES: Scope[] = ['workspace', 'host'];
const EGRESS_MODES: EgressMode[] = ['strict', 'balanced', 'open'];

/** 逐键区间（§4.9）；`label` 是 `agentHost` 命名空间里的标签键。 */
const LIMITS: Record<NumericKey, {
  min: number; max: number; label: CopyKey; hint: CopyKey;
}> = {
  shell_timeout_s: {
    min: 1, max: 600, label: 'shellTimeoutS', hint: 'shellTimeoutSHint',
  },
  shell_max_output_kb: {
    min: 8, max: 512, label: 'shellMaxOutputKb', hint: 'shellMaxOutputKbHint',
  },
  fs_max_bytes: { min: 1024, max: 1048576, label: 'fsMaxBytes', hint: 'fsMaxBytesHint' },
  egress_max_bytes: {
    min: 65536, max: 67108864, label: 'egressMaxBytes', hint: 'egressMaxBytesHint',
  },
  egress_max_per_turn: {
    min: 1, max: 200, label: 'egressMaxPerTurn', hint: 'egressMaxPerTurnHint',
  },
  egress_max_per_minute: {
    min: 1, max: 600, label: 'egressMaxPerMinute', hint: 'egressMaxPerMinuteHint',
  },
  audit_log_retention_days: {
    min: 1, max: 365, label: 'auditLogRetentionDays',
    hint: 'auditLogRetentionDaysHint',
  },
};

const BOOLEAN_LABELS: Record<BooleanKey, { label: CopyKey; hint: CopyKey }> = {
  enabled: { label: 'enabled', hint: 'enabledHint' },
  shell_enabled: { label: 'shellEnabled', hint: 'shellEnabledHint' },
  fs_enabled: { label: 'fsEnabled', hint: 'fsEnabledHint' },
  egress_enabled: { label: 'egressEnabled', hint: 'egressEnabledHint' },
};

/** 列表键：标签、提示、占位行数与条目上限。 */
const LIST_META: Record<ListKey, {
  label: CopyKey; hint: CopyKey; max: number; rows: number;
}> = {
  egress_allow_hosts: {
    label: 'egressAllowHosts', hint: 'egressAllowHostsHint',
    max: MAX_PATTERNS, rows: 3,
  },
  egress_deny_hosts: {
    label: 'egressDenyHosts', hint: 'egressDenyHostsHint',
    max: MAX_PATTERNS, rows: 3,
  },
  egress_allow_ports: {
    label: 'egressAllowPorts', hint: 'egressAllowPortsHint',
    max: MAX_PORTS, rows: 2,
  },
  host_read_roots: {
    label: 'hostReadRoots', hint: 'hostReadRootsHint', max: MAX_ROOTS, rows: 2,
  },
  host_write_roots: {
    label: 'hostWriteRoots', hint: 'hostWriteRootsHint', max: MAX_ROOTS, rows: 2,
  },
};

const SCOPE_LABELS: Record<Scope, CopyKey> = {
  workspace: 'shellScopeWorkspace', host: 'shellScopeHost',
};
const MODE_LABELS: Record<EgressMode, CopyKey> = {
  strict: 'egressModeStrict', balanced: 'egressModeBalanced', open: 'egressModeOpen',
};

const BUTTON = 'rounded-md border border-border px-3 py-2 text-sm '
  + 'hover:bg-accent focus-visible:outline focus-visible:outline-2 '
  + 'focus-visible:outline-primary disabled:opacity-50';
const INPUT = 'block w-full rounded border border-border bg-background '
  + 'px-3 py-2 text-sm disabled:opacity-50';
const NOTE = 'mt-2 space-y-1 rounded-md border border-amber-500/40 '
  + 'bg-amber-500/10 p-3 text-xs';

// ── 纯函数：解析 / 校验 / 差异 ──

function booleanFrom(raw: Record<string, unknown>, key: BooleanKey): boolean {
  const value = raw[key];
  return typeof value === 'boolean' ? value : DEFAULTS[key];
}

function numberFrom(raw: Record<string, unknown>, key: NumericKey): number {
  const value = raw[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value : DEFAULTS[key];
}

function stringsFrom(
  raw: Record<string, unknown>,
  key: 'egress_allow_hosts' | 'egress_deny_hosts' | 'host_read_roots' | 'host_write_roots',
): string[] {
  const value = raw[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : DEFAULTS[key];
}

function portsFrom(raw: Record<string, unknown>): number[] {
  const value = raw.egress_allow_ports;
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === 'number')
    : DEFAULTS.egress_allow_ports;
}

function settingsValues(raw: Record<string, unknown>): AgentHostSettings {
  return {
    enabled: booleanFrom(raw, 'enabled'),
    shell_enabled: booleanFrom(raw, 'shell_enabled'),
    shell_scope: raw.shell_scope === 'host' ? 'host' : 'workspace',
    shell_timeout_s: numberFrom(raw, 'shell_timeout_s'),
    shell_max_output_kb: numberFrom(raw, 'shell_max_output_kb'),
    fs_enabled: booleanFrom(raw, 'fs_enabled'),
    fs_max_bytes: numberFrom(raw, 'fs_max_bytes'),
    egress_enabled: booleanFrom(raw, 'egress_enabled'),
    egress_mode: EGRESS_MODES.includes(raw.egress_mode as EgressMode)
      ? raw.egress_mode as EgressMode : DEFAULTS.egress_mode,
    egress_allow_hosts: stringsFrom(raw, 'egress_allow_hosts'),
    egress_deny_hosts: stringsFrom(raw, 'egress_deny_hosts'),
    egress_allow_ports: portsFrom(raw),
    egress_max_bytes: numberFrom(raw, 'egress_max_bytes'),
    egress_max_per_turn: numberFrom(raw, 'egress_max_per_turn'),
    egress_max_per_minute: numberFrom(raw, 'egress_max_per_minute'),
    host_read_roots: stringsFrom(raw, 'host_read_roots'),
    host_write_roots: stringsFrom(raw, 'host_write_roots'),
    audit_log_retention_days: numberFrom(raw, 'audit_log_retention_days'),
  };
}

/** 文本域 → 数组：逗号与换行都算分隔，去空白、去空项。 */
function parseList(text: string): string[] {
  return text.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function sameList(left: unknown[], right: unknown[]): boolean {
  return left.length === right.length
    && left.every((item, index) => item === right[index]);
}

/**
 * 只提交真正变化的键（AC-G19 的唯一实现点）。数组按顺序整体比较；
 * 未改动的键一个都不进 payload，避免整表覆盖。
 */
function savePayload(
  values: AgentHostSettings, original: AgentHostSettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of BOOLEAN_KEYS) {
    if (values[key] !== original[key]) payload[key] = values[key];
  }
  if (values.shell_scope !== original.shell_scope) {
    payload.shell_scope = values.shell_scope;
  }
  if (values.egress_mode !== original.egress_mode) {
    payload.egress_mode = values.egress_mode;
  }
  for (const key of NUMERIC_KEYS) {
    if (values[key] !== original[key]) payload[key] = values[key];
  }
  for (const key of LIST_KEYS) {
    if (!sameList(values[key], original[key])) payload[key] = values[key];
  }
  return payload;
}

function hasNumericRangeError(values: AgentHostSettings): boolean {
  return NUMERIC_KEYS.some((key) => {
    const value = values[key];
    const { min, max } = LIMITS[key];
    return !Number.isInteger(value) || value < min || value > max;
  });
}

function isAbsolutePath(path: string): boolean {
  // POSIX、Windows 盘符、UNC 三种绝对路径；`~` 不是绝对路径。
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
    || path.startsWith('\\\\') || path.startsWith('//');
}

function isPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * 列表类键的越界判定；`null` 表示这一项合法。
 * 后端也会拒（§4.9 的 4 个新校验器），这里只是让保存按钮早点拦下。
 */
function listErrorKind(
  key: ListKey, list: readonly unknown[],
): 'tooLong' | 'invalidPort' | 'invalidPath' | null {
  if (list.length > LIST_META[key].max) return 'tooLong';
  if (key === 'egress_allow_ports') {
    return list.every((item) => isPort(Number(item))) ? null : 'invalidPort';
  }
  if (key === 'host_read_roots' || key === 'host_write_roots') {
    return list.every((item) => typeof item === 'string' && isAbsolutePath(item))
      ? null : 'invalidPath';
  }
  return null;
}

function hasListError(values: AgentHostSettings): boolean {
  return LIST_KEYS.some((key) => listErrorKind(key, values[key]) !== null);
}

/** 升到危险档位才需要二次确认；已在该档位时改别的键不再重复拦。 */
function needsConfirmation(
  values: AgentHostSettings, original: AgentHostSettings,
): { open: boolean; host: boolean } {
  return {
    open: values.egress_mode === 'open' && original.egress_mode !== 'open',
    host: values.shell_scope === 'host' && original.shell_scope !== 'host',
  };
}

/**
 * 只从错误对象上取白名单里的错误码，其余一律按内部错误处理。
 *
 * `http-client` 抛的是 `ApiError`，码在 `.code`（不是 `.errorCode`——那个字段
 * 只在内部解析体里出现）。取错字段的后果是：真实 400/429 全部显示成
 * "保存失败"，而 `agentHost.errors.*` 一条也用不上。
 */
function errorCodeOf(error: unknown): string {
  if (error instanceof ApiError) return error.code || 'internal_error';
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' && code ? code : 'internal_error';
}

// ── 状态 hook ──

/** 设置值的读取 / 编辑 / 保存（含区间校验与忙碌态）。 */
function useAgentHostSettings() {
  const [values, setValues] = useState<AgentHostSettings>(DEFAULTS);
  const original = useRef<AgentHostSettings>(DEFAULTS);
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
   * 返回错误码，成功时返回空串（成功后才更新 diff 基线）。
   * 错误码交给调用方查 `agentHost.errors`，面板不吞掉原因。
   */
  const save = useCallback(async (): Promise<string> => {
    if (saving || !isDirty) return '';
    setSaving(true);
    try {
      const result = await updateCategorySettings(CATEGORY, payload);
      if (!result.success) return 'internal_error';
      original.current = values;
      return '';
    } catch (error) {
      return errorCodeOf(error);
    } finally {
      setSaving(false);
    }
  }, [saving, isDirty, payload, values]);

  return {
    values, original: original.current, updateSetting, loading, loadError,
    saving, save, isDirty, rangesInvalid: hasNumericRangeError(values)
      || hasListError(values), reload,
  };
}

// ── 基础控件 ──

function ToggleField({ settingKey, checked, onChange }: {
  settingKey: BooleanKey;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const { t } = useLocale();
  const copy = t.agentHost;
  const { label, hint } = BOOLEAN_LABELS[settingKey];
  const id = `agent-host-${settingKey}`;
  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <input id={id} type="checkbox" className="mt-1" checked={checked}
          aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.checked)} />
        <label htmlFor={id} className="text-sm">{copy[label]}</label>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {copy[hint]}
      </p>
    </div>
  );
}

function LimitField({ settingKey, value, onChange }: {
  settingKey: NumericKey;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useLocale();
  const copy = t.agentHost;
  const { min, max, label, hint } = LIMITS[settingKey];
  const invalid = !Number.isInteger(value) || value < min || value > max;
  const id = `agent-host-${settingKey}`;
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">{copy[label]}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : hintId}
        onChange={(event) => onChange(event.target.value === ''
          ? Number.NaN : Number(event.target.value))}
        className={INPUT}
      />
      <p id={hintId} className="text-xs text-muted-foreground">{copy[hint]}</p>
      {invalid && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {copy.rangeHint.replace('{min}', String(min))
            .replace('{max}', String(max))}
        </p>
      )}
    </div>
  );
}

function ListField({ settingKey, value, onChange }: {
  settingKey: ListKey;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const { t } = useLocale();
  const copy = t.agentHost;
  const meta = LIST_META[settingKey];
  const serialized = value.join('\n');
  const [text, setText] = useState(serialized);
  // 外部重置（保存后重新加载）时同步文本，但不打断正在键入的内容。
  useEffect(() => {
    setText((current) => parseList(current).join('\n') === serialized
      ? current : serialized);
  }, [serialized]);
  const error = listErrorKind(settingKey, value);
  const id = `agent-host-${settingKey}`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">{copy[meta.label]}</label>
      <textarea id={id} rows={meta.rows} value={text} spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        onChange={(event) => { setText(event.target.value);
          onChange(parseList(event.target.value)); }}
        className={INPUT} />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {copy[meta.hint]}
      </p>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {copy[error === 'tooLong' ? 'listTooLong'
            : error === 'invalidPort' ? 'invalidPort' : 'invalidPath']
            .replace('{max}', String(meta.max))}
        </p>
      )}
    </div>
  );
}

function ChoiceField<T extends string>({ settingKey, legend, options, labels, value, onSelect, hint }: {
  settingKey: string;
  legend: string;
  options: readonly T[];
  labels: Record<T, CopyKey>;
  value: T;
  onSelect: (value: T) => void;
  hint?: string;
}) {
  const { t } = useLocale();
  const copy = t.agentHost;
  // WAI-ARIA radiogroup：一个 Tab 停靠点，方向键移动选中项。
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = options.indexOf(value);
    const next = options[(index + step + options.length) % options.length];
    onSelect(next);
    document.getElementById(`agent-host-${settingKey}-${next}`)?.focus();
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm">{legend}</legend>
      <div role="radiogroup" aria-label={legend} onKeyDown={onKeyDown}
        className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option} type="button" role="radio"
            id={`agent-host-${settingKey}-${option}`}
            aria-checked={value === option}
            tabIndex={value === option ? 0 : -1}
            onClick={() => onSelect(option)}
            className={`${BUTTON} ${value === option ? 'border-primary bg-accent' : ''}`}>
            {copy[labels[option]]}
          </button>
        ))}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </fieldset>
  );
}

function ConfirmField({ id, label, checked, onChange }: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <input id={id} type="checkbox" className="mt-1" checked={checked}
        onChange={(event) => onChange(event.target.checked)} />
      <label htmlFor={id} className="text-sm">{label}</label>
    </div>
  );
}

// ── 分区 ──

type SectionsProps = {
  values: AgentHostSettings;
  update: UpdateSetting;
  openAck: boolean;
  hostAck: boolean;
  setOpenAck: (checked: boolean) => void;
  setHostAck: (checked: boolean) => void;
};

function CapabilitySection({ values, update }: SectionsProps) {
  const { t } = useLocale();
  const copy = t.agentHost;
  return (
    <SettingsSectionCard title={copy.sectionCapabilities}>
      <div role="note" className={NOTE}>
        <p>{copy.notSandbox}</p>
      </div>
      <ToggleField settingKey="enabled" checked={values.enabled}
        onChange={(checked) => update('enabled', checked)} />
      <ToggleField settingKey="fs_enabled" checked={values.fs_enabled}
        onChange={(checked) => update('fs_enabled', checked)} />
      <LimitField settingKey="fs_max_bytes" value={values.fs_max_bytes}
        onChange={(value) => update('fs_max_bytes', value)} />
    </SettingsSectionCard>
  );
}

function ShellSection({ values, update, hostAck, setHostAck }: SectionsProps) {
  const { t } = useLocale();
  const copy = t.agentHost;
  return (
    <SettingsSectionCard title={copy.sectionShell}>
      <ToggleField settingKey="shell_enabled" checked={values.shell_enabled}
        onChange={(checked) => update('shell_enabled', checked)} />
      <ChoiceField settingKey="scope" legend={copy.shellScope}
        options={SCOPES} labels={SCOPE_LABELS} value={values.shell_scope}
        hint={copy.shellScopeHint}
        onSelect={(scope) => update('shell_scope', scope)} />
      {values.shell_scope === 'host' && (
        <ConfirmField id="agent-host-scope-confirm" label={copy.hostConfirm}
          checked={hostAck} onChange={setHostAck} />
      )}
      <LimitField settingKey="shell_timeout_s" value={values.shell_timeout_s}
        onChange={(value) => update('shell_timeout_s', value)} />
      <LimitField settingKey="shell_max_output_kb"
        value={values.shell_max_output_kb}
        onChange={(value) => update('shell_max_output_kb', value)} />
    </SettingsSectionCard>
  );
}

function EgressSection({ values, update, openAck, setOpenAck }: SectionsProps) {
  const { t } = useLocale();
  const copy = t.agentHost;
  return (
    <SettingsSectionCard title={copy.sectionEgress}>
      <ToggleField settingKey="egress_enabled" checked={values.egress_enabled}
        onChange={(checked) => update('egress_enabled', checked)} />
      <ChoiceField settingKey="egress-mode" legend={copy.egressMode}
        options={EGRESS_MODES} labels={MODE_LABELS} value={values.egress_mode}
        hint={copy.egressModeHint}
        onSelect={(mode) => update('egress_mode', mode)} />
      {values.egress_mode === 'open' && (
        <div role="note" className={NOTE}>
          <p className="font-medium text-destructive">{copy.openWarningTitle}</p>
          <p>{copy.openWarning}</p>
          <ConfirmField id="agent-host-egress-confirm" label={copy.openConfirm}
            checked={openAck} onChange={setOpenAck} />
        </div>
      )}
      <ListField settingKey="egress_allow_hosts"
        value={values.egress_allow_hosts}
        onChange={(list) => update('egress_allow_hosts', list)} />
      <ListField settingKey="egress_deny_hosts" value={values.egress_deny_hosts}
        onChange={(list) => update('egress_deny_hosts', list)} />
      <ListField settingKey="egress_allow_ports"
        value={values.egress_allow_ports.map(String)}
        onChange={(list) => update('egress_allow_ports',
          list.map(Number).filter((port) => !Number.isNaN(port)))} />
      <LimitField settingKey="egress_max_bytes" value={values.egress_max_bytes}
        onChange={(value) => update('egress_max_bytes', value)} />
      <LimitField settingKey="egress_max_per_turn"
        value={values.egress_max_per_turn}
        onChange={(value) => update('egress_max_per_turn', value)} />
      <LimitField settingKey="egress_max_per_minute"
        value={values.egress_max_per_minute}
        onChange={(value) => update('egress_max_per_minute', value)} />
    </SettingsSectionCard>
  );
}

function HostAccessSection({ values, update }: SectionsProps) {
  const { t } = useLocale();
  const copy = t.agentHost;
  return (
    <SettingsSectionCard title={copy.sectionHostAccess}
      description={copy.shellScopeHint}>
      <ListField settingKey="host_read_roots" value={values.host_read_roots}
        onChange={(list) => update('host_read_roots', list)} />
      <ListField settingKey="host_write_roots" value={values.host_write_roots}
        onChange={(list) => update('host_write_roots', list)} />
      {!values.host_read_roots.length && !values.host_write_roots.length && (
        <p className="text-xs text-muted-foreground">{copy.emptyListHint}</p>
      )}
    </SettingsSectionCard>
  );
}

function AuditSection({ values, update }: SectionsProps) {
  const { t } = useLocale();
  const copy = t.agentHost;
  return (
    <SettingsSectionCard title={copy.sectionAudit}>
      <LimitField settingKey="audit_log_retention_days"
        value={values.audit_log_retention_days}
        onChange={(value) => update('audit_log_retention_days', value)} />
    </SettingsSectionCard>
  );
}

// 组件主体只有 JSX 组合与保存流程；校验、差异与加载都在上面的纯函数与 hook 里。
export default function AgentHostSettingsPanel() {
  const { t } = useLocale();
  const copy = t.agentHost;
  const panel = useAgentHostSettings();
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [openAck, setOpenAck] = useState(false);
  const [hostAck, setHostAck] = useState(false);

  const confirm = needsConfirmation(panel.values, panel.original);
  const missingConfirm = (confirm.open && !openAck) || (confirm.host && !hostAck);
  const sections: SectionsProps = {
    values: panel.values,
    update: panel.updateSetting,
    openAck, hostAck, setOpenAck, setHostAck,
  };

  const submit = async () => {
    if (missingConfirm) {
      setNoticeError(true);
      setNotice(copy.saveBlockedConfirm);
      return;
    }
    const code = await panel.save();
    setNoticeError(Boolean(code));
    // 只有登记过的码才查文案表；未登记的码（含内部错误）一律走通用兜底，
    // 绝不用后端原文填这一行（`agentHostStatus` 的唯一消费点）。
    setNotice(!code ? copy.saved
      : isKnownAgentHostCode(code) ? copy.errors[code] ?? copy.saveFailed
        : copy.saveFailed);
    if (!code) { setOpenAck(false); setHostAck(false); }
  };

  if (panel.loading) return <p role="status" className="p-6">{copy.loading}</p>;
  if (panel.loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-sm text-destructive">{copy.loadFailed}</p>
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
            disabled={panel.saving || !panel.isDirty || panel.rangesInvalid
              || missingConfirm}
            onClick={() => void submit()}>
            {panel.saving ? copy.saving : t.adminSettings.save}
          </button>
        </header>
        <div aria-live={noticeError ? 'assertive' : 'polite'}
          role={noticeError ? 'alert' : 'status'} className={noticeError
            ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
          {notice}
        </div>
        {missingConfirm && (
          <p role="alert" className="text-sm text-destructive">
            {copy.saveBlockedConfirm}
          </p>
        )}

        <CapabilitySection {...sections} />
        <ShellSection {...sections} />
        <EgressSection {...sections} />
        <HostAccessSection {...sections} />
        <AuditSection {...sections} />
      </fieldset>
    </div>
  );
}
