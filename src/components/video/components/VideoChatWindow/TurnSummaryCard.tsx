'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { sendPrefilledMessage } from '@/lib/video-editing-agent/prefilledMessage';
import { hasSummaryContent, type TurnSummary } from './turnSummary';

/**
 * 回合总结卡：本轮改了什么、有没有遗留问题、下一步做什么。
 *
 * 设计基线：docs/plans/agent-steering-and-skills/spec.md §3.4.3。
 * - 文案全部来自 i18n 固定键，**不由模型生成**，避免提示注入进入「一键」动作；
 * - 「让 Agent 修复 / 生成来源清单」只把固定文案**预填**到输入框（沿用
 *   `sendPrefilledMessage`：建议动作不直接执行），用户确认后才发送；
 * - 「撤销本轮」由紧邻的既有「撤销全部」按钮承担（同一个 `undoAllOperations`），
 *   不在同一区域放两个等价按钮。
 */

export interface TurnSummaryCardProps {
  summary: TurnSummary;
  /** 测试注入；默认预填聊天输入框。 */
  onPrefill?: (text: string) => void;
}

const Chip: React.FC<{ tone?: 'default' | 'warn' | 'bad' | 'ok'; children: React.ReactNode }> = ({
  tone = 'default', children,
}) => {
  const palette = {
    default: 'border-border text-foreground',
    ok: 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300',
    warn: 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300',
    bad: 'border-red-300 text-red-600 dark:border-red-800 dark:text-red-400',
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${palette}`}>
      {children}
    </span>
  );
};

function fill(template: string, values: Record<string, number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)), template);
}

const TurnSummaryCard: React.FC<TurnSummaryCardProps> = ({
  summary, onPrefill = sendPrefilledMessage,
}) => {
  const { t } = useLocale();
  const copy = t.agentCollab;
  if (!hasSummaryContent(summary)) return null;

  const { clips, materials, check } = summary;
  const adjusted = Math.max(clips.moved, clips.trimmed, clips.resized);
  const generated = materials.generated.tts + materials.generated.image
    + materials.generated.video;
  const issues = check ? check.blockers + check.warnings : 0;

  return (
    <div
      role="group"
      aria-label={copy.summaryLabel}
      data-testid="turn-summary-card"
      className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {summary.partial && (
          <Chip tone="warn">{fill(copy.summaryStopped, { n: summary.completedSteps })}</Chip>
        )}
        {clips.added > 0 && <Chip>{fill(copy.summaryClipsAdded, { n: clips.added })}</Chip>}
        {clips.removed > 0 && <Chip>{fill(copy.summaryClipsRemoved, { n: clips.removed })}</Chip>}
        {adjusted > 0 && <Chip>{fill(copy.summaryClipsChanged, { n: adjusted })}</Chip>}
        {materials.imported > 0 && (
          <Chip>{fill(copy.summaryImported, { n: materials.imported })}</Chip>
        )}
        {generated > 0 && <Chip>{fill(copy.summaryGenerated, { n: generated })}</Chip>}
        {materials.webDownloaded > 0 && (
          <Chip>{fill(copy.summaryWeb, { n: materials.webDownloaded })}</Chip>
        )}
        {summary.web?.crewTasks ? (
          <Chip>{fill(t.agentCrew.turnSummary, {
            tasks: summary.web.crewTasks, candidates: summary.web.candidates })}</Chip>
        ) : null}
        {summary.web?.requested ? (
          <Chip>{fill(t.agentAcquire.turnSummary, {
            ready: summary.web.acquired, requested: summary.web.requested })}</Chip>
        ) : null}
        {check && (issues === 0
          ? <Chip tone="ok">{copy.summaryCheckOk}</Chip>
          : (
            <Chip tone={check.blockers > 0 ? 'bad' : 'warn'}>
              {fill(copy.summaryCheckIssues, { blockers: check.blockers, warnings: check.warnings })}
            </Chip>
          ))}
        {summary.failedTools > 0 && (
          <Chip tone="bad">{fill(copy.summaryFailed, { n: summary.failedTools })}</Chip>
        )}
      </div>
      {(issues > 0 || materials.webDownloaded > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {issues > 0 && (
            <button
              type="button"
              onClick={() => onPrefill(copy.summaryFixPrompt)}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.summaryFix}
            </button>
          )}
          {materials.webDownloaded > 0 && (
            <button
              type="button"
              onClick={() => onPrefill(copy.summaryCreditsPrompt)}
              className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {copy.summaryCredits}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default TurnSummaryCard;
