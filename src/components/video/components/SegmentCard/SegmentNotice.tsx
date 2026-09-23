'use client';

import React from 'react';
import type { MaterialItem, ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import type { SegmentStatus, SegmentTimeRange } from '../../lib/segments/segmentLinks';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import type { SegmentCommands } from '../../hooks/useSegmentCommands';
import type { SegmentAudition } from '../../hooks/useSegmentAudition';
import VoiceCandidateBanner from './VoiceCandidateBanner';
import SegmentErrorRow from './SegmentErrorRow';

export interface SegmentNoticeProps {
  segment: ScriptSegment;
  status: SegmentStatus | null;
  timelineSpan: SegmentTimeRange | null;
  /** The candidate's material (the newest voice-over), for audition. */
  candidateMaterial: MaterialItem | null;
  audition: SegmentAudition;
  commands: SegmentCommands | null;
  isVoiceBusy: boolean;
  onRegenerate(): void;
}

/**
 * The one row under a card's chips (spec R2 §3.4.2 / §3.4.4 / §3.6 A). A
 * failure wins over a candidate, a candidate over the picked-visual prompt,
 * so the card never stacks several banners.
 */
export const SegmentNotice: React.FC<SegmentNoticeProps> = (props) => {
  const { segment, status, audition, commands, isVoiceBusy, onRegenerate } = props;
  const { t } = useLocale();
  const error = useEditorFocusStore((state) => state.segmentVoiceErrors.get(segment.id) ?? null);
  const dismissed = useEditorFocusStore((state) => state.dismissedCandidateIds);
  const dismissCandidate = useEditorFocusStore((state) => state.dismissCandidate);
  const pickedVisualId = useEditorFocusStore((state) => state.pickedVisualSegmentId);
  const setPickedVisual = useEditorFocusStore((state) => state.setPickedVisualSegmentId);
  if (error) return <SegmentErrorRow reason={error} isVoiceBusy={isVoiceBusy} onRetry={onRegenerate} />;
  const candidate = status?.candidate ?? null;
  if (candidate && commands && !dismissed.has(candidate.materialId)) {
    const isAuditioning = audition.auditioningSegmentId === segment.id;
    const timelineSeconds = candidate.deltaFromTimeline === null
      ? null : candidate.duration - candidate.deltaFromTimeline;
    return (
      <VoiceCandidateBanner
        candidate={candidate}
        timelineSeconds={timelineSeconds}
        isAuditioning={isAuditioning}
        isVoiceBusy={isVoiceBusy}
        onAudition={() => {
          if (isAuditioning) audition.stop();
          else if (props.candidateMaterial) audition.play(segment.id, props.candidateMaterial);
        }}
        onApply={() => commands.applyVoice(segment.id, candidate.materialId)}
        onDismiss={() => dismissCandidate(candidate.materialId)}
        onRegenerate={onRegenerate}
      />
    );
  }
  const picked = segment.videos?.[0];
  if (commands && pickedVisualId === segment.id && picked && props.timelineSpan) {
    const copy = t.workbench.segmentCommands;
    return (
      <div className="segment-banner" role="status" data-testid="picked-visual-banner">
        <span className="segment-banner__text">{copy.pickedVisualTitle}</span>
        <button type="button" className="ws-btn ws-btn--sm ws-btn--primary" onClick={() => {
          setPickedVisual(null);
          commands.replaceVisual(segment.id, picked.id);
        }}>
          {copy.pickedVisualReplace}
        </button>
        <button type="button" className="ws-btn ws-btn--sm ws-btn--text" onClick={() => setPickedVisual(null)}>
          {copy.later}
        </button>
      </div>
    );
  }
  return null;
};

export interface PendingVoicesBarProps {
  links: SegmentLinksValue;
  dismissed: ReadonlySet<string>;
  onApplyAll(): void;
}

/** 「N 段新配音待应用 [全部应用]」— shown from two pending candidates on (§3.5). */
export const PendingVoicesBar: React.FC<PendingVoicesBarProps> = ({ links, dismissed, onApplyAll }) => {
  const { t } = useLocale();
  let count = 0;
  links.statusById.forEach((status) => {
    if (status.candidate && !status.candidate.isStale && !dismissed.has(status.candidate.materialId)) count += 1;
  });
  if (count < 2) return null;
  const copy = t.workbench.segmentCommands;
  return (
    <div className="segment-banner segment-banner--list" role="status" data-testid="pending-voices-bar">
      <span className="segment-banner__text">{copy.pendingVoices.replace('{count}', String(count))}</span>
      <button type="button" className="ws-btn ws-btn--sm ws-btn--primary" onClick={onApplyAll}>
        {copy.applyAll}
      </button>
    </div>
  );
};
