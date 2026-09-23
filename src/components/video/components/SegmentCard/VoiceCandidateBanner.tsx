'use client';

import React from 'react';
import { Play, RefreshCw, Square } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import type { VoiceCandidate } from '../../lib/segments/segmentLinks';
import { formatSignedSeconds } from '../../lib/segments/formatSegmentImpact';

export interface VoiceCandidateBannerProps {
  candidate: VoiceCandidate;
  /** Length of this segment's narration on the timeline; null when absent. */
  timelineSeconds: number | null;
  isAuditioning: boolean;
  isVoiceBusy: boolean;
  onAudition(): void;
  onApply(): void;
  onDismiss(): void;
  onRegenerate(): void;
}

/**
 * 候选配音提示条（spec R2 §3.4.2）：生成的配音先作为候选，试听后再应用到时间轴。
 * 过期候选（基于上一版文案）只能试听或重新生成，没有「应用」按钮。
 */
const VoiceCandidateBanner: React.FC<VoiceCandidateBannerProps> = (props) => {
  const { candidate, timelineSeconds, isAuditioning, isVoiceBusy } = props;
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  const to = candidate.duration.toFixed(1);
  const auditionIcon = isAuditioning
    ? <Square size={14} strokeWidth={1.75} aria-hidden="true" />
    : <Play size={14} strokeWidth={1.75} aria-hidden="true" />;
  if (candidate.isStale) {
    return (
      <div className="segment-banner" data-tone="warn" role="status" data-testid="voice-candidate-banner">
        <span className="segment-banner__text">{copy.candidateStale}</span>
        <button type="button" className="ws-btn ws-btn--sm ws-btn--ghost" onClick={props.onAudition}
          aria-pressed={isAuditioning}>
          {auditionIcon}{isAuditioning ? copy.stopAudition : copy.auditionAnyway}
        </button>
        <button type="button" className="ws-btn ws-btn--sm ws-btn--outline-primary" onClick={props.onRegenerate}
          disabled={isVoiceBusy}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />{copy.regenerate}
        </button>
      </div>
    );
  }
  const text = timelineSeconds === null
    ? copy.candidateNew.replace('{to}', to)
    : copy.candidateDelta
      .replace('{from}', timelineSeconds.toFixed(1))
      .replace('{to}', to)
      .replace('{delta}', formatSignedSeconds(candidate.duration - timelineSeconds));
  return (
    <div className="segment-banner" role="status" data-testid="voice-candidate-banner">
      <span className="segment-banner__text ws-tabular">{text}</span>
      <button type="button" className="ws-btn ws-btn--sm ws-btn--ghost" onClick={props.onAudition}
        aria-pressed={isAuditioning}>
        {auditionIcon}{isAuditioning ? copy.stopAudition : copy.audition}
      </button>
      <button type="button" className="ws-btn ws-btn--sm ws-btn--primary" onClick={props.onApply}>
        {timelineSeconds === null ? copy.placeOnTimeline : copy.applyToTimeline}
      </button>
      <button type="button" className="ws-btn ws-btn--sm ws-btn--text" onClick={props.onDismiss}>
        {copy.notNow}
      </button>
    </div>
  );
};

export default VoiceCandidateBanner;
