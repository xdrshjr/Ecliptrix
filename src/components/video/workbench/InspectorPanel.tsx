'use client';

/**
 * InspectorPanel — the 「属性」 page of the right panel (spec §3.7.2).
 *
 * Read-only first: it shows what is selected (timeline clips > material >
 * script segment, most recent selection first — see `inspectorSelection`)
 * and every editable control calls an action or opener the editor already
 * has. Selecting never switches the right panel's tab (iron rule §3.4.1):
 * nothing here calls `setRightPanelTab`.
 */

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { MaterialItem } from '@/types';
import { useTimelineStore } from '../timeline/store';
import type { TimelineItemData, TrackData } from '../timeline/domain/types';
import { formatTimelineTime } from '../timeline/timeFormat';
import MediaPreviewModal from '../components/MediaPreviewModal/MediaPreviewModal';
import { useInspectorSelection } from './inspector/inspectorSelection';
import { ClipInspector } from './inspector/ClipInspector';
import { MaterialInspector } from './inspector/MaterialInspector';
import { SegmentInspector } from './inspector/SegmentInspector';
import {
  EditLockNotice,
  InspectorRow,
  InspectorRows,
  InspectorSection,
} from './inspector/InspectorPrimitives';

export interface InspectorPanelProps {
  /** Every material of the project (`allMaterials`). */
  materials: MaterialItem[];
  onOpenCameraMotion(itemId: string): void;
  onOpenSubtitleStyle(trackId: string): void;
  onAddMaterialToTimeline(material: MaterialItem): void;
  /** Runs before the preview opens (pauses the composition). */
  onBeforePreview(): void;
  onLocateSegment(segmentId: string): void;
  /** Task the preview modal belongs to. */
  taskId: string;
}

interface FoundItem {
  item: TimelineItemData;
  track: TrackData;
}

function findItems(tracks: readonly TrackData[], itemIds: readonly string[]): FoundItem[] {
  const wanted = new Set(itemIds);
  const found: FoundItem[] = [];
  for (const track of tracks) {
    for (const item of track.items) {
      if (wanted.has(item.id)) found.push({ item, track });
    }
  }
  return found;
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="ws-empty ws-inspector-empty">
      <p>{text}</p>
    </div>
  );
}

function MultiSelection({ found }: { found: readonly FoundItem[] }) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const total = found.reduce((sum, { item }) => sum + item.duration, 0);
  return (
    <InspectorSection title={copy.multiSelected.replace('{count}', String(found.length))}>
      <InspectorRows>
        <InspectorRow label={copy.totalDuration} tabular>
          {formatTimelineTime(total, { showMs: true })}
        </InspectorRow>
      </InspectorRows>
    </InspectorSection>
  );
}

interface ItemsSelectionProps extends InspectorPanelProps {
  itemIds: readonly string[];
  isEditLocked: boolean;
}

function ItemsSelection(props: ItemsSelectionProps) {
  const { t } = useLocale();
  const tracks = useTimelineStore((s) => s.tracks);
  const found = findItems(tracks, props.itemIds);
  if (found.length === 0) return <EmptyState text={t.workbench.inspector.empty} />;
  if (found.length > 1) return <MultiSelection found={found} />;
  const { item, track } = found[0];
  return (
    <ClipInspector
      key={item.id}
      item={item}
      track={track}
      materials={props.materials}
      isEditLocked={props.isEditLocked}
      onOpenCameraMotion={props.onOpenCameraMotion}
      onOpenSubtitleStyle={props.onOpenSubtitleStyle}
    />
  );
}

export default function InspectorPanel(props: InspectorPanelProps) {
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const selection = useInspectorSelection(props.materials);
  const isEditLocked = useTimelineStore((s) => s.externalEditLock !== null);
  const lockReason = isEditLocked ? copy.editLocked : null;
  // The inspector hosts its own preview so VideoEditingInterface does not
  // grow another piece of modal state (size gate).
  const [previewMaterial, setPreviewMaterial] = useState<MaterialItem | null>(null);
  const openPreview = (material: MaterialItem) => {
    props.onBeforePreview();
    setPreviewMaterial(material);
  };

  let body: React.ReactNode;
  if (selection.kind === 'items') {
    body = <ItemsSelection {...props} itemIds={selection.itemIds} isEditLocked={isEditLocked} />;
  } else if (selection.kind === 'material') {
    const material = props.materials.find((m) => m.id === selection.materialId);
    body = material ? (
      <MaterialInspector
        material={material}
        lockReason={lockReason}
        onAddMaterialToTimeline={props.onAddMaterialToTimeline}
        onPreviewMaterial={openPreview}
      />
    ) : null;
  } else if (selection.kind === 'segment') {
    body = (
      <SegmentInspector segmentId={selection.segmentId} onLocateSegment={props.onLocateSegment} />
    );
  }

  return (
    <div className="ws-inspector" data-selection={selection.kind}>
      {lockReason && selection.kind !== 'none' ? <EditLockNotice message={lockReason} /> : null}
      {body ?? <EmptyState text={copy.empty} />}
      {previewMaterial ? (
        <MediaPreviewModal
          isOpen
          material={previewMaterial}
          onClose={() => setPreviewMaterial(null)}
          taskId={props.taskId}
        />
      ) : null}
    </div>
  );
}
