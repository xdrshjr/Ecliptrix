'use client';

import React from 'react';
import { AlertTriangle, Check, Circle, Loader2, RefreshCw } from './icons';
import type { IconComponent } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import type { SegmentStatus } from '../../lib/segments/segmentLinks';

type ChipTone = 'ok' | 'warn' | 'primary' | 'muted';

interface ChipSpec {
  key: string;
  tone: ChipTone;
  icon: IconComponent;
  label: string;
  hint?: string;
  spinning?: boolean;
}

type CardCopy = ReturnType<typeof useLocale>['t']['workbench']['segmentCard'];

/** Voice chip per spec §3.5.2 table; `voiceOnTimeline` only matters when ready (RV-02). */
function voiceChip(status: SegmentStatus, copy: CardCopy): ChipSpec {
  if (status.voice === 'generating') {
    return { key: 'voice', tone: 'primary', icon: Loader2, label: copy.voiceGenerating, spinning: true };
  }
  if (status.voice === 'stale') {
    return { key: 'voice', tone: 'warn', icon: RefreshCw, label: copy.voiceStale };
  }
  if (status.voice === 'none') {
    return { key: 'voice', tone: 'muted', icon: Circle, label: copy.voiceNone };
  }
  if (status.voiceOnTimeline === 'outdated') {
    return {
      key: 'voice',
      tone: 'warn',
      icon: AlertTriangle,
      label: copy.voiceOutdated,
      hint: copy.voiceOutdatedHint,
    };
  }
  return { key: 'voice', tone: 'ok', icon: Check, label: copy.voiceReady };
}

export function buildStatusChips(status: SegmentStatus, copy: CardCopy): ChipSpec[] {
  const visualReady = status.visual === 'configured';
  const subtitleReady = status.subtitle === 'ready';
  return [
    {
      key: 'visual',
      tone: visualReady ? 'ok' : 'muted',
      icon: visualReady ? Check : Circle,
      label: visualReady ? copy.visualConfigured : copy.visualMissing,
    },
    voiceChip(status, copy),
    {
      key: 'subtitle',
      tone: subtitleReady ? 'ok' : 'muted',
      icon: subtitleReady ? Check : Circle,
      label: subtitleReady ? copy.subtitleReady : copy.subtitleNone,
    },
  ];
}

const TONE_CLASS: Record<ChipTone, string> = {
  ok: 'ws-chip ws-chip--ok',
  warn: 'ws-chip ws-chip--warn',
  primary: 'ws-chip ws-chip--primary',
  muted: 'ws-chip',
};

/** 画面 / 配音 / 字幕三枚状态芯片：图标 + 文字，状态从不只靠颜色表达。 */
const SegmentStatusChips: React.FC<{ status: SegmentStatus }> = ({ status }) => {
  const { t } = useLocale();
  const chips = buildStatusChips(status, t.workbench.segmentCard);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => {
        const Icon = chip.icon;
        return (
          <span
            key={chip.key}
            className={TONE_CLASS[chip.tone]}
            data-chip={chip.key}
            data-tone={chip.tone}
            title={chip.hint}
          >
            <Icon
              size={12}
              strokeWidth={1.75}
              aria-hidden="true"
              className={chip.spinning ? 'animate-spin' : undefined}
            />
            <span>{chip.label}</span>
          </span>
        );
      })}
    </div>
  );
};

export default SegmentStatusChips;
