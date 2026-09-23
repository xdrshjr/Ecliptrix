'use client';

import React, { useMemo } from 'react';
import type { RefObject } from 'react';
import type { ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import {
  formatSegmentBadge,
  resolveSegmentDuration,
} from '../../lib/segments/segmentLinks';
import type { SegmentIndexEntry } from '../../lib/segments/segmentLinks';
import {
  usePlayingSegmentId,
  useSegmentCommandsValue,
  useSegmentLinksValue,
} from '../../lib/segments/SegmentLinksContext';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import type { SegmentCommands } from '../../hooks/useSegmentCommands';
import { useSegmentAudition } from '../../hooks/useSegmentAudition';
import type { SegmentAudition } from '../../hooks/useSegmentAudition';
import SegmentCard from './SegmentCard';
import type { SegmentMenuItem } from './SegmentMoreMenu';
import { useSegmentListFocus } from './useSegmentListFocus';
import type { SegmentListFocus } from './useSegmentListFocus';
import { useSegmentReorderDrag } from './useSegmentReorderDrag';
import type { SegmentReorderDrag } from './useSegmentReorderDrag';
import { SegmentNotice, PendingVoicesBar } from './SegmentNotice';
import {
  buildLeadingCommandItems,
  buildTrailingCommandItems,
} from './segmentMenuExtras';

/** ScriptPanel's existing handlers — the cards only call them (spec §2.3). */
export interface SegmentListHandlers {
  onGenerateVoice(segment: ScriptSegment): void;
  onReplaceVisual(segmentId: string): void;
  onAiMatchVisual(segmentId: string): void;
  onDeleteSegment(segmentId: string, title: string): void;
  onLocateSegment?(segmentId: string): void;
  onRevealMaterial?(materialId: string): void;
  /** 「润色本段文案」(R2 §3.12). */
  onPolishSegment?(segment: ScriptSegment): void;
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

type LocaleCopy = ReturnType<typeof useLocale>['t'];
type CardCopy = LocaleCopy['workbench']['segmentCard'];

interface MenuInput {
  segment: ScriptSegment;
  links: SegmentLinksValue;
  handlers: SegmentListHandlers;
  availability: SegmentListAvailability;
  copy: CardCopy;
  /** R2 segment commands; without them the menu is the R1 menu. */
  commands?: SegmentCommands | null;
  commandCopy?: LocaleCopy['workbench']['segmentCommands'];
  position?: number;
  count?: number;
}

/**
 * ⋯ menu items (§3.5.2 + R2): polish / apply new voice, voice, AI match,
 * locate, reveal, voice versions, move up / down, delete.
 */
export function buildSegmentMenuItems(input: MenuInput): SegmentMenuItem[] {
  const { segment, links, handlers, availability, copy, commands, commandCopy } = input;
  const commandInput = commands && commandCopy ? {
    segment, links, commands, copy: commandCopy, position: input.position ?? 0,
    count: input.count ?? 1, onPolish: handlers.onPolishSegment,
  } : null;
  const latestVoice = links.latestVoiceById.get(segment.id);
  const aiMatchReason = availability.aiMatchBlockReason(segment.id);
  const items: SegmentMenuItem[] = [
    ...(commandInput ? buildLeadingCommandItems(commandInput) : []),
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
  if (commandInput) items.push(...buildTrailingCommandItems(commandInput));
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
  drag: SegmentReorderDrag;
  commands: SegmentCommands | null;
  playingSegmentId: string | null;
  props: SegmentCardListProps;
  t: LocaleCopy;
}

function dropHintFor(segmentId: string, ordinal: number, context: CardContext) {
  const state = context.drag.dropState;
  if (state.kind !== 'material' || state.segmentId !== segmentId) return null;
  const copy = context.t.workbench.segmentCommands;
  return state.accepts
    ? { text: copy.dropReplace.replace('{index}', String(ordinal)), accepts: true }
    : { text: copy.dropAudioRejected, accepts: false };
}

// Function exceeds 60 lines by design: it maps one segment onto the card's
// flat props; splitting it would only move the same assignments around.
function renderCard(segment: ScriptSegment, position: number, context: CardContext): React.ReactNode {
  const { links, focus, audition, drag, commands, playingSegmentId, props, t } = context;
  const { handlers, availability } = props;
  const copy = t.workbench.segmentCard;
  const latestVoice = links.latestVoiceById.get(segment.id) ?? null;
  const isPlaceholder = links.isPlaceholderScript;
  const isAuditioning = audition.auditioningSegmentId === segment.id;
  const range = links.segmentRanges.get(segment.id) ?? null;
  const index = links.segmentIndex.get(segment.id) ?? fallbackIndexEntry(segment, position);
  const count = props.segments.length;
  const canReorder = !isPlaceholder && commands !== null && count > 1;
  return (
    <React.Fragment key={segment.id}>
      {drag.dropState.kind === 'reorder' && drag.dropState.insertAt === position && (
        <div className="segment-reorder-line" aria-hidden="true" />
      )}
      <SegmentCard
        segment={segment}
        index={index}
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
        menuItems={buildSegmentMenuItems({
          segment, links, handlers, availability, copy, commands,
          commandCopy: t.workbench.segmentCommands, position, count,
        })}
        renderExpanded={() => props.renderSegmentDetails(segment)}
        notice={isPlaceholder ? null : (
          <SegmentNotice
            segment={segment}
            status={links.statusById.get(segment.id) ?? null}
            timelineSpan={range}
            candidateMaterial={latestVoice}
            audition={audition}
            commands={commands}
            isVoiceBusy={availability.isVoiceBusy(segment.id)}
            onRegenerate={() => handlers.onGenerateVoice(segment)}
          />
        )}
        dragHandle={canReorder ? {
          label: t.workbench.segmentCommands.dragHandle.replace('{index}', String(index.ordinal)),
          props: drag.handleProps(segment.id, position, count),
        } : undefined}
        dropProps={isPlaceholder || !commands ? undefined : drag.cardDropProps(segment.id, position)}
        dropHint={dropHintFor(segment.id, index.ordinal, context)}
      />
      {drag.dropState.kind === 'reorder' && drag.dropState.insertAt === count && position === count - 1 && (
        <div className="segment-reorder-line" aria-hidden="true" />
      )}
    </React.Fragment>
  );
}

/** 段落卡列表：`role="list"` + roving tabindex 的卡头（spec §3.5.2，RV-07）。 */
const SegmentCardList: React.FC<SegmentCardListProps> = (props) => {
  const { t } = useLocale();
  const links = useSegmentLinksValue();
  const commands = useSegmentCommandsValue();
  const playingSegmentId = usePlayingSegmentId();
  const audition = useSegmentAudition({ onPauseComposition: props.onPauseComposition });
  const segmentIds = useMemo(() => props.segments.map((segment) => segment.id), [props.segments]);
  const focus = useSegmentListFocus({
    segmentIds,
    playingSegmentId,
    panelRef: props.panelRef,
  });
  const dragCallbacks = useMemo(() => ({
    onMove: (segmentId: string, toIndex: number) => commands?.move(segmentId, toIndex),
    onReplaceVisual: (segmentId: string, materialId: string) => commands?.replaceVisual(segmentId, materialId),
  }), [commands]);
  const drag = useSegmentReorderDrag(segmentIds, dragCallbacks);
  const dismissed = useEditorFocusStore((state) => state.dismissedCandidateIds);
  const context: CardContext = {
    links, focus, audition, drag, commands, playingSegmentId, props, t,
  };
  return (
    <div className="segment-card-list">
      {links.isPlaceholderScript && (
        <p className="segment-card-list__hint">{t.workbench.script.placeholderHint}</p>
      )}
      {!links.isPlaceholderScript && commands && (
        <PendingVoicesBar links={links} dismissed={dismissed} onApplyAll={commands.applyAllPendingVoices} />
      )}
      <div role="list" aria-label={t.workbench.script.segmentList} className="segment-card-list__items">
        {props.segments.map((segment, position) => renderCard(segment, position, context))}
      </div>
    </div>
  );
};

export default SegmentCardList;
