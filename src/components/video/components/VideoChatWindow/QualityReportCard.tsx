'use client';

/**
 * QualityReportCard — `check_timeline` 的静态自检报告卡片，并在同一文件里
 * 导出 `ExportInspectCard`（`inspect_export` 的成品探测 + 视觉抽检）。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §7.1（自检卡片 +
 * `ExportInspectReport` 视图）、§4.10（15 条规则）、§4.12（降级矩阵）。
 *
 * 五条纪律：
 *   1. 有 blocker 时**不得**出现绿色文案（§4.10 的前置闸门）；
 *   2. `suggested_tool` 只预填一条用户消息，绝不直接执行工具——保持
 *      "用户可见、可撤销"（§7.1 第 2 条）；
 *   3. `checked_rules` 折叠展示，让用户知道"哪些查了、哪些没查"；
 *   4. 成品探测的 `skipped[]` 必须逐条列出：没测的项目不能被渲染成"通过"；
 *   5. 失败态 `role="alert"` + 错误码 + 设置路径（AC-23）。
 */

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentToolCallRecord } from '@/types';
import {
  agentVisionEnvelope, type TimelineLintIssue,
} from '@/types/agentVision';
import { sendPrefilledMessage }
  from '@/lib/video-editing-agent/prefilledMessage';
import {
  numberOf, recordOf, SeverityDot, severityOf, textOf, VisionFailureNote,
} from './VisionObservationCard';

export interface QualityCardProps {
  toolCall: AgentToolCallRecord;
  /** 提供时失败态给出"打开视觉设置"按钮（宿主目前不传）。 */
  onOpenSettings?: () => void;
}

/** §4.10 的规则总数（只用于"全部 N 项通过"的兜底文案）。 */
const LINT_RULE_COUNT = 15;

// ── 读取 ──────────────────────────────────────────────────────────────────

function readTarget(
  value: unknown,
): TimelineLintIssue['target'] | undefined {
  const raw = recordOf(value);
  const target: NonNullable<TimelineLintIssue['target']> = {};
  if (textOf(raw.itemId)) target.itemId = textOf(raw.itemId);
  if (textOf(raw.trackId)) target.trackId = textOf(raw.trackId);
  const seconds = numberOf(raw.at_seconds);
  if (seconds !== null) target.at_seconds = seconds;
  return Object.keys(target).length > 0 ? target : undefined;
}

function readIssues(value: unknown): TimelineLintIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: TimelineLintIssue[] = [];
  for (const item of value) {
    const entry = recordOf(item);
    const code = textOf(entry.code);
    if (!code) continue;
    const target = readTarget(entry.target);
    const tool = textOf(entry.suggested_tool);
    issues.push({
      code,
      severity: severityOf(entry.severity),
      message: textOf(entry.message),
      ...(target ? { target } : {}),
      ...(tool ? { suggested_tool: tool } : {}),
    });
  }
  return issues;
}

/** 成品探测的 issue 用 `note` / `at_seconds`，归一成自检的同一种行形状。 */
function readExportIssues(value: unknown): TimelineLintIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: TimelineLintIssue[] = [];
  for (const item of value) {
    const entry = recordOf(item);
    const code = textOf(entry.code);
    if (!code) continue;
    const seconds = numberOf(entry.at_seconds);
    issues.push({
      code,
      severity: severityOf(entry.severity),
      message: textOf(entry.note),
      ...(seconds !== null ? { target: { at_seconds: seconds } } : {}),
    });
  }
  return issues;
}

/** 目标芯片的文本：`itemId` 优先，其次 `trackId`，最后时间码。 */
function targetText(issue: TimelineLintIssue): string {
  const target = issue.target;
  if (!target) return '';
  if (target.itemId) return target.itemId;
  if (target.trackId) return target.trackId;
  return typeof target.at_seconds === 'number'
    ? `${target.at_seconds.toFixed(1)}s` : '';
}

/**
 * 修复引用的文本：`<code>@<target>`。
 *
 * 没有目标时只给 code——模型仍能按 code 定位，而不会收到一个空的 `@`。
 */
function fixReference(issue: TimelineLintIssue): string {
  const target = targetText(issue);
  return target ? `${issue.code}@${target}` : issue.code;
}

// ── 自检卡片 ──────────────────────────────────────────────────────────────

function LintIssueRow({ issue }: { issue: TimelineLintIssue }) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const target = targetText(issue);
  return (
    <li className="rounded border border-border/60 bg-background/40 p-2">
      <p className="flex flex-wrap items-center gap-2">
        <SeverityDot severity={issue.severity} />
        <span className="font-medium break-words">
          {copy.lint[issue.code] || issue.code}
        </span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {issue.code}
        </code>
      </p>
      {issue.message && (
        <p className="mt-1 break-words text-muted-foreground">
          {issue.message}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {target && (
          <span className="rounded border border-border px-1.5 py-0.5
            font-mono text-[11px] text-muted-foreground">
            {target}
          </span>
        )}
        {issue.suggested_tool && (
          <button type="button"
            onClick={() => sendPrefilledMessage(
              copy.lintFixMessage.replace('{ref}', fixReference(issue)),
            )}
            className="text-[11px] underline underline-offset-2
              focus-visible:outline focus-visible:outline-2
              focus-visible:outline-primary">
            {copy.lintFix.replace('{tool}', issue.suggested_tool)}
          </button>
        )}
      </div>
    </li>
  );
}

/** 15 条规则的 ✓/✗ 列表：让"哪些查了、哪些没查"可见（§7.1）。 */
function CheckedRules({ rules, failed }: {
  rules: string[];
  failed: ReadonlySet<string>;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  if (rules.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-muted-foreground">
        {copy.sectionRules}
      </summary>
      <ul className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
        {rules.map((code) => (
          <li key={code} className="flex min-w-0 items-center gap-1">
            <span aria-hidden="true"
              className={failed.has(code)
                ? 'font-mono text-amber-500 dark:text-amber-400'
                : 'font-mono text-green-600 dark:text-green-400'}>
              {failed.has(code) ? '✗' : '✓'}
            </span>
            <span className="min-w-0 break-words">
              {copy.lint[code] || code}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function QualityReportCard({
  toolCall, onOpenSettings,
}: QualityCardProps): React.JSX.Element {
  const { t } = useLocale();
  const copy = t.agentVision;
  const payload = agentVisionEnvelope(toolCall.result);
  if (payload.success === false) {
    return <VisionFailureNote title={copy.lintTitle} payload={payload}
      onOpenSettings={onOpenSettings} />;
  }

  const blockers = numberOf(payload.blockers) ?? 0;
  const warnings = numberOf(payload.warnings) ?? 0;
  const truncated = numberOf(payload.truncated) ?? 0;
  const issues = readIssues(payload.issues);
  const rules = Array.isArray(payload.checked_rules)
    ? payload.checked_rules.map(textOf).filter(Boolean) : [];
  const failed = new Set(issues.map((issue) => issue.code));
  const allPassed = issues.length === 0 && blockers === 0;
  // 规则表固定 15 条（§4.10）；`checked_rules` 被裁掉时仍按 15 计数。
  const ruleCount = rules.length || LINT_RULE_COUNT;
  const summary = copy.lintSummary
    .replace('{blockers}', String(blockers))
    .replace('{warnings}', String(warnings));

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md
      border border-border bg-muted/40 p-3 text-xs text-foreground">
      {/* 折叠箭头是 §7.1 的要求：默认展开，键盘可达（summary 自带语义）。 */}
      <details open>
        <summary className="flex cursor-pointer list-none flex-wrap
          items-center gap-2 font-medium">
          <span aria-hidden="true" className="font-mono">▣</span>
          <span className="break-words">{copy.lintTitle}</span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className={blockers > 0
            ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'}>
            {summary}
          </span>
          <span aria-hidden="true" className="ml-auto text-muted-foreground">
            ⌄
          </span>
        </summary>
        {allPassed && (
          <p className="mt-1 flex items-center gap-1 text-green-600
            dark:text-green-400">
            <span aria-hidden="true">✓</span>
            {copy.lintAllPassed.replace('{count}', String(ruleCount))}
          </p>
        )}
        {issues.length > 0 && (
          <ul className="mt-2 space-y-2">
            {issues.map((issue, index) => (
              <LintIssueRow key={`${index}-${issue.code}`} issue={issue} />
            ))}
          </ul>
        )}
        {truncated > 0 && (
          <p className="mt-2 text-muted-foreground">
            {copy.lintTruncated.replace('{count}', String(truncated))}
          </p>
        )}
        <CheckedRules rules={rules} failed={failed} />
      </details>
    </section>
  );
}

// ── 成品探测卡片 ──────────────────────────────────────────────────────────

type SkippedKey = 'exportLoudness' | 'exportBlackFrames'
  | 'exportSilenceSegments' | 'exportAudio' | 'visualSpotCheck';

/** `skipped[]` 的码 → 已登记的技术标签；未登记的原样显示（不猜含义）。 */
const SKIPPED_LABELS: Record<string, SkippedKey> = {
  loudness: 'exportLoudness',
  ebur128: 'exportLoudness',
  black_frames: 'exportBlackFrames',
  blackdetect: 'exportBlackFrames',
  silence: 'exportSilenceSegments',
  silence_segments: 'exportSilenceSegments',
  audio: 'exportAudio',
  visual: 'visualSpotCheck',
  visual_spot_check: 'visualSpotCheck',
};

function skippedLabel(
  code: string, copy: { [K in SkippedKey]: string },
): string {
  const key = SKIPPED_LABELS[code];
  return key ? copy[key] : code;
}

function secondsOf(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}s`;
}

function TechnicalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-1">
      <dt className="shrink-0 text-muted-foreground">{`${label}:`}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

/** 技术指标块：时长、分辨率、音轨、黑帧、静音段、响度 / 真峰。 */
function TechnicalBlock({ payload }: {
  payload: Record<string, unknown>;
}) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const probe = recordOf(payload.probe);
  const duration = numberOf(payload.duration_seconds)
    ?? numberOf(probe.duration_seconds);
  const width = numberOf(probe.width);
  const height = numberOf(probe.height);
  const hasAudio = typeof probe.has_audio === 'boolean'
    ? probe.has_audio : null;
  const blackFrames = numberOf(probe.black_frames);
  const silence = numberOf(probe.silence_segments);
  const loudness = recordOf(payload.loudness ?? probe.loudness);
  const integrated = numberOf(loudness.integrated_lufs);
  const truePeak = numberOf(loudness.true_peak_dbtp);
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      <TechnicalRow label={copy.exportDuration} value={secondsOf(duration)} />
      <TechnicalRow label={copy.exportResolution}
        value={width !== null && height !== null
          ? `${width}×${height}` : '—'} />
      <TechnicalRow label={copy.exportAudio}
        value={hasAudio === null ? '—'
          : hasAudio ? copy.exportAudioYes : copy.exportAudioNo} />
      <TechnicalRow label={copy.exportBlackFrames}
        value={blackFrames === null ? '—' : String(blackFrames)} />
      <TechnicalRow label={copy.exportSilenceSegments}
        value={silence === null ? '—' : String(silence)} />
      <TechnicalRow label={copy.exportLoudness}
        value={integrated === null ? '—' : `${integrated.toFixed(1)} LUFS`} />
      <TechnicalRow label={copy.exportTruePeak}
        value={truePeak === null ? '—' : `${truePeak.toFixed(1)} dBTP`} />
    </dl>
  );
}

/** 视觉抽检的结论行（`visual` 缺席表示没测，会同时出现在 `skipped[]`）。 */
function VisualLine({ value }: { value: unknown }) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const visual = recordOf(value);
  const summary = textOf(visual.summary);
  if (!summary) return null;
  const verdict = visual.verdict;
  return (
    <p className="mt-2 break-words text-muted-foreground">
      {`${copy.visualSpotCheck}: `}
      {verdict === 'pass' ? copy.visionVerdictPass
        : verdict === 'fail' ? copy.visionVerdictFail
          : copy.visionVerdictConcern}
      {` · ${summary}`}
    </p>
  );
}

export function ExportInspectCard({
  toolCall, onOpenSettings,
}: QualityCardProps): React.JSX.Element {
  const { t } = useLocale();
  const copy = t.agentVision;
  const payload = agentVisionEnvelope(toolCall.result);
  if (payload.success === false) {
    return <VisionFailureNote title={copy.exportTitle} payload={payload}
      onOpenSettings={onOpenSettings} />;
  }

  const issues = readExportIssues(payload.issues);
  const skipped = Array.isArray(payload.skipped)
    ? payload.skipped.map(textOf).filter(Boolean) : [];
  const compositionId = textOf(payload.composition_id);

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md
      border border-border bg-muted/40 p-3 text-xs text-foreground">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span aria-hidden="true" className="font-mono">▶</span>
        <span className="break-words">{copy.exportTitle}</span>
        {compositionId && (
          <code className="rounded bg-muted px-1 py-0.5 font-mono
            text-[11px] text-muted-foreground">
            {compositionId}
          </code>
        )}
      </p>
      <TechnicalBlock payload={payload} />
      {issues.length > 0 && (
        <ul className="mt-2 space-y-2">
          {issues.map((issue, index) => (
            <LintIssueRow key={`${index}-${issue.code}`} issue={issue} />
          ))}
        </ul>
      )}
      <VisualLine value={payload.visual} />
      {skipped.length > 0 && (
        <ul className="mt-2 space-y-1 rounded border border-border
          bg-muted/60 p-2 text-muted-foreground">
          {skipped.map((code) => (
            <li key={code} className="break-words">
              {copy.exportSkipped.replace('{item}', skippedLabel(code, copy))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default QualityReportCard;
