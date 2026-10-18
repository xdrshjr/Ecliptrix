'use client';

/**
 * VisionObservationCard — `view_image` / `review_frames` 的观察结果卡片。
 *
 * 设计基线：docs/plans/agent-visual-review/spec.md §7.1（第二次卡片）与
 * §7.4（可访问性纪律）。
 *
 * 四条纪律：
 *   1. 缩略图只来自 `details.ui.thumbs`（`data:` URL），且只接受内联图片：
 *      卡片绝不因为渲染而发起新的网络请求。`MediaPreviewModal` 只接受
 *      `MaterialItem`（预览的是素材库对象，不是任意 URL），因此这里用普通
 *      `<img>`，`alt` 用 `ui.source_labels[i]`（§7.4）；
 *   2. `alt` 用 `ui.source_labels[i]`，不用"图片"（§7.4）；
 *   3. 右下角常驻出口披露（画面已发送至视觉模型），有 `onOpenSettings`
 *      时它是按钮，否则是纯文本提示——出口说明不可省略（§4.13.1）；
 *   4. 失败态 `role="alert"` + 错误码 + 设置路径，且不渲染空缩略图。
 *
 * 本文件同时导出三个共享小件（`SeverityDot` / `severityLabel` /
 * `VisionFailureNote`）。`QualityReportCard` 单向 import 它们，不构成循环：
 * 视觉结果是这类"严重度 + 失败信封"的规范落点。
 */

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { AgentToolCallRecord } from '@/types';
import {
  agentVisionEnvelope, visionErrorKey,
  type VisionObservation, type VisionSeverity, type VisionVerdict,
} from '@/types/agentVision';

/** 缩略图上限（§7.1：≤4 张，48×48 圆角）。 */
const MAX_THUMBS = 4;
/** 只接受内联图片 data URL；其余来源一律不渲染。与 `visionAdapter.boundUi` 同口径。 */
const INLINE_PREFIX = 'data:image/';
const INLINE_NOISE = /[\s"'<>]/;
/** 单张缩略图的上限（`boundUi` 就是按 40 KB 截的）。 */
const INLINE_MAX_CHARS = 40_000;

function isInlineImage(value: string): boolean {
  return value.length <= INLINE_MAX_CHARS
    && value.startsWith(INLINE_PREFIX)
    && value.includes(';base64,')
    && !INLINE_NOISE.test(value);
}
/** 摘要超过这个长度时给出展开开关（3 行约 120 字符）。 */
const SUMMARY_CLAMP_AT = 120;

export interface VisionObservationCardProps {
  toolCall: AgentToolCallRecord;
  /**
   * 提供时出口小标变成"打开视觉设置"按钮。宿主（`AgentExecutionNode`）
   * 目前不传——此时卡片退化为纯文本提示，不出现死按钮。
   */
  onOpenSettings?: () => void;
}

/** 读取工具结果里的对象字段（卡片全部输入都是 `unknown`）。 */
export function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** 读取字符串字段；非字符串一律当空串。 */
export function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 读取有限数字字段。 */
export function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ── 严重度（三张卡片共用） ────────────────────────────────────────────────

const SEVERITY_DOT: Record<VisionSeverity, string> = {
  blocker: 'text-red-500 dark:text-red-400',
  warning: 'text-amber-500 dark:text-amber-400',
  note: 'text-muted-foreground',
};

/** 未登记的严重度按 `note` 处理（后端闭集之外的输入不升级成阻塞）。 */
export function severityOf(value: unknown): VisionSeverity {
  return value === 'blocker' || value === 'warning' ? value : 'note';
}

/** 严重度的可读名（给屏幕阅读器；圆点本身是装饰）。 */
export function severityLabel(
  copy: {
    severityBlocker: string; severityWarning: string; severityNote: string;
  },
  severity: VisionSeverity,
): string {
  if (severity === 'blocker') return copy.severityBlocker;
  return severity === 'warning' ? copy.severityWarning : copy.severityNote;
}

export function SeverityDot({ severity }: { severity: VisionSeverity }) {
  const { t } = useLocale();
  return (
    <>
      <span aria-hidden="true"
        className={`font-mono ${SEVERITY_DOT[severity]}`}>●</span>
      <span className="sr-only">
        {severityLabel(t.agentVision, severity)}
      </span>
    </>
  );
}

// ── 失败态（三张卡片共用） ────────────────────────────────────────────────

export interface VisionFailureNoteProps {
  /** 卡片标题（自检 / 画面审阅 / 成品自检）。 */
  title: string;
  /** 已归一化的失败信封（`agentVisionEnvelope` 的结果）。 */
  payload: Record<string, unknown>;
  onOpenSettings?: () => void;
}

/**
 * 失败态：`role="alert"` + 错误码 + 设置出口（AC-23）。
 *
 * 文案只走 `agentVision.errors.*` 白名单；后端/供应商原文永远不直接渲染。
 */
export function VisionFailureNote({
  title, payload, onOpenSettings,
}: VisionFailureNoteProps) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const code = textOf(payload.error_code) || 'internal';
  const message = copy.errors[visionErrorKey(code)] || copy.errors.internal;
  return (
    <section role="alert" className="min-w-0 max-w-full overflow-hidden
      rounded-md border border-destructive/40 bg-destructive/5 p-3
      text-xs text-foreground">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        <span aria-hidden="true" className="font-mono text-destructive">!</span>
        <span className="break-words">{title}</span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {code}
        </code>
      </p>
      <p className="mt-1 break-words text-destructive">{message}</p>
      {onOpenSettings ? (
        <button type="button" onClick={onOpenSettings}
          className="mt-1 underline underline-offset-2
            focus-visible:outline focus-visible:outline-2
            focus-visible:outline-primary">
          {copy.visionOpenSettings}
        </button>
      ) : (
        <p className="mt-1 text-muted-foreground">
          {`${t.adminSettings.title} › ${copy.title}`}
        </p>
      )}
    </section>
  );
}

// ── 卡片主体 ──────────────────────────────────────────────────────────────

const VERDICT_BADGE: Record<VisionVerdict, string> = {
  pass: 'border-green-600/40 bg-green-600/10 text-green-700 '
    + 'dark:text-green-400',
  concern: 'border-amber-500/40 bg-amber-500/10 text-amber-700 '
    + 'dark:text-amber-400',
  fail: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
};

function verdictOf(value: unknown): VisionVerdict {
  if (value === 'pass' || value === 'fail') return value;
  return 'concern';
}

function verdictLabel(
  copy: {
    visionVerdictPass: string; visionVerdictConcern: string;
    visionVerdictFail: string;
  },
  verdict: VisionVerdict,
): string {
  if (verdict === 'pass') return copy.visionVerdictPass;
  return verdict === 'fail' ? copy.visionVerdictFail : copy.visionVerdictConcern;
}

interface Thumb { src: string; label: string }

/** 只取内联图片，并按 `source_labels` 的同一下标配 alt。 */
function readThumbs(ui: Record<string, unknown>): Thumb[] {
  const raw = Array.isArray(ui.thumbs) ? ui.thumbs : [];
  const labels = Array.isArray(ui.source_labels) ? ui.source_labels : [];
  const thumbs: Thumb[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    if (thumbs.length >= MAX_THUMBS) break;
    const src = textOf(raw[index]);
    if (!isInlineImage(src)) continue;
    thumbs.push({ src, label: textOf(labels[index]) });
  }
  return thumbs;
}

function readIssues(
  value: unknown,
): Array<{ code: string; severity: VisionSeverity; note: string }> {
  if (!Array.isArray(value)) return [];
  const issues: Array<{ code: string; severity: VisionSeverity; note: string }> = [];
  for (const item of value) {
    const entry = recordOf(item);
    const note = textOf(entry.note);
    if (!note) continue;
    issues.push({
      code: textOf(entry.code) || 'issue',
      severity: severityOf(entry.severity),
      note,
    });
  }
  return issues;
}

function ThumbStrip({ thumbs, label }: { thumbs: Thumb[]; label: string }) {
  return (
    <ul className="flex shrink-0 gap-1" aria-label={label}>
      {thumbs.map((thumb, index) => (
        <li key={`${index}-${thumb.src.length}`}>
          {/* 缩略图是 data URL，next/image 的优化管道对它无意义且会二次编码。 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb.src} alt={thumb.label || `${label} ${index + 1}`}
            width={48} height={48}
            className="h-12 w-12 rounded border border-border object-cover" />
        </li>
      ))}
    </ul>
  );
}

/** 摘要 + 三行裁切 + 展开开关（键盘可达，Tab 顺序：缩略图 → 展开 → 修复）。 */
function SummaryBlock({ summary }: { summary: string }) {
  const { t } = useLocale();
  const copy = t.agentVision;
  const [expanded, setExpanded] = useState(false);
  if (!summary) return null;
  const clamped = !expanded && (summary.length > SUMMARY_CLAMP_AT
    || summary.includes('\n'));
  return (
    <div className="mt-1 min-w-0">
      <p className={`break-words ${clamped ? 'line-clamp-3' : ''}`}>
        {summary}
      </p>
      {clamped && (
        <button type="button" onClick={() => setExpanded(true)}
          className="mt-1 text-[11px] underline underline-offset-2
            focus-visible:outline focus-visible:outline-2
            focus-visible:outline-primary">
          {copy.visionExpand}
        </button>
      )}
    </div>
  );
}

export default function VisionObservationCard({
  toolCall, onOpenSettings,
}: VisionObservationCardProps): React.JSX.Element {
  const { t } = useLocale();
  const copy = t.agentVision;
  const payload: Partial<VisionObservation> & Record<string, unknown> =
    agentVisionEnvelope(toolCall.result);
  if (payload.success === false) {
    return <VisionFailureNote title={copy.visionTitle}
      payload={payload} onOpenSettings={onOpenSettings} />;
  }

  const ui = recordOf(payload.ui);
  const model = recordOf(ui.model);
  const thumbs = readThumbs(ui);
  const issues = readIssues(payload.issues);
  const textLines = Array.isArray(payload.text_lines)
    ? payload.text_lines.map(textOf).filter(Boolean) : [];
  const verdict = verdictOf(payload.verdict);
  const elapsedMs = numberOf(ui.elapsed_ms);
  const modelName = textOf(model.model) || textOf(model.provider);
  const provider = textOf(model.provider);
  const source = textOf(model.source);

  const meta = [
    modelName,
    elapsedMs === null ? '' : `${(elapsedMs / 1000).toFixed(1)}s`,
    payload.cached === true ? copy.visionCached : '',
  ].filter(Boolean).join(' · ');

  return (
    <section className="min-w-0 max-w-full overflow-hidden rounded-md
      border border-border bg-muted/40 p-3 text-xs text-foreground">
      <p className="flex items-center gap-2 font-medium">
        <span aria-hidden="true" className="font-mono">◫</span>
        <span className="break-words">{copy.visionTitle}</span>
      </p>
      <div className="mt-2 flex min-w-0 items-start gap-3">
        {thumbs.length > 0
          ? <ThumbStrip thumbs={thumbs} label={copy.visionTitle} />
          : (
            <span aria-hidden="true"
              className="flex h-12 w-12 shrink-0 items-center justify-center
                rounded border border-dashed border-border font-mono
                text-muted-foreground">
              ▤
            </span>
          )}
        <div className="min-w-0 flex-1">
          <span className={`inline-block rounded border px-1.5 py-0.5
            font-medium ${VERDICT_BADGE[verdict]}`}>
            {verdictLabel(copy, verdict)}
          </span>
          <SummaryBlock summary={textOf(payload.summary)} />
          {issues.length > 0 && (
            <ul className="mt-2 space-y-1">
              {issues.map((issue, index) => (
                <li key={`${index}-${issue.code}`}
                  className="flex min-w-0 items-start gap-2">
                  <SeverityDot severity={issue.severity} />
                  <span className="min-w-0 break-words">{issue.note}</span>
                </li>
              ))}
            </ul>
          )}
          {textLines.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-muted-foreground">
                {copy.visionTextLines.replace(
                  '{count}', String(textLines.length))}
              </summary>
              <ul className="mt-1 list-inside list-disc space-y-0.5
                break-words text-muted-foreground">
                {textLines.map((line, index) => (
                  <li key={`${index}-${line.slice(0, 12)}`}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap items-center justify-between gap-2
        text-[11px] text-muted-foreground">
        <span className="break-all" title={[provider, source].filter(Boolean).join(' · ')}>
          {meta}
        </span>
        {onOpenSettings ? (
          <button type="button" onClick={onOpenSettings}
            className="rounded border border-border px-1.5 py-0.5
              hover:bg-accent focus-visible:outline focus-visible:outline-2
              focus-visible:outline-primary">
            {copy.visionEgress}
          </button>
        ) : (
          <span role="note" className="rounded border border-border px-1.5 py-0.5">
            {copy.visionEgress}
          </span>
        )}
      </p>
    </section>
  );
}
