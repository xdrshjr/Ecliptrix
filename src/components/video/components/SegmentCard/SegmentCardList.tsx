'use client';

import React, { useMemo } from 'react';
import type { RefObject } from 'react';
import type { ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import {
  formatSegmentBadge,
  resolveSegmentDuration,
} from '../../lib/segments/segmentLinks';
import type { SegmentIndexEntry } from '../../lib/segments/segmentLinks';
import {
  usePlayingSegmentId,
  useSegmentLinksValue,
} from '../../lib/segments/SegmentLinksContext';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import { useSegmentAudition } from '../../hooks/useSegmentAudition';
import type { SegmentAudition } from '../../hooks/useSegmentAudition';
import SegmentCard from './SegmentCard';
import type { SegmentMenuItem } from './SegmentMoreMenu';
import { useSegmentListFocus } from './useSegmentListFocus';
import type { SegmentListFocus } from './useSegmentListFocus';

/** ScriptPanel's existing handlers — the cards only call them (spec §2.3). */
export interface SegmentListHandlers {
  onGenerateVoice(segment: ScriptSegment): void;
  onReplaceVisual(segmentId: string): void;
  onAiMatchVisual(segmentId: string): void;
  onDeleteSegment(segmentId: string, title: string): void;
  onLocateSegment?(segmentId: string): void;
  onRevealMaterial?(materialId: string): void;
}

/** Per-segment enablement, computed from ScriptPanel's local state. */
export interface SegmentListAvailability {
  isVoiceBusy(segmentId: string): boolean;
  replaceVisualBlockReason(segmentId: string): string | null;
  aiMatchBlockReason(segmentId: string): string | null;
}

interface SegmentCardListProps {
  segments: ScriptSegment[];
  handlers: SegmentListHandlers;
  availability: SegmentListAvailability;
  renderSegmentDetails(segment: ScriptSegment): React.ReactNode;
  onPauseComposition?: () => void;
  panelRef: RefObject<HTMLElement | null>;
}

type CardCopy = ReturnType<typeof useLocale>['t']['workbench']['segmentCard'];

interface MenuInput {
  segment: ScriptSegment;
  links: SegmentLinksValue;
  handlers: SegmentListHandlers;
  availability: SegmentListAvailability;
  copy: CardCopy;
}

/** ⋯ menu items in spec order (§3.5.2): voice, AI match, locate, reveal, delete. */
export function buildSegmentMenuItems(input: MenuInput): SegmentMenuItem[] {
  const { segment, links, handlers, availability, copy } = input;
  const latestVoice = links.latestVoiceById.get(segment.id);
  const aiMatchReason = availability.aiMatchBlockReason(segment.id);
  const items: SegmentMenuItem[] = [
    {
      key: 'voice',
      label: latestVoice ? copy.regenerateVoice : copy.generateVoice,
      onSelect: () => handlers.onGenerateVoice(segment),
      disabled: availability.isVoiceBusy(segment.id),
      disabledReason: copy.voiceGenerating,
    },
    {
      key: 'ai-match',
      label: copy.aiMatch,
      onSelect: () => handlers.onAiMatchVisual(segment.id),
      disabled: aiMatchReason !== null,
      disabledReason: aiMatchReason ?? undefined,
    },
  ];
  if (handlers.onLocateSegment) {
    const onLocate = handlers.onLocateSegment;
    items.push({
      key: 'locate',
      label: copy.locate,
      onSelect: () => onLocate(segment.id),
      disabled: !links.segmentRanges.has(segment.id),
      disabledReason: copy.locateUnavailable,
    });
  }
  const outdated = links.statusById.get(segment.id)?.voiceOnTimeline === 'outdated';
  if (outdated && latestVoice && handlers.onRevealMaterial) {
    const onReveal = handlers.onRevealMaterial;
    items.push({ key: 'reveal', label: copy.revealNewVoice, onSelect: () => onReveal(latestVoice.id) });
  }
  items.push({
    key: 'delete',
    label: copy.delete,
    onSelect: () => handlers.onDeleteSegment(segment.id, segment.title),
    danger: true,
    separatorBefore: true,
  });
  return items;
}

function fallbackIndexEntry(segment: ScriptSegment, position: number): SegmentIndexEntry {
  const badge = formatSegmentBadge(position + 1);
  return { segmentId: segment.id, ordinal: position + 1, title: segment.title, badge, label: `${badge} ${segment.title}` };
}

interface CardContext {
  links: SegmentLinksValue;
  focus: SegmentListFocus;
  audition: SegmentAudition;
  playingSegmentId: string | null;
  props: SegmentCardListProps;
  copy: CardCopy;
}

function renderCard(segment: ScriptSegment, position: number, context: CardContext): React.ReactNode {
  const { links, focus, audition, playingSegmentId, props, copy } = context;
  const { handlers, availability } = props;
  const latestVoice = links.latestVoiceById.get(segment.id) ?? null;
  const isPlaceholder = links.isPlaceholderScript;
  const isAuditioning = audition.auditioningSegmentId === segment.id;
  const range = links.segmentRanges.get(segment.id) ?? null;
  return (
    <SegmentCard
      key={segment.id}
      segment={segment}
      index={links.segmentIndex.get(segment.id) ?? fallbackIndexEntry(segment, position)}
      status={isPlaceholder ? null : links.statusById.get(segment.id) ?? null}
      durationSeconds={resolveSegmentDuration(segment, range, latestVoice)}
      state={{
        isSelected: focus.selectedSegmentId === segment.id,
        isExpanded: focus.expandedSegmentId === segment.id,
        isPlaying: playingSegmentId === segment.id,
        isAuditioning,
        isPlaceholder,
        isHeaderTabStop: focus.tabStopSegmentId === segment.id,
        canAudition: !isPlaceholder && latestVoice !== null,
        replaceVisualBlockReason: availability.replaceVisualBlockReason(segment.id),
        isVoiceBusy: availability.isVoiceBusy(segment.id),
      }}
      actions={{
        onSelect: () => focus.select(segment.id),
        onToggleExpanded: () => focus.toggleExpanded(segment.id),
        onExpand: () => focus.expand(segment.id),
        onCollapse: () => {
          focus.collapse(segment.id);
          focus.focusHeader(segment.id);
        },
        onNavigate: (delta) => focus.navigate(segment.id, delta),
        onAudition: () => {
          if (isAuditioning) audition.stop();
          else if (latestVoice) audition.play(segment.id, latestVoice);
        },
        onReplaceVisual: () => handlers.onReplaceVisual(segment.id),
        onUpdateVoice: () => handlers.onGenerateVoice(segment),
        registerHeader: (element) => focus.registerHeader(segment.id, element),
        registerCard: (element) => focus.registerCard(segment.id, element),
      }}
      menuItems={buildSegmentMenuItems({ segment, links, handlers, availability, copy })}
      renderExpanded={() => props.renderSegmentDetails(segment)}
    />
  );
}

/** 段落卡列表：`role="list"` + roving tabindex 的卡头（spec §3.5.2，RV-07）。 */
const SegmentCardList: React.FC<SegmentCardListProps> = (props) => {
  const { t } = useLocale();
  const links = useSegmentLinksValue();
  const playingSegmentId = usePlayingSegmentId();
  const audition = useSegmentAudition({ onPauseComposition: props.onPauseComposition });
  const segmentIds = useMemo(() => props.segments.map((segment) => segment.id), [props.segments]);
  const focus = useSegmentListFocus({
    segmentIds,
    playingSegmentId,
    panelRef: props.panelRef,
  });
  const context: CardContext = {
    links, focus, audition, playingSegmentId, props, copy: t.workbench.segmentCard,
  };
  return (
    <div className="segment-card-list">
      {links.isPlaceholderScript && (
        <p className="segment-card-list__hint">{t.workbench.script.placeholderHint}</p>
      )}
      <div role="list" aria-label={t.workbench.script.segmentList} className="segment-card-list__items">
        {props.segments.map((segment, position) => renderCard(segment, position, context))}
      </div>
    </div>
  );
};

export default SegmentCardList;
