'use client';

/**
 * Properties of the material selected on the materials page (spec §3.7.2).
 * The technical details the cards no longer show (full name, format,
 * resolution, source, cache state) live here. Both buttons call the same
 * handlers the materials page uses.
 */

import React from 'react';
import { Eye, Plus } from './icons';
import { useLocale } from '@/contexts/LocaleContext';
import type { MaterialItem } from '@/types';
import MaterialThumbnail from '../../components/MaterialsPanel/MaterialThumbnail';
import MaterialCacheBadge from '../../components/MaterialCacheBadge';
import { useSegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import { formatTimelineTime } from '../../timeline/timeFormat';
import {
  InspectorActions,
  InspectorRow,
  InspectorRows,
  InspectorSection,
} from './InspectorPrimitives';

type Translations = ReturnType<typeof useLocale>['t'];

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

export interface MaterialInspectorProps {
  material: MaterialItem;
  /** Non-null while the agent edit lock is held; adding is an edit. */
  lockReason: string | null;
  onAddMaterialToTimeline(material: MaterialItem): void;
  onPreviewMaterial(material: MaterialItem): void;
}

function typeLabel(type: MaterialItem['type'], t: Translations): string {
  const copy = t.workbench.materials;
  if (type === 'video') return copy.filterVideo;
  if (type === 'audio') return copy.filterAudio;
  if (type === 'image') return copy.filterImage;
  return type;
}

function sourceLabel(material: MaterialItem): string | null {
  const source = material.metadata?.source ?? material.metadata?.storageKind;
  return typeof source === 'string' && source ? source : null;
}

function cacheLabel(material: MaterialItem, t: Translations): string | null {
  const status = material.cacheStatus;
  if (!status || status === 'idle') return null;
  return t.materialsPanel.cacheStatus[status];
}

/** 「已用于第 N 段」: the derived link first, the legacy segment number second. */
function useUsedInOrdinal(material: MaterialItem): number | null {
  const { materialSegmentMap, segmentIndex } = useSegmentLinksValue();
  const segmentId = materialSegmentMap.get(material.id);
  const ordinal = segmentId ? segmentIndex.get(segmentId)?.ordinal : undefined;
  if (ordinal) return ordinal;
  const legacy = material.metadata?.segment_number;
  return typeof legacy === 'number' && legacy > 0 ? legacy : null;
}

export function MaterialInspector(props: MaterialInspectorProps) {
  const { material, lockReason, onAddMaterialToTimeline, onPreviewMaterial } = props;
  const { t } = useLocale();
  const copy = t.workbench.inspector;
  const ordinal = useUsedInOrdinal(material);
  const cache = cacheLabel(material, t);
  const resolution =
    material.width && material.height ? `${material.width}×${material.height}` : null;
  const fileName = material.metadata?.fileName || material.name;

  return (
    <InspectorSection>
      <div className="ws-inspector-thumb">
        <MaterialThumbnail material={material} />
      </div>
      <InspectorRows>
        <InspectorRow label={copy.fileName}>
          <span className="ws-inspector-wrap">{fileName}</span>
        </InspectorRow>
        <InspectorRow label={copy.type}>{typeLabel(material.type, t)}</InspectorRow>
        <InspectorRow label={copy.duration} tabular>
          {material.duration ? formatTimelineTime(material.duration, { showMs: true }) : copy.none}
        </InspectorRow>
        <InspectorRow label={copy.resolution} tabular>{resolution ?? copy.none}</InspectorRow>
        <InspectorRow label={copy.format}>{material.format || copy.none}</InspectorRow>
        <InspectorRow label={copy.source}>{sourceLabel(material) ?? copy.none}</InspectorRow>
        {cache ? (
          <InspectorRow label={copy.cache}>
            <span className="ws-inspector-inline">
              <MaterialCacheBadge material={material} hideReady />
              {cache}
            </span>
          </InspectorRow>
        ) : null}
        <InspectorRow label={copy.usedIn}>
          {ordinal
            ? t.workbench.materials.usedInSegment.replace('{index}', String(ordinal))
            : copy.notUsed}
        </InspectorRow>
      </InspectorRows>
      <InspectorActions>
        <button
          type="button"
          className="ws-btn ws-btn--primary"
          disabled={lockReason !== null}
          title={lockReason ?? undefined}
          onClick={() => onAddMaterialToTimeline(material)}
        >
          <Plus {...ICON} />
          {t.workbench.materials.addToTimeline}
        </button>
        <button type="button" className="ws-btn" onClick={() => onPreviewMaterial(material)}>
          <Eye {...ICON} />
          {t.workbench.materials.preview}
        </button>
      </InspectorActions>
    </InspectorSection>
  );
}
