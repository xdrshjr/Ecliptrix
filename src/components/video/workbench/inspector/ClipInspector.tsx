'use client';

/**
 * Properties of ONE selected timeline clip (spec §3.7.2). Values are derived
 * read-only; every control calls an action the timeline already uses, so the
 * inspector adds no new way to change the project.
 */

import React from 'react';
import { Frame, Move } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import type { MaterialItem } from '@/types';
import { useTimelineStore } from '../../timeline/store';
import { updateImagePositionAction } from '../../timeline/store/actions/updateItemFields';
import type { TimelineItemData, TrackData } from '../../timeline/domain/types';
import { deriveTrackDisplayName } from '../../timeline/trackDisplayName';
import { formatTimelineTime } from '../../timeline/timeFormat';
import { useSegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import { canApplyCameraMotion } from '../../playback/camera/eligibility';
import { DEFAULT_IMAGE_POSITION } from '../../components/VideoPlayerPanel/imageOverlayGeometry';
import {
  InspectorActions,
  InspectorRow,
  InspectorRows,
  InspectorSection,
} from './InspectorPrimitives';
import { AudioClipControls } from './AudioClipControls';
import { SubtitleTextField } from './SubtitleTextField';

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** Whole frame: the compositor contains the image inside this box. */
const FULL_FRAME = { x: 0, y: 0, width: 1, height: 1 } as const;

export interface ClipInspectorProps {
  item: TimelineItemData;
  track: TrackData;
  materials: readonly MaterialItem[];
  isEditLocked: boolean;
  onOpenCameraMotion(itemId: string): void;
  onOpenSubtitleStyle(trackId: string): void;
}

/** Image materials ride video tracks and keep `originalMaterialType`. */
function isImageClip(item: TimelineItemData): boolean {
  return item.originalMaterialType === 'image';
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function resolutionOf(item: TimelineItemData, material: MaterialItem | undefined): string | null {
  const width = material?.width ?? readNumber(item.metadata?.width);
  const height = material?.height ?? readNumber(item.metadata?.height);
  return width && height ? `${width}×${height}` : null;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** 「所属段落」: clicking selects the segment; it never switches tabs. */
function SegmentLinkRow({ itemId, label, none }: { itemId: string; label: string; none: string }) {
  const { itemSegmentMap, segmentIndex } = useSegmentLinksValue();
  const selectSegment = useEditorFocusStore((s) => s.selectSegment);
  const segmentId = itemSegmentMap.get(itemId);
  const entry = segmentId ? segmentIndex.get(segmentId) : undefined;
  return (
    <InspectorRow label={label}>
      {segmentId && entry ? (
        <button
          type="button"
          className="ws-inspector-link"
          onClick={() => selectSegment(segmentId, 'timeline')}
        >
          {entry.label}
        </button>
      ) : (
        none
      )}
    </InspectorRow>
  );
}

function TimingRows({ item }: { item: TimelineItemData }) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const format = (seconds: number) => formatTimelineTime(seconds, { showMs: true });
  return (
    <>
      <InspectorRow label={copy.start} tabular>{format(item.startTime)}</InspectorRow>
      <InspectorRow label={copy.end} tabular>{format(item.startTime + item.duration)}</InspectorRow>
      <InspectorRow label={copy.duration} tabular>{format(item.duration)}</InspectorRow>
    </>
  );
}

interface VisualClipProps extends ClipInspectorProps {
  lockReason: string | null;
}

function ImagePositionRow({ item }: { item: TimelineItemData }) {
  const { t } = useLocale();
  const position = item.imagePosition ?? DEFAULT_IMAGE_POSITION;
  return (
    <InspectorRow label={t.workbench.inspector.position} tabular>
      {`X ${percent(position.x)} · Y ${percent(position.y)} · `}
      {`${percent(position.width)} × ${percent(position.height)}`}
    </InspectorRow>
  );
}

function VisualClipDetails(props: VisualClipProps) {
  const { item, track, materials, lockReason, onOpenCameraMotion } = props;
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const material = materials.find((m) => m.id === item.materialId);
  const isImage = isImageClip(item);
  const cameraAllowed = canApplyCameraMotion(item, track);
  const cameraReason = lockReason ?? (track.isLocked ? t.timeline.track.trackLocked : null);

  const fitToFrame = () => {
    const current = item.imagePosition ?? DEFAULT_IMAGE_POSITION;
    // A user click is an edit, so it records one undo step (unlike the
    // first-frame auto-fit, which deliberately stays out of history).
    updateImagePositionAction(() => useTimelineStore.getState(), item.id, {
      ...current,
      ...FULL_FRAME,
    });
  };

  return (
    <>
      <InspectorRows>
        <SegmentLinkRow itemId={item.id} label={copy.segmentOf} none={copy.notUsed} />
        <InspectorRow label={copy.track}>{deriveTrackDisplayName(track, t.timeline.track)}</InspectorRow>
        <TimingRows item={item} />
        <InspectorRow label={copy.sourceMaterial}>
          <span className="ws-inspector-ellipsis" title={material?.name ?? item.name}>
            {material?.name ?? item.name}
          </span>
        </InspectorRow>
        <InspectorRow label={copy.resolution} tabular>
          {resolutionOf(item, material) ?? copy.none}
        </InspectorRow>
        <InspectorRow label={copy.format}>{material?.format || copy.none}</InspectorRow>
        {isImage ? <ImagePositionRow item={item} /> : null}
      </InspectorRows>
      <InspectorActions>
        {isImage ? (
          <button
            type="button"
            className="ws-btn"
            disabled={lockReason !== null || track.isLocked}
            title={cameraReason ?? copy.fitImage}
            onClick={fitToFrame}
          >
            <Frame {...ICON} />
            {copy.fitImage}
          </button>
        ) : null}
        <button
          type="button"
          className="ws-btn"
          disabled={lockReason !== null || !cameraAllowed}
          title={cameraReason ?? copy.cameraMotion}
          onClick={() => onOpenCameraMotion(item.id)}
        >
          <Move {...ICON} />
          {copy.cameraMotion}
        </button>
      </InspectorActions>
    </>
  );
}

function AudioClipDetails({ item, track, lockReason }: VisualClipProps) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const voice = item.metadata?.voice_type;
  return (
    <>
      <InspectorRows>
        <SegmentLinkRow itemId={item.id} label={copy.segmentOf} none={copy.notUsed} />
        <InspectorRow label={copy.duration} tabular>
          {formatTimelineTime(item.duration, { showMs: true })}
        </InspectorRow>
        <InspectorRow label={copy.sentences} tabular>
          {item.sentenceSegments?.sentences?.length ?? 0}
        </InspectorRow>
        <InspectorRow label={copy.voice}>
          {typeof voice === 'string' && voice ? voice : copy.none}
        </InspectorRow>
      </InspectorRows>
      <AudioClipControls track={track} lockReason={lockReason} />
    </>
  );
}

function SubtitleClipDetails(props: VisualClipProps) {
  const { item, track, lockReason, onOpenSubtitleStyle } = props;
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const time =
    `${formatTimelineTime(item.startTime, { showMs: true })} – ` +
    formatTimelineTime(item.startTime + item.duration, { showMs: true });
  const trackReason = track.isLocked ? t.timeline.track.trackLocked : null;
  return (
    <>
      <InspectorRows>
        <InspectorRow label={copy.timeRange} tabular>{time}</InspectorRow>
      </InspectorRows>
      <SubtitleTextField
        itemId={item.id}
        text={item.text ?? ''}
        disabledReason={lockReason ?? trackReason}
      />
      <InspectorActions>
        <button
          type="button"
          className="ws-btn"
          disabled={lockReason !== null}
          title={lockReason ?? copy.subtitleStyle}
          onClick={() => onOpenSubtitleStyle(track.id)}
        >
          {copy.subtitleStyle}
        </button>
      </InspectorActions>
    </>
  );
}

export function ClipInspector(props: ClipInspectorProps) {
  const { t } = useLocale();
  const lockReason = props.isEditLocked ? t.workbench.inspector.editLocked : null;
  const detailProps: VisualClipProps = { ...props, lockReason };
  const { item, track } = props;
  const kind = track.type;

  return (
    <InspectorSection title={<span className="ws-inspector-title-text">{item.name}</span>}>
      {kind === 'audio' ? <AudioClipDetails {...detailProps} /> : null}
      {kind === 'subtitle' ? <SubtitleClipDetails {...detailProps} /> : null}
      {kind === 'video' ? <VisualClipDetails {...detailProps} /> : null}
    </InspectorSection>
  );
}
