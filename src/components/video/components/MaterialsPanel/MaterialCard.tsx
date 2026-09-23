'use client';

/**
 * MaterialCard — video / image card of the materials page (spec §3.7.1).
 *
 * Big 16:9 thumbnail + duration, name, 「已用于第 N 段」 chip; 「+ 添加」 and ⋯
 * appear on hover or keyboard focus. Every status overlay (download, upload,
 * generation, failure + retry, waiting analysis) is migrated unchanged from
 * the pre-workbench grid, and so is the drag payload — the timeline's drop
 * targets read it byte for byte.
 *
 * Single click only selects (editor focus store); double click / Enter opens
 * the preview. The card never changes the project by itself.
 */

import React from 'react';
import type { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import {
  useSegmentLinksValue,
  type SegmentLinksValue,
} from '../../lib/segments/SegmentLinksContext';
import { MATERIAL_DRAG_MIME_PREFIX } from '../../timeline/lib/materialDragTypes';
import { canPreviewDirectLocalMaterial } from '../../lib/localMaterial';
import MaterialThumbnail from './MaterialThumbnail';
import MaterialCacheBadge from '../MaterialCacheBadge';
import MaterialMoreMenu, { type MaterialMenuItem } from './MaterialMoreMenu';
import MaterialStatusOverlays from './MaterialStatusOverlays';
import { MaterialIcon, type MaterialIconName } from './materialIcons';

export type MaterialAnalysisStatus =
  'idle' | 'waiting' | 'analyzing' | 'completed' | 'error';

type ClickEvent = React.MouseEvent<HTMLElement>;

/** Handlers the panel owns; the card only routes user gestures to them. */
export interface MaterialCardActions {
  onAddToTimeline?(material: MaterialItem): void;
  onPreview(material: MaterialItem): void;
  onAnalyze(material: MaterialItem, event: ClickEvent): void;
  onImageToVideo(material: MaterialItem, event: ClickEvent): void;
  onCut(material: MaterialItem, event: ClickEvent): void;
  onRemoveWatermark(material: MaterialItem, event: ClickEvent): void;
  onDownload(material: MaterialItem, event: ClickEvent): void;
  onDelete(material: MaterialItem, event: ClickEvent): void;
  onRetryDownload?(material: MaterialItem): void;
  onDragStart(material: MaterialItem): void;
  onDragEnd(material: MaterialItem, dropEffect: string): void;
}

export interface MaterialCardProps {
  material: MaterialItem;
  actions: MaterialCardActions;
  analysisStatus: MaterialAnalysisStatus;
  /** Live queue status is 'waiting' — drives the unchanged waiting overlay. */
  isWaitingAnalysis: boolean;
  isDragging: boolean;
  isDownloading: boolean;
  isConvertingToVideo: boolean;
  /** Type icon on the thumbnail — only under the 「全部」 category. */
  showTypeIcon: boolean;
}

/* ------------------------------------------------------------------ */
/* Pure helpers (shared with AudioMaterialRow, unit-tested)            */
/* ------------------------------------------------------------------ */

/** Same condition as the pre-workbench grid: busy materials cannot be dragged. */
export function isMaterialDraggable(material: MaterialItem): boolean {
  return material.downloadStatus !== 'downloading'
    && material.downloadStatus !== 'generating'
    && material.uploadStatus !== 'uploading'
    && material.uploadStatus !== 'waiting'
    && material.cacheStatus !== 'pending'
    && material.cacheStatus !== 'downloading';
}

/** Drag payload — unchanged: timeline tracks parse exactly these entries. */
export function writeMaterialDragData(dataTransfer: DataTransfer, material: MaterialItem): void {
  dataTransfer.setData('application/json', JSON.stringify({
    type: 'material',
    material: material,
  }));
  // dragenter/dragover can read DataTransfer.types but not getData, so the
  // tracks learn the material type from this entry (ME-10).
  dataTransfer.setData(`${MATERIAL_DRAG_MIME_PREFIX}${material.type}`, material.id);
  dataTransfer.effectAllowed = 'copy';
  if (material.thumbnailUrl) {
    const img = new Image();
    img.src = material.thumbnailUrl;
    dataTransfer.setDragImage(img, 50, 50);
  }
}

/**
 * Analysis state shown in the ⋯ menu. A persisted `analysisResult` wins over
 * the live queue status, exactly like the old card button.
 */
export function resolveAnalysisStatus(
  material: MaterialItem,
  getVideoAnalysisStatus?: (videoUrl: string) => MaterialAnalysisStatus,
): MaterialAnalysisStatus {
  const result = material.analysisResult;
  if (result) {
    if (result.status === 'pending') return 'analyzing';
    return result.status === 'completed' ? 'completed' : 'idle';
  }
  return getVideoAnalysisStatus ? getVideoAnalysisStatus(material.url || '') : 'idle';
}

type SegmentLookup = Pick<SegmentLinksValue, 'materialSegmentMap' | 'segmentIndex'>;

/**
 * 1-based segment ordinal for the 「已用于第 N 段」 chip: the shared segment
 * derivation first, then the legacy `metadata.segment_number`; null → no chip.
 */
export function resolveUsedSegmentOrdinal(
  material: MaterialItem,
  links: SegmentLookup,
): number | null {
  const segmentId = links.materialSegmentMap.get(material.id);
  const ordinal = segmentId ? links.segmentIndex.get(segmentId)?.ordinal : undefined;
  if (typeof ordinal === 'number') return ordinal;
  const fallback = Number(material.metadata?.segment_number);
  return Number.isInteger(fallback) && fallback > 0 ? fallback : null;
}

/** 15 → "00:15", 3725 → "1:02:05". */
export function formatMaterialDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const pad = (value: number) => String(value).padStart(2, '0');
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}

/** Clicks on controls inside a card must not select / preview it. */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && target.closest('button,a,input,textarea,select,[role="menu"]') !== null;
}

export function useUsedSegmentOrdinal(material: MaterialItem): number | null {
  const links = useSegmentLinksValue();
  return resolveUsedSegmentOrdinal(material, links);
}

export function useIsMaterialSelected(materialId: string): boolean {
  return useEditorFocusStore((state) => state.selectedMaterialId === materialId);
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

const TYPE_ICONS: Partial<Record<MaterialItem['type'], MaterialIconName>> = {
  video: 'video', image: 'image', audio: 'music', subtitle: 'fileText',
};

function useCardMenuItems(props: MaterialCardProps): MaterialMenuItem[] {
  const { t } = useLocale();
  const { material, actions, analysisStatus } = props;
  const m = t.workbench.materials;
  const isVisual = material.type === 'video' || material.type === 'image';
  const analysisLabel: Record<MaterialAnalysisStatus, string> = {
    waiting: m.analysisWaiting,
    analyzing: t.materialsPanel.aiAnalyzing,
    completed: t.materialsPanel.viewAnalysisResult,
    idle: t.materialsPanel.aiVideoAnalysis,
    error: t.materialsPanel.aiVideoAnalysis,
  };
  const analysisBusy = analysisStatus === 'waiting' || analysisStatus === 'analyzing';
  const items: Array<MaterialMenuItem | false> = [
    { key: 'preview', label: m.preview, icon: 'eye', onSelect: () => actions.onPreview(material) },
    isVisual && {
      key: 'analyze', label: analysisLabel[analysisStatus],
      icon: analysisBusy ? 'spinner' : 'sparkles', disabled: analysisBusy,
      onSelect: (event) => actions.onAnalyze(material, event),
    },
    material.type === 'image' && {
      key: 'to-video',
      label: props.isConvertingToVideo ? m.convertingToVideo : m.convertToVideo,
      icon: props.isConvertingToVideo ? 'spinner' : 'film',
      disabled: props.isConvertingToVideo,
      onSelect: (event) => actions.onImageToVideo(material, event),
    },
    material.type === 'video' && {
      key: 'cut', label: m.cut, icon: 'scissors',
      onSelect: (event) => actions.onCut(material, event),
    },
    material.type === 'video' && {
      key: 'watermark', label: m.removeWatermark, icon: 'eraser',
      onSelect: (event) => actions.onRemoveWatermark(material, event),
    },
    {
      key: 'download',
      label: props.isDownloading ? m.downloading : t.materialsPanel.download,
      icon: props.isDownloading ? 'spinner' : 'download', disabled: props.isDownloading,
      onSelect: (event) => actions.onDownload(material, event),
    },
    {
      key: 'delete', label: m.deleteMaterial, icon: 'trash', danger: true,
      separatorBefore: true, onSelect: (event) => actions.onDelete(material, event),
    },
  ];
  return items.filter((item): item is MaterialMenuItem => Boolean(item));
}

const MaterialCard: React.FC<MaterialCardProps> = (props) => {
  const { material, actions, isDragging, showTypeIcon } = props;
  const { t } = useLocale();
  const m = t.workbench.materials;
  const isSelected = useIsMaterialSelected(material.id);
  const usedOrdinal = useUsedSegmentOrdinal(material);
  const menuItems = useCardMenuItems(props);
  const draggable = isMaterialDraggable(material);
  const typeIcon = TYPE_ICONS[material.type];
  // The cache badge stays for its functional states (queued / caching /
  // failed + retry); the informational 「已缓存」 moved to the Properties tab.
  const showCacheBadge = material.type === 'video'
    && !canPreviewDirectLocalMaterial(material);

  const handleClick = (event: ClickEvent) => {
    if (isInteractiveTarget(event.target)) return;
    useEditorFocusStore.getState().selectMaterial(material.id);
  };
  const handleDoubleClick = (event: ClickEvent) => {
    if (isInteractiveTarget(event.target)) return;
    actions.onPreview(material);
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    event.preventDefault();
    actions.onPreview(material);
  };

  return (
    <div
      className={`ws-material-card group ${draggable ? 'cursor-grab active:cursor-grabbing' : 'opacity-60 cursor-not-allowed'}${isDragging ? ' opacity-50 scale-95' : ''}`}
      data-selected={isSelected ? 'true' : undefined}
      data-material-id={material.id}
      tabIndex={0}
      aria-label={material.name}
      draggable={draggable}
      onDragStart={(event) => {
        writeMaterialDragData(event.dataTransfer, material);
        actions.onDragStart(material);
      }}
      onDragEnd={(event) => actions.onDragEnd(material, event.dataTransfer.dropEffect)}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    >
      <div className="ws-material-thumb aspect-video relative">
        <MaterialThumbnail material={material} />
        <MaterialStatusOverlays
          material={material}
          isWaitingAnalysis={props.isWaitingAnalysis}
          onRetryDownload={actions.onRetryDownload}
        />
        {showTypeIcon && typeIcon && (
          <span className="ws-material-type" title={material.type}>
            <MaterialIcon name={typeIcon} size={12} />
          </span>
        )}
        <div className="ws-material-actions">
          {actions.onAddToTimeline && (
            <button
              type="button"
              className="ws-btn ws-btn--primary ws-btn--sm"
              title={m.addToTimeline}
              aria-label={`${m.addToTimeline}: ${material.name}`}
              onClick={(event) => {
                event.stopPropagation();
                actions.onAddToTimeline?.(material);
              }}
            >
              <MaterialIcon name="plus" size={14} />
              {m.add}
            </button>
          )}
          <MaterialMoreMenu
            label={m.more}
            items={menuItems}
            triggerClassName="ws-icon-btn ws-material-more"
          />
        </div>
        {showCacheBadge && (
          <div className="absolute bottom-1 left-1 z-10">
            <MaterialCacheBadge
              material={material}
              hideReady
              onRetry={actions.onRetryDownload ? () => actions.onRetryDownload?.(material) : undefined}
            />
          </div>
        )}
        {material.duration ? (
          <span className="ws-material-duration ws-tabular">
            {formatMaterialDuration(material.duration)}
          </span>
        ) : null}
      </div>
      <div className="ws-material-meta">
        <span className="ws-material-name" title={material.name}>{material.name}</span>
        {usedOrdinal !== null && (
          <span className="ws-chip ws-chip--primary">
            {m.usedInSegment.replace('{index}', String(usedOrdinal))}
          </span>
        )}
      </div>
    </div>
  );
};

export default MaterialCard;
