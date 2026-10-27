'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { QueuedFollowUp, SteerNote } from '@/types/agentSteering';

/**
 * 输入区上方的「待送达」芯片：运行中提交的补充（steer）与回合结束后发送的
 * 排队文本（queue）。状态用文字说清楚，而不是只靠颜色：
 *
 * - `local` / `sent`：琥珀色脉冲点 + 「将在『{工具}』完成后送达」
 * - `queued`：灰点 + 「回合结束后发送」
 *
 * ✕ 只对 `local` 与 `queued` 可用：`sent` 已进入模型侧队列，没有取消接口，
 * 不做「假撤回」（spec §3.2.4）。
 */

export interface SteerQueueProps {
  notes: readonly SteerNote[];
  queued: readonly QueuedFollowUp[];
  /** 当前正在执行的工具名（用于「将在『X』完成后送达」）。 */
  currentToolName?: string | null;
  /** A research crew is running: the note waits for it, not for one tool. */
  crewRunning?: boolean;
  onCancel: (id: string) => void;
  /** 「改为停止并重发」：停止当前回合后把该文本作为新一轮发出。 */
  onStopAndResend: (id: string) => void;
}

interface ChipProps {
  id: string;
  text: string;
  waiting: boolean;
  statusText: string;
  canCancel: boolean;
  canStop: boolean;
  onCancel: (id: string) => void;
  onStopAndResend: (id: string) => void;
}

const Chip: React.FC<ChipProps> = ({
  id, text, waiting, statusText, canCancel, canStop, onCancel, onStopAndResend,
}) => {
  const { t } = useLocale();
  const copy = t.agentCollab;
  return (
    <li
      className="flex items-start gap-2 rounded-md border border-border bg-muted/60 px-2 py-1.5 text-xs"
      data-testid="steer-chip"
      data-waiting={waiting ? 'true' : 'false'}
    >
      <span
        aria-hidden="true"
        className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${
          waiting
            ? 'bg-amber-500 motion-safe:animate-pulse'
            : 'bg-zinc-400 dark:bg-zinc-500'
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-foreground">{text}</span>
        <span className="block text-muted-foreground">{statusText}</span>
      </span>
      {canStop ? (
        <button
          type="button"
          onClick={() => onStopAndResend(id)}
          className="shrink-0 rounded px-1 text-amber-700 hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 dark:text-amber-300"
        >
          {copy.steerStopAndResend}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onCancel(id)}
        disabled={!canCancel}
        aria-label={canCancel ? copy.steerChipCancel : copy.steerChipSentTooltip}
        title={canCancel ? copy.steerChipCancel : copy.steerChipSentTooltip}
        className="shrink-0 rounded px-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span aria-hidden="true">✕</span>
      </button>
    </li>
  );
};

const SteerQueue: React.FC<SteerQueueProps> = ({
  notes, queued, currentToolName, crewRunning = false, onCancel, onStopAndResend,
}) => {
  const { t } = useLocale();
  const copy = t.agentCollab;
  const pending = notes.filter(note => note.status === 'local' || note.status === 'sent');
  if (pending.length === 0 && queued.length === 0) return null;
  const waitingText = crewRunning ? t.agentCrew.steerHint
    : currentToolName
      ? copy.steerChipWaitingTool.replace('{tool}', currentToolName)
      : copy.steerChipWaitingStep;
  return (
    <ul
      aria-label={copy.steerQueueLabel}
      className="flex-shrink-0 space-y-1 px-3 pb-1 pt-2"
      data-testid="steer-queue"
    >
      {pending.map(note => (
        <Chip
          key={note.id} id={note.id} text={note.text} waiting
          statusText={waitingText}
          canCancel={note.status === 'local'} canStop
          onCancel={onCancel} onStopAndResend={onStopAndResend}
        />
      ))}
      {queued.map(item => (
        <Chip
          key={item.id} id={item.id} text={item.text} waiting={false}
          statusText={copy.steerChipQueued}
          canCancel canStop={false}
          onCancel={onCancel} onStopAndResend={onStopAndResend}
        />
      ))}
    </ul>
  );
};

export default SteerQueue;
