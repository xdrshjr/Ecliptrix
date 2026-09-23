'use client';

/**
 * AudioMaterialRow — compact 48px row for audio and subtitle materials
 * (spec §3.7.1).
 *
 * The leading 32px button takes over what a click on the old audio card did
 * (play / pause; for subtitles: download). The row itself only selects on
 * click and previews on double click / Enter, like MaterialCard. The mini
 * waveform reuses peaks already sitting in `waveformCache` — it never starts
 * a fetch or a decode, so a long audio library costs nothing extra.
 */

import React from 'react';
import type { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { useEditorFocusStore } from '@/stores/editorFocusStore';
import { waveformCache } from '../../lib/waveform/waveformCache';
import { mapPeaksToColumns } from '../../lib/waveform/drawWaveform';
import MaterialMoreMenu, { type MaterialMenuItem } from './MaterialMoreMenu';
import { MaterialIcon } from './materialIcons';
import {
  formatMaterialDuration,
  isInteractiveTarget,
  isMaterialDraggable,
  useIsMaterialSelected,
  useUsedSegmentOrdinal,
  writeMaterialDragData,
  type MaterialCardActions,
} from './MaterialCard';

export type AudioRowActions = Pick<
  MaterialCardActions,
  'onPreview' | 'onDownload' | 'onDelete' | 'onRetryDownload' | 'onDragStart' | 'onDragEnd'
>;

interface AudioMaterialRowProps {
  material: MaterialItem;
  actions: AudioRowActions;
  isPlaying: boolean;
  /** Existing play/pause handler (audio) — unchanged. */
  onTogglePlay(material: MaterialItem): void;
  /** Existing subtitle download handler — unchanged. */
  onDownloadSubtitle(material: MaterialItem): void;
  isDragging: boolean;
  isDownloading: boolean;
}

const WAVEFORM_COLUMNS = 24;
/** Static silhouette shown until the timeline has cached real peaks. */
const PLACEHOLDER_PEAKS = [
  0.3, 0.5, 0.7, 0.45, 0.6, 0.85, 0.5, 0.35, 0.55, 0.75, 0.4, 0.6,
  0.8, 0.5, 0.3, 0.55, 0.7, 0.45, 0.65, 0.5, 0.35, 0.6, 0.4, 0.3,
];

function cachedPeaks(materialId: string): number[] | null {
  if (waveformCache.status(materialId) !== 'ready') return null;
  const peaks = waveformCache.peaksFor(materialId, {});
  return peaks && peaks.length > 0 ? mapPeaksToColumns(peaks, WAVEFORM_COLUMNS) : null;
}

const MiniWaveform: React.FC<{ materialId: string }> = ({ materialId }) => {
  const peaks = cachedPeaks(materialId);
  const bars = peaks ?? PLACEHOLDER_PEAKS;
  return (
    <svg
      className="ws-audio-wave"
      data-placeholder={peaks ? undefined : 'true'}
      viewBox={`0 0 ${WAVEFORM_COLUMNS * 3} 16`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bars.map((peak, index) => {
        const height = Math.max(1.5, Math.min(1, peak) * 16);
        return (
          <rect key={index} x={index * 3} y={(16 - height) / 2} width={2} height={height} rx={1} />
        );
      })}
    </svg>
  );
};

function useRowMenuItems(props: AudioMaterialRowProps): MaterialMenuItem[] {
  const { t } = useLocale();
  const { material, actions, isDownloading } = props;
  const m = t.workbench.materials;
  const isSubtitle = material.type === 'subtitle';
  // Subtitles download through the same handler, so 「下载字幕」 replaces the
  // generic 「下载」 instead of listing one action twice.
  const downloadLabel = isSubtitle ? m.downloadSubtitle : t.materialsPanel.download;
  return [
    { key: 'preview', label: m.preview, icon: 'eye', onSelect: () => actions.onPreview(material) },
    {
      key: 'download', label: isDownloading ? m.downloading : downloadLabel,
      icon: isDownloading ? 'spinner' : 'download', disabled: isDownloading,
      onSelect: (event) => (isSubtitle
        ? props.onDownloadSubtitle(material)
        : actions.onDownload(material, event)),
    },
    {
      key: 'delete', label: m.deleteMaterial, icon: 'trash', danger: true,
      separatorBefore: true, onSelect: (event) => actions.onDelete(material, event),
    },
  ];
}

const LeadingButton: React.FC<AudioMaterialRowProps> = (props) => {
  const { t } = useLocale();
  const { material, isPlaying } = props;
  const m = t.workbench.materials;
  if (material.type === 'subtitle') {
    return (
      <button
        type="button"
        className="ws-icon-btn ws-audio-lead"
        aria-label={`${m.downloadSubtitle}: ${material.name}`}
        title={m.downloadSubtitle}
        onClick={(event) => {
          event.stopPropagation();
          props.onDownloadSubtitle(material);
        }}
      >
        <MaterialIcon name="fileText" />
      </button>
    );
  }
  const label = isPlaying ? m.pauseAudio : m.playAudio;
  return (
    <button
      type="button"
      className="ws-icon-btn ws-audio-lead"
      aria-label={`${label}: ${material.name}`}
      aria-pressed={isPlaying}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        props.onTogglePlay(material);
      }}
    >
      <MaterialIcon name={isPlaying ? 'pause' : 'play'} />
    </button>
  );
};

const RowStatus: React.FC<{ material: MaterialItem; onRetry?(m: MaterialItem): void }> = ({
  material, onRetry,
}) => {
  const { t } = useLocale();
  const p = t.materialsPanel;
  if (material.downloadStatus === 'error') {
    return (
      <span className="ws-audio-status ws-audio-status--danger" title={material.downloadError}>
        <MaterialIcon name="alert" size={12} />
        {p.downloadFailed}
        {onRetry && (
          <button type="button" className="ws-btn ws-btn--sm ws-btn--ghost" onClick={() => onRetry(material)}>
            {p.retryDownload}
          </button>
        )}
      </span>
    );
  }
  const busyText = material.uploadStatus === 'uploading' ? p.uploadingMaterial
    : material.uploadStatus === 'waiting' ? '等待上传...'
      : material.downloadStatus === 'generating' ? p.generating
        : material.downloadStatus === 'downloading' ? p.downloadingVideo
          : null;
  if (!busyText) return null;
  return (
    <span className="ws-audio-status">
      <MaterialIcon name="spinner" size={12} />
      {busyText}
    </span>
  );
};

const AudioMaterialRow: React.FC<AudioMaterialRowProps> = (props) => {
  const { material, actions, isDragging } = props;
  const { t } = useLocale();
  const m = t.workbench.materials;
  const isSelected = useIsMaterialSelected(material.id);
  const usedOrdinal = useUsedSegmentOrdinal(material);
  const menuItems = useRowMenuItems(props);
  const draggable = isMaterialDraggable(material);

  return (
    <div
      className={`ws-audio-row group${draggable ? ' cursor-grab active:cursor-grabbing' : ' opacity-60 cursor-not-allowed'}${isDragging ? ' opacity-50' : ''}`}
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
      onClick={(event) => {
        if (isInteractiveTarget(event.target)) return;
        useEditorFocusStore.getState().selectMaterial(material.id);
      }}
      onDoubleClick={(event) => {
        if (!isInteractiveTarget(event.target)) actions.onPreview(material);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
        event.preventDefault();
        actions.onPreview(material);
      }}
    >
      <LeadingButton {...props} />
      <div className="ws-audio-body">
        <div className="ws-audio-line">
          <span className="ws-material-name" title={material.name}>{material.name}</span>
          {material.duration ? (
            <span className="ws-audio-duration ws-tabular">
              {formatMaterialDuration(material.duration)}
            </span>
          ) : null}
        </div>
        <div className="ws-audio-line">
          {material.type === 'audio' && <MiniWaveform materialId={material.id} />}
          <RowStatus material={material} onRetry={actions.onRetryDownload} />
          {usedOrdinal !== null && (
            <span className="ws-chip ws-chip--primary">
              {m.usedInSegment.replace('{index}', String(usedOrdinal))}
            </span>
          )}
        </div>
      </div>
      <MaterialMoreMenu label={m.more} items={menuItems} triggerClassName="ws-icon-btn ws-material-more" />
    </div>
  );
};

export default AudioMaterialRow;
