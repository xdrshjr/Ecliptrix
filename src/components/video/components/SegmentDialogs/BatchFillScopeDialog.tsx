'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SegmentDialogShell, { ImpactLines } from './SegmentDialogShell';
import type { BatchFillScope } from '../../lib/segments/segmentCommands';

export interface BatchFillScopeDialogProps {
  scope: BatchFillScope;
  /** Segment id → 1-based ordinal. */
  ordinalOf(segmentId: string): number;
  onStart(): void;
  onClose(): void;
}

const listOrdinals = (
  ids: readonly string[], ordinalOf: (id: string) => number, separator: string,
): string => ids.map(ordinalOf).join(separator);

/** Scope lines of a batch fill (exported for tests). */
export function buildBatchFillLines(
  scope: BatchFillScope,
  ordinalOf: (id: string) => number,
  copy: {
    batchFillVoices: string; batchFillSkip: string; batchFillNote: string;
    batchFillMissingVisual: string; batchFillNothing: string; listSeparator: string;
  },
): string[] {
  const lines: string[] = [];
  if (scope.voiceTargetIds.length === 0) lines.push(copy.batchFillNothing);
  else {
    lines.push(copy.batchFillVoices
      .replace('{count}', String(scope.voiceTargetIds.length))
      .replace('{list}', listOrdinals(scope.voiceTargetIds, ordinalOf, copy.listSeparator)));
  }
  if (scope.upToDateIds.length > 0) {
    lines.push(copy.batchFillSkip
      .replace('{list}', listOrdinals(scope.upToDateIds, ordinalOf, copy.listSeparator)));
  }
  if (scope.voiceTargetIds.length > 0) lines.push(copy.batchFillNote);
  if (scope.missingVisualIds.length > 0) {
    lines.push(copy.batchFillMissingVisual
      .replace('{list}', listOrdinals(scope.missingVisualIds, ordinalOf, copy.listSeparator)));
  }
  return lines;
}

/**
 * 批量补齐缺失内容的作用范围（spec R2 §3.12）：先列出将生成、将跳过、需手动处理
 * 的段落，再由用户开始。本轮只补配音，画面缺失只提示不自动匹配。
 */
const BatchFillScopeDialog: React.FC<BatchFillScopeDialogProps> = ({ scope, ordinalOf, onStart, onClose }) => {
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  const canStart = scope.voiceTargetIds.length > 0;
  return (
    <SegmentDialogShell
      title={copy.batchFillTitle}
      onClose={onClose}
      testId="batch-fill-dialog"
      footer={(
        <>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose}>{copy.cancel}</button>
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            onClick={onStart}
            disabled={!canStart}
            data-autofocus={canStart || undefined}
          >
            {copy.batchFillStart}
          </button>
        </>
      )}
    >
      <ImpactLines lines={buildBatchFillLines(scope, ordinalOf, copy)} />
    </SegmentDialogShell>
  );
};

export default BatchFillScopeDialog;
