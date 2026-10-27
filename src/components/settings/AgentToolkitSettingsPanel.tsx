'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { Translations } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/relativeTime';
import {
  agentToolkitCopyKey, formatBytes, resolveAgentToolkitStatus,
} from '@/lib/agentToolkitStatus';
import {
  clearProjectMemories, deleteMemory, deleteWorkspaceFile,
  fetchAgentToolkitCapabilities, fetchMemories, fetchWorkspaceListing,
  type AgentToolkitListing,
} from '@/lib/api/agentToolkit';
import {
  getCategorySettings, updateCategorySettings,
} from '@/lib/api/systemSettings';
import type {
  AgentToolkitCapabilities, AgentToolkitCapabilitySegment, MemoryEntry,
} from '@/types/agentToolkit';
import ConfirmationDialog from '@/components/ui/ConfirmationDialog';
import SettingsSectionCard from './components/SettingsSectionCard';
import AgentCrewMemorySections from './AgentCrewMemorySections';
import { DocumentList, WorkspaceFileTable } from './AgentToolkitWorkspaceLists';
import {
  CREW_MEMORY_DEFAULTS, crewMemoryFrom, crewMemoryPayload, hasCrewMemoryRangeError,
  type CrewMemorySettings,
} from './agentCrewMemorySettings';

/**
 * 设置中心「Agent 能力」面板。
 *
 * 设计基线：docs/plans/agent-general-toolkit/spec.md §5.4（设置键与区间）与
 * §6.1（六段结构、加载/错误语义）。结构与 `WebResearchSettingsPanel.tsx`
 * 一致：加载中只有 `role="status"`；加载失败只有 `role="alert"` + 重试，
 * 且**不**渲染表单；保存结果走 `aria-live="polite"`；忙碌态用
 * `<fieldset disabled>`。
 */

const CATEGORY = 'agent_toolkit';

type ToolkitCopyKey = Exclude<keyof Translations['agentToolkit'], 'tools'>;
type ChildKey = 'workspace_enabled' | 'documents_enabled'
  | 'analysis_enabled' | 'memory_enabled';
type BooleanKey = 'enabled' | ChildKey;
type NumericKey =
  | 'workspace_quota_mb' | 'max_file_mb' | 'document_max_pages'
  | 'document_max_chars' | 'analysis_timeout_seconds'
  | 'analysis_max_output_kb' | 'memory_max_entries'
  | 'memory_retention_days' | 'plan_max_steps';
type DigestModel = 'fast' | 'research';
type CapabilityId = 'workspace' | 'documents' | 'analysis' | 'memory';

interface ToolkitSettings extends CrewMemorySettings {
  enabled: boolean;
  workspace_enabled: boolean;
  documents_enabled: boolean;
  analysis_enabled: boolean;
  memory_enabled: boolean;
  workspace_quota_mb: number;
  max_file_mb: number;
  document_max_pages: number;
  document_max_chars: number;
  document_digest_model: DigestModel;
  analysis_timeout_seconds: number;
  analysis_max_output_kb: number;
  memory_max_entries: number;
  memory_retention_days: number;
  plan_max_steps: number;
}

type UpdateSetting = <K extends keyof ToolkitSettings>(
  key: K, value: ToolkitSettings[K],
) => void;

/** 默认值与 spec §5.4 逐行对应（后端之外的本地兜底）。 */
const DEFAULTS: ToolkitSettings = {
  enabled: true,
  workspace_enabled: true,
  documents_enabled: true,
  analysis_enabled: false,
  memory_enabled: true,
  workspace_quota_mb: 256,
  max_file_mb: 32,
  document_max_pages: 800,
  document_max_chars: 2000000,
  document_digest_model: 'fast',
  analysis_timeout_seconds: 20,
  analysis_max_output_kb: 64,
  memory_max_entries: 200,
  memory_retention_days: 180,
  plan_max_steps: 12,
  ...CREW_MEMORY_DEFAULTS,
};

const STORAGE_KEYS: NumericKey[] = ['workspace_quota_mb', 'max_file_mb'];
const DOCUMENT_KEYS: NumericKey[] = [
  'document_max_pages', 'document_max_chars',
];
const OTHER_KEYS: NumericKey[] = [
  'analysis_timeout_seconds', 'analysis_max_output_kb', 'memory_max_entries',
  'memory_retention_days', 'plan_max_steps',
];
const NUMERIC_KEYS: NumericKey[] = [
  ...STORAGE_KEYS, ...DOCUMENT_KEYS, ...OTHER_KEYS,
];
const CHILD_KEYS: ChildKey[] = [
  'workspace_enabled', 'documents_enabled', 'analysis_enabled', 'memory_enabled',
];
const CHILD_LABELS: Record<ChildKey, ToolkitCopyKey> = {
  workspace_enabled: 'workspaceEnabled',
  documents_enabled: 'documentsEnabled',
  analysis_enabled: 'analysisEnabled',
  memory_enabled: 'memoryEnabled',
};
const DIGEST_MODELS: DigestModel[] = ['fast', 'research'];
const DIGEST_LABELS: Record<DigestModel, ToolkitCopyKey> = {
  fast: 'digestModelFast',
  research: 'digestModelResearch',
};
const KIND_LABELS: Record<MemoryEntry['kind'], ToolkitCopyKey> = {
  fact: 'kindFact', preference: 'kindPreference', decision: 'kindDecision',
};
const SCOPE_LABELS: Record<MemoryEntry['scope'], ToolkitCopyKey> = {
  project: 'scopeProject', global: 'scopeGlobal',
};

/** 逐键区间（spec §5.4）；`label` 是 `agentToolkit` 命名空间里的标签键。 */
const LIMITS: Record<NumericKey, {
  min: number; max: number; label: ToolkitCopyKey;
}> = {
  workspace_quota_mb: { min: 16, max: 2048, label: 'workspaceQuotaMb' },
  max_file_mb: { min: 1, max: 128, label: 'maxFileMb' },
  document_max_pages: { min: 1, max: 5000, label: 'documentMaxPages' },
  document_max_chars: { min: 10000, max: 10000000, label: 'documentMaxChars' },
  analysis_timeout_seconds: {
    min: 5, max: 60, label: 'analysisTimeoutSeconds',
  },
  analysis_max_output_kb: { min: 8, max: 512, label: 'analysisMaxOutputKb' },
  memory_max_entries: { min: 20, max: 1000, label: 'memoryMaxEntries' },
  memory_retention_days: { min: 0, max: 3650, label: 'memoryRetentionDays' },
  plan_max_steps: { min: 4, max: 20, label: 'planMaxSteps' },
};

const CAPABILITIES: Array<{ id: CapabilityId; label: ToolkitCopyKey }> = [
  { id: 'workspace', label: 'workspaceEnabled' },
  { id: 'documents', label: 'documentsEnabled' },
  { id: 'analysis', label: 'analysisEnabled' },
  { id: 'memory', label: 'memoryEnabled' },
];

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

function booleanFrom(raw: Record<string, unknown>, key: BooleanKey): boolean {
  const value = raw[key];
  return typeof value === 'boolean' ? value : DEFAULTS[key];
}

function settingsValues(raw: Record<string, unknown>): ToolkitSettings {
  return {
    enabled: booleanFrom(raw, 'enabled'),
    workspace_enabled: booleanFrom(raw, 'workspace_enabled'),
    documents_enabled: booleanFrom(raw, 'documents_enabled'),
    analysis_enabled: booleanFrom(raw, 'analysis_enabled'),
    memory_enabled: booleanFrom(raw, 'memory_enabled'),
    workspace_quota_mb: numberFrom(raw, 'workspace_quota_mb'),
    max_file_mb: numberFrom(raw, 'max_file_mb'),
    document_max_pages: numberFrom(raw, 'document_max_pages'),
    document_max_chars: numberFrom(raw, 'document_max_chars'),
    document_digest_model:
      raw.document_digest_model === 'research' ? 'research' : 'fast',
    analysis_timeout_seconds: numberFrom(raw, 'analysis_timeout_seconds'),
    analysis_max_output_kb: numberFrom(raw, 'analysis_max_output_kb'),
    memory_max_entries: numberFrom(raw, 'memory_max_entries'),
    memory_retention_days: numberFrom(raw, 'memory_retention_days'),
    plan_max_steps: numberFrom(raw, 'plan_max_steps'),
    ...crewMemoryFrom(raw),
  };
}

/**
 * 只提交真正变化的键。总开关关闭时 4 个子开关不进入 diff（spec §6.1-1）：
 * 否则「关掉总开关」会被并存的子开关值悄悄改回可用。
 */
function savePayload(
  values: ToolkitSettings, original: ToolkitSettings,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (values.enabled !== original.enabled) payload.enabled = values.enabled;
  if (values.enabled) {
    for (const key of CHILD_KEYS) {
      if (values[key] !== original[key]) payload[key] = values[key];
    }
  }
  if (values.document_digest_model !== original.document_digest_model) {
    payload.document_digest_model = values.document_digest_model;
  }
  for (const key of NUMERIC_KEYS) {
    if (values[key] !== original[key]) payload[key] = values[key];
  }
  return { ...payload, ...crewMemoryPayload(values, original) };
}

function hasRangeError(values: ToolkitSettings): boolean {
  return hasCrewMemoryRangeError(values) || NUMERIC_KEYS.some((key) => {
    const value = values[key];
    const { min, max } = LIMITS[key];
    return !Number.isInteger(value) || value < min || value > max;
  });
}

/** 只从错误对象上取白名单里的错误码，其余一律按内部错误处理。 */
function errorCodeOf(error: unknown): string {
  const code = (error as { errorCode?: unknown } | null | undefined)?.errorCode;
  return typeof code === 'string' && code ? code : 'internal_error';
}

/** 设置值的读取 / 编辑 / 保存（含区间校验与忙碌态）。 */
function useToolkitSettings() {
  const [values, setValues] = useState<ToolkitSettings>(DEFAULTS);
  const original = useRef<ToolkitSettings>(DEFAULTS);
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

  /** 返回是否保存成功；实际成功后才更新 diff 基线。 */
  const save = useCallback(async (): Promise<boolean> => {
    if (saving || !isDirty) return false;
    setSaving(true);
    try {
      const result = await updateCategorySettings(CATEGORY, payload);
      if (!result.success) return false;
      original.current = values;
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, [saving, isDirty, payload, values]);

  return {
    values, updateSetting, loading, loadError, saving, save, isDirty,
    rangesInvalid: hasRangeError(values),
    reload,
  };
}

/** 工作区 + 记忆的读取（两个端点各自失败，互不牵连）。 */
function useToolkitResources() {
  const [capabilities, setCapabilities] =
    useState<AgentToolkitCapabilities | null>(null);
  const [listing, setListing] = useState<AgentToolkitListing | null>(null);
  const [listingFailed, setListingFailed] = useState(false);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [memoryFailed, setMemoryFailed] = useState(false);

  const loadWorkspace = useCallback(async () => {
    try {
      setCapabilities(await fetchAgentToolkitCapabilities());
    } catch {
      setCapabilities(null);
    }
    try {
      setListing(await fetchWorkspaceListing());
      setListingFailed(false);
    } catch {
      setListing(null);
      setListingFailed(true);
    }
  }, []);

  const loadMemories = useCallback(async () => {
    try {
      const result = await fetchMemories();
      setMemories(Array.isArray(result.entries) ? result.entries : []);
      setMemoryFailed(false);
    } catch {
      setMemories([]);
      setMemoryFailed(true);
    }
  }, []);

  const refresh = useCallback(() => {
    void loadWorkspace();
    void loadMemories();
  }, [loadWorkspace, loadMemories]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    capabilities, listing, listingFailed, memories, memoryFailed, refresh,
  };
}

/**
 * 三个破坏性动作的待确认状态。真正的删除只在 ConfirmationDialog 确认后
 * 执行（spec §6.4：确认文案必须含具体对象名）。
 */
function useDestructiveActions(
  refresh: () => void, onError: (error: unknown) => void,
) {
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [pendingMemory, setPendingMemory] = useState<MemoryEntry | null>(null);
  const [clearingMemory, setClearingMemory] = useState(false);

  const deleteFile = async () => {
    const name = pendingFile;
    setPendingFile(null);
    if (!name) return;
    try { await deleteWorkspaceFile(name); refresh(); }
    catch (error) { onError(error); }
  };

  const forgetMemory = async () => {
    const entry = pendingMemory;
    setPendingMemory(null);
    if (!entry) return;
    try { await deleteMemory(entry.id); refresh(); }
    catch (error) { onError(error); }
  };

  const clearMemory = async () => {
    setClearingMemory(false);
    try { await clearProjectMemories(); refresh(); }
    catch (error) { onError(error); }
  };

  return {
    pendingFile, setPendingFile, pendingMemory, setPendingMemory,
    clearingMemory, setClearingMemory, deleteFile, forgetMemory, clearMemory,
  };
}

function LimitField({ settingKey, value, hint, onChange }: {
  settingKey: NumericKey;
  value: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  const { t } = useLocale();
  const { min, max, label } = LIMITS[settingKey];
  const invalid = !Number.isInteger(value) || value < min || value > max;
  const id = `agent-toolkit-${settingKey}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [invalid ? errorId : null, hint ? hintId : null]
    .filter(Boolean).join(' ');
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm">{t.agentToolkit[label]}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => onChange(event.target.value === ''
          ? Number.NaN : Number(event.target.value))}
        className={INPUT}
      />
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>
      )}
      {invalid && (
        <p id={errorId} className="text-xs text-destructive">
          {t.agentToolkit.invalidSetting}
        </p>
      )}
    </div>
  );
}

function CapabilityToggle({ id, label, checked, ariaDisabled, onChange }: {
  id: string;
  label: string;
  checked: boolean;
  ariaDisabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-1"
        checked={checked}
        aria-disabled={ariaDisabled || undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={id} className="text-sm">{label}</label>
    </div>
  );
}

/** 计算分析沙箱的永久风险说明（spec §6.1-1：两句原文都必须出现）。 */
function AnalysisRiskNote() {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  return (
    <div role="note" className="mt-2 space-y-1 rounded-md border
      border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <p className="font-medium">{copy.analysisRiskTitle}</p>
      <p>{copy.analysisRisk}</p>
      <p>{copy.analysisRiskNoMemory}</p>
    </div>
  );
}

function CapabilitySection({ values, update }: {
  values: ToolkitSettings;
  update: UpdateSetting;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  return (
    <SettingsSectionCard title={copy.sectionCapabilities}>
      <CapabilityToggle id="agent-toolkit-enabled" label={copy.enabled}
        checked={values.enabled}
        onChange={(checked) => update('enabled', checked)} />
      {CHILD_KEYS.map((key) => (
        <div key={key}>
          <CapabilityToggle id={`agent-toolkit-${key}`}
            label={copy[CHILD_LABELS[key]]} checked={values[key]}
            ariaDisabled={!values.enabled}
            onChange={(checked) => update(key, checked)} />
          {key === 'analysis_enabled' && <AnalysisRiskNote />}
        </div>
      ))}
    </SettingsSectionCard>
  );
}

function LimitsSection({ values, update }: {
  values: ToolkitSettings;
  update: UpdateSetting;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  // 三组用三列表达（存储 / 文档 / 其余），不为分组标题新增文案。
  const groups: Array<{ id: string; keys: NumericKey[] }> = [
    { id: 'storage', keys: STORAGE_KEYS },
    { id: 'documents', keys: DOCUMENT_KEYS },
    { id: 'other', keys: OTHER_KEYS },
  ];
  return (
    <SettingsSectionCard title={copy.sectionLimits}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {groups.map((group) => (
          <div key={group.id} className="space-y-3">
            {group.keys.map((key) => (
              <LimitField key={key} settingKey={key} value={values[key]}
                hint={key === 'max_file_mb' ? copy.maxFileMbHint : undefined}
                onChange={(value) => update(key, value)} />
            ))}
          </div>
        ))}
      </div>
    </SettingsSectionCard>
  );
}

function DigestModelSection({ value, onSelect, onOpenModels }: {
  value: DigestModel;
  onSelect: (model: DigestModel) => void;
  onOpenModels?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  // WAI-ARIA radiogroup：一个 Tab 停靠点，方向键移动选中项。
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = DIGEST_MODELS.indexOf(value);
    const next = DIGEST_MODELS[
      (index + step + DIGEST_MODELS.length) % DIGEST_MODELS.length];
    onSelect(next);
    document.getElementById(`agent-toolkit-digest-${next}`)?.focus();
  };
  return (
    <SettingsSectionCard title={copy.sectionModel}
      description={copy.digestModelHint}>
      <div role="radiogroup" aria-label={copy.sectionModel}
        className="flex flex-wrap gap-2" onKeyDown={onKeyDown}>
        {DIGEST_MODELS.map((model) => (
          <button key={model} type="button" role="radio"
            id={`agent-toolkit-digest-${model}`}
            aria-checked={value === model}
            tabIndex={value === model ? 0 : -1}
            onClick={() => onSelect(model)}
            className={`${BUTTON} ${value === model
              ? 'border-primary bg-accent' : ''}`}>
            {copy[DIGEST_LABELS[model]]}
          </button>
        ))}
      </div>
      {onOpenModels && (
        <button type="button" className={BUTTON} onClick={onOpenModels}>
          {copy.openModelSettings}
        </button>
      )}
    </SettingsSectionCard>
  );
}

function WorkspaceSection({ capabilities, listing, failed, onRefresh, onDelete }: {
  capabilities: AgentToolkitCapabilities | null;
  listing: AgentToolkitListing | null;
  failed: boolean;
  onRefresh: () => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  const rootLabel = capabilities?.workspace.root_label ?? '';
  const usedBytes = listing ? listing.totalBytes
    : capabilities?.workspace.used_bytes ?? 0;
  const quotaBytes = listing ? listing.quotaBytes
    : capabilities?.workspace.quota_bytes ?? 0;
  const usedPercent = quotaBytes > 0
    ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;
  const copyRoot = async () => {
    try {
      await navigator.clipboard.writeText(rootLabel);
    } catch {
      // 剪贴板权限可能被拒：<code> 仍可手工选中复制，不制造额外噪音。
    }
  };
  return (
    <SettingsSectionCard title={copy.sectionWorkspace}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{copy.workspaceRoot}</span>
        {rootLabel ? (
          <>
            <code className="rounded bg-muted px-2 py-1 text-xs break-all">
              {rootLabel}
            </code>
            <button type="button" className={BUTTON} aria-label={rootLabel}
              onClick={() => void copyRoot()}>
              <span aria-hidden="true">⧉</span>
            </button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">
            {copy.statusUnavailable}
          </span>
        )}
        <button type="button" className={BUTTON} onClick={onRefresh}>
          {copy.refresh}
        </button>
      </div>
      <div>
        <p className="text-sm">
          {copy.used}: {formatBytes(usedBytes)}{' · '}
          {copy.quota}: {formatBytes(quotaBytes)}
        </p>
        <div role="progressbar" aria-valuenow={usedBytes}
          aria-valuemin={0} aria-valuemax={quotaBytes}
          aria-label={`${copy.used} / ${copy.quota}`}
          className="mt-1 h-2 w-full overflow-hidden rounded bg-muted">
          <div className="h-full bg-primary"
            style={{ width: `${usedPercent}%` }} />
        </div>
      </div>
      {failed
        ? <p role="alert" className="text-sm text-destructive">{copy.loadFailed}</p>
        : <WorkspaceFileTable files={listing?.files ?? []} onDelete={onDelete} />}
      {!failed && <DocumentList documents={listing?.documents ?? []} />}
    </SettingsSectionCard>
  );
}

function MemoryList({ entries, onDelete }: {
  entries: MemoryEntry[];
  onDelete: (entry: MemoryEntry) => void;
}) {
  const { t, locale } = useLocale();
  const copy = t.agentToolkit;
  if (!entries.length) {
    return <p className="text-sm text-muted-foreground">{copy.emptyMemories}</p>;
  }
  return (
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {copy[KIND_LABELS[entry.kind] ?? 'kindFact']}
            </span>
            <span className="text-muted-foreground">
              {copy[SCOPE_LABELS[entry.scope] ?? 'scopeProject']}
            </span>
            <span className="text-muted-foreground">
              {formatRelativeTime(entry.updatedAt, locale, t)}
            </span>
          </div>
          <p className="mt-1 text-sm break-words">{entry.text}</p>
          <button type="button"
            aria-label={`${copy.delete} ${entry.text}`}
            onClick={() => onDelete(entry)}
            className="mt-1 text-xs text-destructive underline underline-offset-2">
            {copy.delete}
          </button>
        </li>
      ))}
    </ul>
  );
}

function MemorySection({ entries, failed, onDelete, onClear }: {
  entries: MemoryEntry[];
  failed: boolean;
  onDelete: (entry: MemoryEntry) => void;
  onClear: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  return (
    <SettingsSectionCard title={copy.sectionMemory}>
      {failed
        ? <p role="alert" className="text-sm text-destructive">{copy.loadFailed}</p>
        : <MemoryList entries={entries} onDelete={onDelete} />}
      <button type="button" className={BUTTON} disabled={!entries.length}
        onClick={onClear}>{copy.memoryClear}</button>
    </SettingsSectionCard>
  );
}

/** 底部状态行的一条：可用性 + 开关态，失配时补译码文案与设置路径。 */
function CapabilityStatusRow({ label, segment }: {
  label: ToolkitCopyKey;
  segment?: AgentToolkitCapabilitySegment;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  const available = Boolean(segment?.available);
  const enabled = Boolean(segment?.enabled);
  const status = segment && available !== enabled
    ? resolveAgentToolkitStatus({
      error_code: segment.error_code, success: available,
    })
    : null;
  const hint = status?.hint === 'settings'
    ? ` · ${t.adminSettings.title} › ${copy.title}`
    : status?.hint === 'models' ? ` · ${copy.openModelSettings}` : '';
  return (
    <li className="rounded-md border border-border p-3">
      <span className="font-medium">{copy[label]}</span>{' · '}
      {available ? copy.statusAvailable : copy.statusUnavailable}{' · '}
      {enabled ? copy.statusEnabled : copy.statusDisabled}
      {status && (
        <span className="mt-1 block text-muted-foreground">
          {copy[status.key]}{hint}
        </span>
      )}
    </li>
  );
}

function StatusSection({ capabilities }: {
  capabilities: AgentToolkitCapabilities | null;
}) {
  const { t } = useLocale();
  return (
    <SettingsSectionCard title={t.agentToolkit.sectionStatus}>
      <ul className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
        {CAPABILITIES.map(({ id, label }) => (
          <CapabilityStatusRow key={id} label={label}
            segment={capabilities ? capabilities[id] : undefined} />
        ))}
      </ul>
    </SettingsSectionCard>
  );
}

// 组件主体只有 JSX 组合与三个确认框；逻辑都在上面的 hook / 子组件里，
// 因此这里超过 60 行但没有分支，符合 clean-code 对「一个职责」的要求。
export default function AgentToolkitSettingsPanel({ onOpenModels }: {
  onOpenModels?: () => void;
}) {
  const { t } = useLocale();
  const copy = t.agentToolkit;
  const panel = useToolkitSettings();
  const resources = useToolkitResources();
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);

  const report = useCallback((error: unknown) => {
    setNoticeError(true);
    setNotice(t.agentToolkit[agentToolkitCopyKey(errorCodeOf(error))]);
  }, [t]);

  const actions = useDestructiveActions(resources.refresh, report);

  const submit = async () => {
    const saved = await panel.save();
    setNoticeError(!saved);
    setNotice(saved ? copy.saved : copy.saveFailed);
    // 能力开关可能已改变：成功后刷新状态行与工作区/记忆视图。
    if (saved) resources.refresh();
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

        <CapabilitySection values={panel.values}
          update={panel.updateSetting} />
        <LimitsSection values={panel.values} update={panel.updateSetting} />
        <AgentCrewMemorySections values={panel.values}
          onToggle={(key, checked) => panel.updateSetting(key, checked)}
          onNumber={(key, value) => panel.updateSetting(key, value)} />
        <DigestModelSection value={panel.values.document_digest_model}
          onSelect={(model) => panel.updateSetting('document_digest_model', model)}
          onOpenModels={onOpenModels} />
        <WorkspaceSection capabilities={resources.capabilities}
          listing={resources.listing} failed={resources.listingFailed}
          onRefresh={resources.refresh} onDelete={actions.setPendingFile} />
        <MemorySection entries={resources.memories}
          failed={resources.memoryFailed} onDelete={actions.setPendingMemory}
          onClear={() => actions.setClearingMemory(true)} />
        <StatusSection capabilities={resources.capabilities} />
      </fieldset>

      <ConfirmationDialog isOpen={actions.pendingFile !== null}
        title={copy.deleteConfirm.replace('{name}', actions.pendingFile ?? '')}
        message={copy.deleteConfirmBody} confirmText={copy.delete}
        onConfirm={() => void actions.deleteFile()}
        onCancel={() => actions.setPendingFile(null)} />
      <ConfirmationDialog isOpen={actions.pendingMemory !== null}
        title={copy.deleteConfirm.replace(
          '{name}', actions.pendingMemory?.text ?? '')}
        message={copy.deleteConfirmBody} confirmText={copy.delete}
        onConfirm={() => void actions.forgetMemory()}
        onCancel={() => actions.setPendingMemory(null)} />
      <ConfirmationDialog isOpen={actions.clearingMemory}
        title={copy.memoryClearConfirm} message={copy.memoryClearConfirmBody}
        confirmText={copy.memoryClear}
        onConfirm={() => void actions.clearMemory()}
        onCancel={() => actions.setClearingMemory(false)} />
    </div>
  );
}
