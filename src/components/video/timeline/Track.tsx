'use client';

import React, { useRef, useState } from 'react';
import { getTranslations, defaultLocale, type SupportedLocale } from '@/lib/i18n';
import {
  useTimelineStore,
  removeTrackAction,
  toggleTrackLockAction,
  toggleTrackMuteAction,
  toggleTrackVisibilityAction,
  renameTrackAction,
} from './store';
import type { MissingMaterialPredicate } from './lib/missingMaterial';
import type { TrackData } from './domain/types';
import type { MaterialItem } from '@/types';
import TimelineItem, { type LocalProxyMaskState } from './TimelineItem';
import VolumeSlider from './VolumeSlider';
import PortalTooltip from './PortalTooltip';
import { useNotification } from '@/contexts/NotificationContext';
import { deriveTrackDisplayName } from './trackDisplayName';
import { pickTickIntervals } from './lib/rulerTicks';
import { buildGridBackground } from './lib/timelineGrid';
import { readDraggedMaterialType } from './lib/materialDragTypes';
import { isTrackCompatibleWithMaterial } from './lib/trackForMaterial';
import { CLIP } from './theme/timelineTheme';
import TrackNameEditor from './TrackNameEditor';
import EmptyTrackStrip from './EmptyTrackStrip';
import DropHintBadge from './DropHintBadge';
import { describeDropHint } from './lib/dropHint';
import { useEmptyTrackExpansion } from './hooks/useEmptyTrackExpansion';

/** Height of a folded empty image / subtitle lane (spec R2 §3.10). */
const COLLAPSED_TRACK_HEIGHT = 20;

/**
 * Material id + type from the materials panel's JSON drag payload, or null for
 * any other drag source (files, text, a clip from another app).
 */
function readDroppedMaterial(raw: string): { id: string; type: MaterialItem['type'] } | null {
  if (!raw) return null;
  try {
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== 'object') return null;
    const { type, material } = payload as { type?: unknown; material?: { id?: unknown; type?: unknown } };
    if (type !== 'material' || !material || typeof material.id !== 'string') return null;
    return { id: material.id, type: material.type as MaterialItem['type'] };
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[Track] drop-data parse failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Props — only data that cannot be read from the store
// ---------------------------------------------------------------------------

interface TrackProps {
  trackId: string;
  pixelsPerSecond: number;
  locale?: SupportedLocale;
  trackHeight?: number;
  /** External edit-subtitles callback (still owned by parent) */
  onEditSubtitles?: (trackId: string) => void;
  /** Round-2 local-download status by materialId (passed down to items). */
  localProxyStatusMap?: Map<string, LocalProxyMaskState>;
  localPreviewEnabled?: boolean;
  onRetryLocalDownload?: (materialId: string) => void;
  /** Open the camera-motion panel for a clip (camera-motion-2d-3d §4.5.1). */
  onOpenCameraMotion?: (itemId: string) => void;
  /**
   * A material from the materials panel was dropped here. The panel resolves
   * the id against the library so a drop builds the same clip as "add to
   * timeline" (playback urls, storage key, sentence segments included).
   */
  onMaterialDrop: (materialId: string, trackId: string) => void;
  /** Whether a clip's material is gone; omitted until the library has loaded (N-01). */
  isMaterialMissing?: MissingMaterialPredicate;
  /** Scopes the remembered open/folded state of empty lanes. */
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Track: React.FC<TrackProps> = ({
  trackId,
  pixelsPerSecond,
  locale = defaultLocale,
  trackHeight = 32,
  onEditSubtitles,
  localProxyStatusMap,
  localPreviewEnabled,
  onRetryLocalDownload,
  onOpenCameraMotion,
  onMaterialDrop,
  isMaterialMissing,
  projectId,
}) => {
  const volumeButtonRef = useRef<HTMLButtonElement>(null);
  const [isRenaming, setIsRenaming] = useState(false);

  // ---------------------------------------------------------------------------
  // Store reads
  // ---------------------------------------------------------------------------

  const track = useTimelineStore(s => s.tracks.find(t => t.id === trackId)) as TrackData | undefined;
  const selectedItems = useTimelineStore(s => s.selectedItems);
  const materialDragOver = useTimelineStore(s => s.materialDragOver);
  const showVolumeSlider = useTimelineStore(s => s.showVolumeSlider);
  const dragPreview = useTimelineStore(s => s.dragPreview);

  // Store actions
  const selectAllTrackItems = useTimelineStore(s => s.selectAllTrackItems);
  const setMaterialDragOver = useTimelineStore(s => s.setMaterialDragOver);
  const clearMaterialDragOver = useTimelineStore(s => s.clearMaterialDragOver);
  const showVolumeSliderForTrack = useTimelineStore(s => s.showVolumeSliderForTrack);
  const hideVolumeSlider = useTimelineStore(s => s.hideVolumeSlider);
  const emptyLane = useEmptyTrackExpansion(projectId, track);

  // i18n
  const t = getTranslations(locale);

  // Notification API (toast-based confirm / warning)
  const { showWarning, showConfirm } = useNotification();

  // Guard: track not found
  if (!track) return null;

  // Derived display name — shared with useTimelineExport so exported JSON
  // matches what is shown in the UI (see ./trackDisplayName).
  const trackDisplayName = deriveTrackDisplayName(track, t.timeline.track);

  // Derived
  // A material hovering this lane; `isCompatible` already folds in the lock.
  const dragOver = materialDragOver?.trackId === trackId ? materialDragOver : null;
  const isDropAccepted = dragOver?.isCompatible === true;
  const allItemsSelected = track.items.length > 0 && track.items.every(item => selectedItems.includes(item.id));
  const volumeSliderOpen = showVolumeSlider?.trackId === trackId;
  const volumePopoverId = `volume-popover-${track.id}`;
  const tools = t.workbench.timelineTools;
  const laneHeight = emptyLane.isCollapsed ? COLLAPSED_TRACK_HEIGHT : trackHeight;
  // The badge reuses the lane's own verdict, so it never disagrees with the drop.
  const dropHint = dragOver && describeDropHint({
    track, materialType: dragOver.materialType, isCompatible: dragOver.isCompatible,
    copy: tools, typeLabels: t.materialsPanel,
  });

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers (material panel -> track)
  // ---------------------------------------------------------------------------

  // dragenter / dragover can read DataTransfer.types but getData() is empty
  // until drop, so the material type travels as a MIME type. Only an accepted
  // drag calls preventDefault — otherwise the browser shows "no drop" and the
  // drop event never fires, while the lane explains why.
  const evaluateMaterialDrag = (e: React.DragEvent) => {
    const materialType = readDraggedMaterialType(Array.from(e.dataTransfer.types));
    if (materialType === null) return;
    const accepts = !track.isLocked && isTrackCompatibleWithMaterial(track, materialType);
    if (accepts) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'none';
    }
    // dragover repeats every few ms; only write the store when the state changes.
    const current = useTimelineStore.getState().materialDragOver;
    if (current?.trackId !== trackId || current.isCompatible !== accepts || current.materialType !== materialType) {
      setMaterialDragOver(trackId, materialType, accepts);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // dragleave also fires when the pointer moves onto a clip inside this lane,
    // and the next lane's dragenter arrives before this dragleave.
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    if (useTimelineStore.getState().materialDragOver?.trackId === trackId) {
      clearMaterialDragOver();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    clearMaterialDragOver();
    const dropped = readDroppedMaterial(e.dataTransfer.getData('application/json'));
    if (!dropped) return;
    if (track.isLocked) {
      showWarning(t.timeline.track.trackLocked);
      return;
    }
    if (!isTrackCompatibleWithMaterial(track, dropped.type)) {
      showWarning(t.timeline.messages.incompatibleTrack);
      return;
    }
    onMaterialDrop(dropped.id, trackId);
  };

  // ---------------------------------------------------------------------------
  // Track control handlers
  // ---------------------------------------------------------------------------

  const handleVolumeClick = () => {
    if (track.isLocked) return;
    if (volumeSliderOpen) {
      hideVolumeSlider();
    } else if (volumeButtonRef.current) {
      const rect = volumeButtonRef.current.getBoundingClientRect();
      showVolumeSliderForTrack(trackId, {
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      });
    }
  };

  const handleLockClick = () => {
    toggleTrackLockAction(() => useTimelineStore.getState(), trackId);
  };

  const handleMuteClick = () => {
    if (track.isLocked) return;
    toggleTrackMuteAction(() => useTimelineStore.getState(), trackId);
  };

  const handleVisibilityClick = () => {
    if (track.isLocked) return;
    toggleTrackVisibilityAction(() => useTimelineStore.getState(), trackId);
  };

  const handleRenameCommit = (name: string) => {
    setIsRenaming(false);
    renameTrackAction(() => useTimelineStore.getState(), trackId, name);
  };

  const handleSelectAllClick = () => {
    if (track.items.length === 0) return;
    if (track.isLocked) return;
    selectAllTrackItems(trackId);
  };

  const handleRemoveTrackClick = () => {
    if (track.isLocked) return;

    const doRemove = () => {
      const result = removeTrackAction(() => useTimelineStore.getState(), track.id);
      if (result.ok) return;
      // The agent can take the timeline while the removal confirmation is open.
      if (result.reason === 'EDIT_LOCKED') {
        showWarning(t.timeline.messages.editLockedByAgent);
        return;
      }
      if (result.reason === 'LAST_TRACK') {
        showWarning(t.timeline.track.removeTrackLast);
        return;
      }
      if (result.reason === 'LAST_OF_GROUP') {
        const groupLabel =
          result.group === 'image' ? t.timeline.track.imageTrack :
          result.group === 'video' ? t.timeline.track.videoTrack :
          result.group === 'audio' ? t.timeline.track.audioTrack :
          t.timeline.track.subtitleTrack;
        showWarning(
          t.timeline.track.removeTrackLastOfGroup.replace('{group}', groupLabel),
        );
      }
    };

    if (track.items.length > 0) {
      showConfirm(t.timeline.track.removeTrackConfirm, doRemove);
    } else {
      doRemove();
    }
  };

  // ---------------------------------------------------------------------------
  // Track icon and color helpers — preserve exact original rendering
  // ---------------------------------------------------------------------------

  const getTrackIcon = () => {
    if (track.type === 'video' && track.id.startsWith('image-track')) {
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
        </svg>
      );
    }

    switch (track.type) {
      case 'video':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17 10.5V7a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        );
      case 'audio':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
          </svg>
        );
      case 'subtitle':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
          </svg>
        );
      default:
        return null;
    }
  };

  const getTrackColor = () => {
    if (track.type === 'video' && track.id.startsWith('image-track')) {
      return 'text-purple-600';
    }

    switch (track.type) {
      case 'video':
        return 'text-blue-600';
      case 'audio':
        return 'text-green-600';
      case 'subtitle':
        return 'text-amber-600';
      default:
        return 'text-muted-foreground';
    }
  };

  // Per-type accent (token color) for the track-header left strip — the DaVinci
  // cue that ties a header to its lane content color.
  const getTrackAccent = (): string => {
    if (track.type === 'video' && track.id.startsWith('image-track')) {
      return CLIP.accentImage;
    }
    switch (track.type) {
      case 'video':
        return CLIP.accentVideo;
      case 'audio':
        return CLIP.accentAudio;
      case 'subtitle':
        return CLIP.accentSubtitle;
      default:
        return 'transparent';
    }
  };

  // Shared interval picker — identical to the ruler's, so the lane grid lines
  // coincide with the ruler ticks at every zoom/scroll offset.
  const gridIntervals = pickTickIntervals(pixelsPerSecond);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="track flex border-b border-border last:border-b-0"
      data-track-id={track.id}
      style={{ minWidth: '100%' }}
    >
      {/* Track controls panel — left accent strip cues the per-type color. */}
      {/* Sticky so names and controls stay in view on a scrolled timeline
          (UI3-10). Opaque and above clips (z ≤ 10); a hidden track dims the
          contents, never the background, or clips would show through. */}
      <div
        className={`track-controls sticky left-0 z-20 w-56 bg-muted border-r border-border`}
        style={{ boxShadow: `inset 3px 0 0 0 ${getTrackAccent()}` }}
      >
        <div
          className={`flex items-center justify-between transition-opacity ${
            emptyLane.isCollapsed ? 'px-2 py-0' : 'p-2'
          } ${track.isVisible ? '' : 'opacity-60'}`}
          style={{ height: laneHeight }}
        >
          {/* Left: icon + name */}
          <div className="flex items-center space-x-1.5 flex-1 min-w-0">
            <div className={`${getTrackColor()}`}>
              {getTrackIcon()}
            </div>
            {isRenaming ? (
              <TrackNameEditor
                initialName={trackDisplayName}
                ariaLabel={tools.renameLabel}
                onCommit={handleRenameCommit}
                onCancel={() => setIsRenaming(false)}
              />
            ) : (
              <span
                className="text-xs font-medium text-foreground truncate"
                title={`${trackDisplayName} · ${tools.renameHint}`}
                data-testid={`track-name-${track.id}`}
                onDoubleClick={() => setIsRenaming(true)}
              >
                {trackDisplayName}
              </span>
            )}
          </div>

          {/* Right: control buttons — tightened gap (space-x-0.5) so the widened
              header still leaves the track name enough room without exceeding
              the "not too long" budget (see analysis 缺陷 1 / 1A). */}
          {/* A folded lane is 20px: its buttons return once it is opened. */}
          {!emptyLane.isCollapsed && <div className="flex items-center space-x-0.5">
            {/* Volume button (audio + video tracks) */}
            {(track.type === 'audio' || (track.type === 'video' && !track.id.startsWith('image-track'))) && (() => {
              const volumeBase = track.isLocked
                ? `${t.timeline.toolbar.volumeControl} - ${trackDisplayName} - ${t.timeline.track.trackLocked}`
                : `${t.timeline.toolbar.volumeControl} - ${trackDisplayName} (${track.volume}%)`;
              return (
              <PortalTooltip className="relative" label={volumeBase}>
                <button
                  ref={volumeButtonRef}
                  onClick={handleVolumeClick}
                  disabled={track.isLocked}
                  className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] ${
                    track.isLocked
                      ? 'bg-muted text-muted-foreground opacity-50 cursor-not-allowed'
                      : volumeSliderOpen
                        ? 'bg-accent text-muted-foreground hover:bg-accent'
                        : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                  aria-label={volumeBase}
                  aria-haspopup="dialog"
                  aria-expanded={volumeSliderOpen}
                  aria-controls={volumePopoverId}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    {track.volume === 0 ? (
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                    ) : track.volume < 50 ? (
                      <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                    ) : track.volume < 100 ? (
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                    ) : (
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    )}
                  </svg>
                </button>
              </PortalTooltip>
              );
            })()}

            {/* Volume slider popover — positioned from the store and portalled
                into <body>. It stays outside the button's PortalTooltip: React
                bubbles the popover's focus and hover through the component
                tree, which kept re-opening that tooltip while adjusting. */}
            {volumeSliderOpen && <VolumeSlider />}

            {/* Edit subtitles button (subtitle track only) */}
            {track.type === 'subtitle' && (
              <PortalTooltip
                className="relative"
                label={
                  track.items.length === 0
                    ? t.timeline.track.editSubtitlesHint
                    : track.isLocked
                      ? t.timeline.track.trackLocked
                      : t.timeline.track.editSubtitles
                }
              >
                <button
                  onClick={() => {
                    if (onEditSubtitles) {
                      onEditSubtitles(track.id);
                    }
                  }}
                  disabled={track.items.length === 0 || track.isLocked}
                  aria-label={
                    track.items.length === 0 ? `${t.timeline.track.editSubtitles} - ${trackDisplayName} — ${t.timeline.track.editSubtitlesHint}` :
                    track.isLocked ? `${t.timeline.track.editSubtitles} - ${trackDisplayName} — ${t.timeline.track.trackLocked}` :
                    `${t.timeline.track.editSubtitles} - ${trackDisplayName}`
                  }
                  className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] ${
                    (track.items.length === 0 || track.isLocked)
                      ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                      : 'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/30'
                  }`}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
              </PortalTooltip>
            )}

            {/* Select all button */}
            <PortalTooltip
              className="relative"
              label={
                track.items.length === 0
                  ? t.timeline.track.selectAllEmptyHint
                  : track.isLocked
                    ? `${t.timeline.track.selectAll} — ${t.timeline.track.trackLocked}`
                    : t.timeline.track.selectAll
              }
            >
              <button
                onClick={handleSelectAllClick}
                disabled={track.items.length === 0 || track.isLocked}
                className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] ${
                  (track.items.length === 0 || track.isLocked)
                    ? 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground'
                    : allItemsSelected
                      ? 'bg-primary-a/10 text-primary hover:bg-primary-a/20'
                      : 'bg-muted text-muted-foreground hover:bg-primary-a/10 hover:text-primary'
                }`}
                aria-label={
                  track.items.length === 0
                    ? `${t.timeline.track.selectAll} - ${trackDisplayName} — ${t.timeline.track.selectAllEmptyHint}`
                    : track.isLocked
                      ? `${t.timeline.track.selectAll} - ${trackDisplayName} — ${t.timeline.track.trackLocked}`
                      : `${t.timeline.track.selectAll} - ${trackDisplayName}`
                }
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 5H1v16c0 1.1.9 2 2 2h16v-2H3V5zm18-4H7c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 16H7V3h14v14zm-10-7l1.41 1.41L16 8.83 20.59 13.41 22 12l-6-6-4 4z"/>
                </svg>
              </button>
            </PortalTooltip>

            {/* Mute button (audio tracks) — a monitoring switch, so it records
                no undo entry (ME-12). "M" as in an NLE track header, so it
                never reads as the volume button next to it. Video tracks get
                none: preview and export ignore isMuted on them, so the button
                would promise silence and still play the embedded audio. */}
            {track.type === 'audio' && (() => {
              const muteBase = `${track.isMuted ? t.timeline.track.unmute : t.timeline.track.mute} - ${trackDisplayName}`;
              const muteLabel = track.isLocked ? `${muteBase} — ${t.timeline.track.trackLocked}` : muteBase;
              return (
                <PortalTooltip className="relative" label={muteLabel}>
                  <button
                    type="button"
                    onClick={handleMuteClick}
                    disabled={track.isLocked}
                    aria-pressed={track.isMuted}
                    aria-label={muteLabel}
                    data-testid={`track-mute-${track.id}`}
                    className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] text-[10px] font-bold leading-none ${
                      track.isLocked
                        ? 'bg-muted text-muted-foreground opacity-50 cursor-not-allowed'
                        : track.isMuted
                          ? 'bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-500/30'
                          : 'bg-muted text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    <span aria-hidden="true">M</span>
                  </button>
                </PortalTooltip>
              );
            })()}

            {/* Lock button */}
            <PortalTooltip
              className="relative"
              label={track.isLocked ? t.timeline.track.unlock : t.timeline.track.lock}
            >
              <button
                onClick={handleLockClick}
                className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] ${
                  track.isLocked
                    ? 'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-500/30'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
                aria-label={`${track.isLocked ? t.timeline.track.unlock : t.timeline.track.lock} - ${trackDisplayName}`}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  {track.isLocked ? (
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/>
                  ) : (
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/>
                  )}
                </svg>
              </button>
            </PortalTooltip>

            {/* Visibility button */}
            <PortalTooltip
              className="relative"
              label={
                track.isLocked
                  ? `${track.isVisible ? t.timeline.track.hide : t.timeline.track.show} — ${t.timeline.track.trackLocked}`
                  : (track.isVisible ? t.timeline.track.hide : t.timeline.track.show)
              }
            >
              <button
                onClick={handleVisibilityClick}
                disabled={track.isLocked}
                aria-label={
                  track.isLocked
                    ? `${track.isVisible ? t.timeline.track.hide : t.timeline.track.show} - ${trackDisplayName} — ${t.timeline.track.trackLocked}`
                    : `${track.isVisible ? t.timeline.track.hide : t.timeline.track.show} - ${trackDisplayName}`
                }
                className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] ${
                  track.isLocked
                    ? 'opacity-50 cursor-not-allowed'
                    : track.isVisible
                      ? 'bg-muted text-muted-foreground hover:bg-accent'
                      : 'bg-accent text-muted-foreground hover:bg-accent-a/80'
                }`}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  {track.isVisible ? (
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                  ) : (
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                  )}
                </svg>
              </button>
            </PortalTooltip>

            {/* Delete track button */}
            <PortalTooltip
              className="relative"
              label={
                track.isLocked
                  ? `${t.timeline.track.removeTrack} — ${t.timeline.track.trackLocked}`
                  : t.timeline.track.removeTrack
              }
            >
              <button
                onClick={handleRemoveTrackClick}
                disabled={track.isLocked}
                aria-label={track.isLocked
                  ? `${t.timeline.track.removeTrack} - ${trackDisplayName} — ${t.timeline.track.trackLocked}`
                  : `${t.timeline.track.removeTrack} - ${trackDisplayName}`}
                className={`p-1 rounded transition-colors flex items-center justify-center w-[22px] h-[22px] ${
                  track.isLocked
                    ? 'opacity-50 cursor-not-allowed'
                    : 'bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-600'
                }`}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>
              </button>
            </PortalTooltip>
          </div>}
        </div>
      </div>

      {/* Track content area */}
      <div
        className={`track-content flex-1 relative ${
          isDropAccepted
            ? 'bg-primary-a/10 border-2 border-primary border-dashed'
            : dragOver
              ? 'bg-card border-2 border-border border-dashed cursor-not-allowed'
              : 'bg-card'
        }`}
        // Locked lanes keep pointer events: their clips stay selectable and
        // show the lock tooltip / not-allowed cursor; edits are refused per item.
        style={{
          // Hidden reads dimmest; a muted audio lane is dimmed too, so it is
          // visible at a glance which lanes will not be heard (ME-12).
          opacity: !track.isVisible ? 0.3 : track.type === 'audio' && track.isMuted ? 0.6 : 1,
          height: laneHeight,
        }}
        onDragEnter={evaluateMaterialDrag}
        onDragOver={evaluateMaterialDrag}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Background grid — shared zero-DOM two-tier builder fed the SAME
            intervals as the ruler, so the (now subtle) lines coincide with the
            ruler ticks instead of painting a hard line every second. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={buildGridBackground(pixelsPerSecond, gridIntervals)}
        />

        {emptyLane.isCollapsed && (
          <EmptyTrackStrip
            label={track.id.startsWith('image-track') ? tools.addImage : tools.addSubtitle}
            title={tools.expandEmpty}
            onExpand={emptyLane.expand}
          />
        )}
        {dropHint && <DropHintBadge hint={dropHint} />}

        {/* Render all items on this track */}
        {track.items.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            pixelsPerSecond={pixelsPerSecond}
            trackHeight={trackHeight}
            localProxyStatusMap={localProxyStatusMap}
            localPreviewEnabled={localPreviewEnabled}
            onRetryLocalDownload={onRetryLocalDownload}
            onOpenCameraMotion={onOpenCameraMotion}
            isMaterialMissing={isMaterialMissing?.(item) ?? false}
          />
        ))}

        {/* Empty track placeholder */}
        {track.items.length === 0 && !emptyLane.isCollapsed && (
          <div className={`absolute inset-0 flex items-center justify-center text-muted-foreground text-xs pointer-events-none ${
            isDropAccepted ? 'text-primary' : ''
          } ${track.isLocked ? 'opacity-50' : ''}`}>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3">
                {getTrackIcon()}
              </div>
              <span>
                {track.isLocked
                  ? t.timeline.track.trackLocked
                  : track.id.startsWith('image-track') ? t.timeline.track.dropImageHere :
                    track.type === 'video' ? t.timeline.track.dropVideoHere :
                    track.type === 'audio' ? t.timeline.track.dropAudioHere :
                    t.timeline.track.dropSubtitleHere}
              </span>
            </div>
          </div>
        )}

        {/* Drag-over overlay: where it lands, or why it can't */}
        {isDropAccepted && !emptyLane.isCollapsed && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary-a/10 pointer-events-none">
            <div className="bg-primary text-primary-foreground px-2 py-1 rounded">
              <div className="flex items-center space-x-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span className="text-xs">{t.timeline.track.dropToTrack.replace('{trackName}', trackDisplayName)}</span>
              </div>
            </div>
          </div>
        )}
        {dragOver && !isDropAccepted && !emptyLane.isCollapsed && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-card text-muted-foreground border border-border px-2 py-1 rounded shadow-sm">
              <div className="flex items-center space-x-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-12.728 12.728M12 21a9 9 0 110-18 9 9 0 010 18z" />
                </svg>
                <span className="text-xs">
                  {track.isLocked ? t.timeline.track.trackLocked : t.timeline.messages.incompatibleTrack}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Track;
