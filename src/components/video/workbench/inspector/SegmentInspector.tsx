'use client';

/**
 * Properties of a script segment selected in the left panel (spec §3.7.2).
 * Read-only apart from 「定位到时间轴」, which calls the caller's locate handler.
 */

import React from 'react';
import {
  AlertTriangle,
  Captions,
  Check,
  ImageIcon,
  Loader,
  LocateFixed,
  Mic,
} from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import {
  useSegmentCommandsValue,
  useSegmentLinksValue,
} from '../../lib/segments/SegmentLinksContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import SegmentVoiceOverride from '../../components/SegmentCard/SegmentVoiceOverride';
import type { SegmentStatus } from '../../lib/segments/segmentLinks';
import { formatTimelineTime } from '../../timeline/timeFormat';
import {
  InspectorActions,
  InspectorRow,
  InspectorRows,
  InspectorSection,
} from './InspectorPrimitives';

type Translations = ReturnType<typeof useLocale>['t'];
type ChipTone = 'ok' | 'warn' | 'plain';

interface StatusChip {
  key: string;
  tone: ChipTone;
  icon: React.ReactNode;
  text: string;
}

const ICON = { size: 12, strokeWidth: 1.75, 'aria-hidden': true } as const;

function voiceChip(status: SegmentStatus, copy: Translations['workbench']['segmentCard']): StatusChip {
  if (status.voice === 'generating') {
    return { key: 'voice', tone: 'plain', icon: <Loader {...ICON} className="animate-spin" />, text: copy.voiceGenerating };
  }
  if (status.voice === 'stale') {
    return { key: 'voice', tone: 'warn', icon: <AlertTriangle {...ICON} />, text: copy.voiceStale };
  }
  if (status.voice === 'ready' && status.voiceOnTimeline === 'outdated') {
    return { key: 'voice', tone: 'warn', icon: <AlertTriangle {...ICON} />, text: copy.voiceOutdated };
  }
  if (status.voice === 'ready') {
    return { key: 'voice', tone: 'ok', icon: <Mic {...ICON} />, text: copy.voiceReady };
  }
  return { key: 'voice', tone: 'plain', icon: <Mic {...ICON} />, text: copy.voiceNone };
}

/** Status never by colour alone: every chip carries an icon and its text. */
function statusChips(status: SegmentStatus, t: Translations): StatusChip[] {
  const copy = t.workbench.segmentCard;
  const visualReady = status.visual === 'configured';
  const subtitleReady = status.subtitle === 'ready';
  return [
    {
      key: 'visual',
      tone: visualReady ? 'ok' : 'plain',
      icon: visualReady ? <Check {...ICON} /> : <ImageIcon {...ICON} />,
      text: visualReady ? copy.visualConfigured : copy.visualMissing,
    },
    voiceChip(status, copy),
    {
      key: 'subtitle',
      tone: subtitleReady ? 'ok' : 'plain',
      icon: <Captions {...ICON} />,
      text: subtitleReady ? copy.subtitleReady : copy.subtitleNone,
    },
  ];
}

function chipClass(tone: ChipTone): string {
  if (tone === 'ok') return 'ws-chip ws-chip--ok';
  if (tone === 'warn') return 'ws-chip ws-chip--warn';
  return 'ws-chip';
}

export interface SegmentInspectorProps {
  segmentId: string;
  onLocateSegment(segmentId: string): void;
}

export function SegmentInspector({ segmentId, onLocateSegment }: SegmentInspectorProps) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const { segmentIndex, segmentRanges, statusById, itemSegmentMap } = useSegmentLinksValue();
  const commands = useSegmentCommandsValue();
  const requestSegmentVoice = useEditorFocusStore((state) => state.requestSegmentVoice);
  const segment = commands?.getSegment(segmentId);
  const entry = segmentIndex.get(segmentId);
  const range = segmentRanges.get(segmentId);
  const status = statusById.get(segmentId);
  let linkedCount = 0;
  itemSegmentMap.forEach((owner) => {
    if (owner === segmentId) linkedCount += 1;
  });

  return (
    <InspectorSection
      title={
        <>
          {entry ? <span className="ws-badge-ordinal">{entry.badge}</span> : null}
          <span className="ws-inspector-title-text">{entry?.title ?? copy.segment}</span>
        </>
      }
    >
      <InspectorRows>
        <InspectorRow label={copy.timeRange} tabular>
          {range
            ? `${formatTimelineTime(range.start)} – ${formatTimelineTime(range.end)}`
            : copy.none}
        </InspectorRow>
        <InspectorRow label={copy.linkedClips} tabular>
          {linkedCount}
        </InspectorRow>
      </InspectorRows>
      {status ? (
        <ul className="ws-inspector-chips" aria-label={copy.segment}>
          {statusChips(status, t).map((chip) => (
            <li key={chip.key} className={chipClass(chip.tone)}>
              {chip.icon}
              <span>{chip.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {commands && segment ? (
        <SegmentVoiceOverride
          segment={segment}
          defaultVoiceId={commands.getDefaultVoiceId()}
          variant="inspector"
          disabled={status?.voice === 'generating'}
          onPatch={(patch) => commands.patchSegment(segmentId, patch)}
          onRegenerate={() => requestSegmentVoice([segmentId])}
        />
      ) : null}
      <InspectorActions>
        <button
          type="button"
          className="ws-btn ws-btn--outline-primary"
          onClick={() => onLocateSegment(segmentId)}
        >
          <LocateFixed size={16} strokeWidth={1.75} aria-hidden="true" />
          {t.workbench.segmentCard.locate}
        </button>
      </InspectorActions>
    </InspectorSection>
  );
}
