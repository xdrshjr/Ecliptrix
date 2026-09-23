'use client';

import React from 'react';
import { AlertTriangle, RefreshCw } from './icons';
import { useLocale } from '@/contexts/LocaleContext';

export interface SegmentErrorRowProps {
  reason: string;
  isVoiceBusy: boolean;
  onRetry(): void;
}

/**
 * 段落配音失败行（spec R2 §3.4.4）：失败原因留在对应段落上，并提供「只重试本段」。
 * 图标 + 文字表达状态，不只靠颜色。
 */
const SegmentErrorRow: React.FC<SegmentErrorRowProps> = ({ reason, isVoiceBusy, onRetry }) => {
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  return (
    <div className="segment-banner" data-tone="danger" role="alert" data-testid="segment-error-row">
      <AlertTriangle size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
      <span className="segment-banner__text" title={reason}>
        {copy.voiceFailed.replace('{reason}', reason)}
      </span>
      <button type="button" className="ws-btn ws-btn--sm ws-btn--outline-primary" onClick={onRetry}
        disabled={isVoiceBusy}>
        <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />{copy.retrySegment}
      </button>
    </div>
  );
};

export default SegmentErrorRow;
