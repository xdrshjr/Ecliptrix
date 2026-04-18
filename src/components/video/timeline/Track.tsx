'use client';

import React, { useRef } from 'react';
import { getTranslations, defaultLocale, type SupportedLocale } from '@/lib/i18n';
import { useTimelineStore, removeTrackAction } from './store';
import { TrackTypeUtils } from './domain';
import type { TrackData } from './domain/types';
import type { MaterialItem } from '@/types';
import TimelineItem from './TimelineItem';
import VolumeSlider from './VolumeSlider';
import { useNotification } from '@/contexts/NotificationContext';

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
}) => {
  const volumeButtonRef = useRef<HTMLButtonElement>(null);

  // ---------------------------------------------------------------------------
  // Store reads
  // ---------------------------------------------------------------------------

  const track = useTimelineStore(s => s.tracks.find(t => t.id === trackId)) as TrackData | undefined;
  const selectedItems = useTimelineStore(s => s.selectedItems);
  const materialDragOver = useTimelineStore(s => s.materialDragOver);
  const showVolumeSlider = useTimelineStore(s => s.showVolumeSlider);
  const dragPreview = useTimelineStore(s => s.dragPreview);

  // Store actions
  const toggleTrackLock = useTimelineStore(s => s.toggleTrackLock);
  const toggleTrackVisibility = useTimelineStore(s => s.toggleTrackVisibility);
  const selectAllTrackItems = useTimelineStore(s => s.selectAllTrackItems);
  const setMaterialDragOver = useTimelineStore(s => s.setMaterialDragOver);
  const clearMaterialDragOver = useTimelineStore(s => s.clearMaterialDragOver);
  const dropMaterial = useTimelineStore(s => s.dropMaterial);
  const showVolumeSliderForTrack = useTimelineStore(s => s.showVolumeSliderForTrack);
  const hideVolumeSlider = useTimelineStore(s => s.hideVolumeSlider);

  // i18n
  const t = getTranslations(locale);

  // Notification API (toast-based confirm / warning)
  const { showWarning, showConfirm } = useNotification();

  // Guard: track not found
  if (!track) return null;

  // Derived display name.
  // Prefer user-provided track.name if non-empty (honors renames); fall back to
  // locale-aware derivation from id for legacy data that stored empty names.
  const trackDisplayName = (() => {
    if (track.name && track.name.trim().length > 0) return track.name;
    const id = track.id;
    const match = id.match(/-(\d+)$/);
    const num = match ? parseInt(match[1]) : 0;
    if (id.startsWith('image-track')) return num > 0 ? `${t.timeline.track.imageTrack} ${num}` : t.timeline.track.imageTrack;
    if (id.startsWith('video-track')) return num > 0 ? `${t.timeline.track.videoTrack} ${num}` : t.timeline.track.videoTrack;
    if (id.startsWith('audio-track')) return num > 0 ? `${t.timeline.track.audioTrack} ${num}` : t.timeline.track.audioTrack;
    if (id.startsWith('subtitle-track')) return num > 0 ? `${t.timeline.track.subtitleTrack} ${num}` : t.timeline.track.subtitleTrack;
    return track.name;
  })();

  // Derived
  const isDragOver = materialDragOver?.trackId === trackId;
  const allItemsSelected = track.items.length > 0 && track.items.every(item => selectedItems.includes(item.id));
  const volumeSliderOpen = showVolumeSlider?.trackId === trackId;

  // ---------------------------------------------------------------------------
  // Drag-and-drop handlers (material panel -> track)
  // ---------------------------------------------------------------------------

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    if (track.isLocked) return;

    try {
      const data = e.dataTransfer.getData('application/json');
      if (data) {
        const dragData = JSON.parse(data);
        if (dragData.type === 'material' && dragData.material) {
          const isCompatible = TrackTypeUtils.canAcceptMaterial(track.type, dragData.material.type, track.id);
          if (isCompatible) {
            setMaterialDragOver(trackId, dragData.material.type, true);
          }
        }
      }
    } catch {
      // Ignore parse errors from other drag sources
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (track.isLocked) return;
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    clearMaterialDragOver();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    clearMaterialDragOver();

    if (track.isLocked) return;

    try {
      const data = e.dataTransfer.getData('application/json');
      if (!data) return;

      const dragData = JSON.parse(data);
      if (dragData.type === 'material' && dragData.material) {
        const material = dragData.material as MaterialItem;
        if (!TrackTypeUtils.canAcceptMaterial(track.type, material.type, track.id)) return;

        dropMaterial(trackId, {
          id: material.id,
          name: material.name,
          type: material.type as 'video' | 'audio' | 'subtitle',
          duration: material.duration || 5,
          url: material.url,
          thumbnailUrl: material.thumbnailUrl,
        });
      }
    } catch (error) {
      console.error('[Track] 拖拽数据解析失败:', error);
    }
  };

  // ---------------------------------------------------------------------------
  // Track control handlers
  // ---------------------------------------------------------------------------

  const handleVolumeClick = () => {
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
    toggleTrackLock(trackId);
  };

  const handleVisibilityClick = () => {
    toggleTrackVisibility(trackId);
  };

  const handleSelectAllClick = () => {
    if (track.items.length === 0) return;
    selectAllTrackItems(trackId);
  };

  const handleRemoveTrackClick = () => {
    if (track.isLocked) return;

    const doRemove = () => {
      const result = removeTrackAction(() => useTimelineStore.getState(), track.id);
      if (result.ok) return;
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

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="track flex border-b border-border last:border-b-0"
      data-track-id={track.id}
      style={{ minWidth: '100%' }}
    >
      {/* Track controls panel */}
      <div className="track-controls w-48 bg-muted border-r border-border">
        <div
          className="flex items-center justify-between p-2"
          style={{ height: trackHeight }}
        >
          {/* Left: icon + name */}
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            <div className={`${getTrackColor()}`}>
              {getTrackIcon()}
            </div>
            <span className="text-xs font-medium text-foreground truncate" title={trackDisplayName}>
              {trackDisplayName}
            </span>
          </div>

          {/* Right: control buttons */}
          <div className="flex items-center space-x-1">
            {/* Volume button (audio + video tracks) */}
            {(track.type === 'audio' || (track.type === 'video' && !track.id.startsWith('image-track'))) && (
              <div className="relative group">
                <button
                  ref={volumeButtonRef}
                  onClick={handleVolumeClick}
                  className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                    volumeSliderOpen
                      ? 'bg-accent text-muted-foreground hover:bg-accent'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                  aria-label={`${t.timeline.toolbar.volumeControl} - ${trackDisplayName}`}
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

                  {/* Hover tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                    <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                      {t.timeline.toolbar.trackVolumeControl
                        .replace('{type}', track.type === 'video' ? t.timeline.track.videoTrack : t.timeline.track.audioTrack)
                        .replace('{volume}', String(track.volume))}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                        <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                      </div>
                    </div>
                  </div>
                </button>

                {/* Volume slider popover — rendered once globally, controlled by store */}
                {volumeSliderOpen && <VolumeSlider />}
              </div>
            )}

            {/* Edit subtitles button (subtitle track only) */}
            {track.type === 'subtitle' && (
              <div className="relative group">
                <button
                  onClick={() => {
                    if (onEditSubtitles) {
                      onEditSubtitles(track.id);
                    }
                  }}
                  disabled={track.items.length === 0}
                  title={track.items.length === 0
                    ? t.timeline.track.editSubtitlesHint
                    : t.timeline.track.editSubtitles}
                  aria-label={track.items.length === 0
                    ? t.timeline.track.editSubtitlesHint
                    : t.timeline.track.editSubtitles}
                  className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                    track.items.length === 0
                      ? 'bg-muted text-muted-foreground cursor-not-allowed opacity-50'
                      : 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                  }`}
                >
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>

                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                    <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                      {track.items.length === 0
                        ? t.timeline.track.editSubtitlesHint
                        : t.timeline.track.editSubtitles}
                      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                        <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* Select all button */}
            <div className="relative group">
              <button
                onClick={handleSelectAllClick}
                disabled={track.items.length === 0}
                title={track.items.length === 0
                  ? t.timeline.track.selectAllEmptyHint
                  : t.timeline.track.selectAll}
                className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                  track.items.length === 0
                    ? 'opacity-50 cursor-not-allowed bg-muted text-muted-foreground'
                    : allItemsSelected
                      ? 'bg-primary/10 text-primary hover:bg-primary/20'
                      : 'bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary'
                }`}
                aria-label={track.items.length === 0
                  ? t.timeline.track.selectAllEmptyHint
                  : t.timeline.track.selectAll}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 5H1v16c0 1.1.9 2 2 2h16v-2H3V5zm18-4H7c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V3c0-1.1-.9-2-2-2zm0 16H7V3h14v14zm-10-7l1.41 1.41L16 8.83 20.59 13.41 22 12l-6-6-4 4z"/>
                </svg>

                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {t.timeline.track.selectAll}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* Lock button */}
            <div className="relative group">
              <button
                onClick={handleLockClick}
                className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                  track.isLocked
                    ? 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'
                    : 'bg-muted text-muted-foreground hover:bg-accent'
                }`}
                aria-label={track.isLocked ? t.timeline.track.unlock : t.timeline.track.lock}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  {track.isLocked ? (
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6z"/>
                  ) : (
                    <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/>
                  )}
                </svg>

                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {track.isLocked ? t.timeline.track.unlock : t.timeline.track.lock}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* Visibility button */}
            <div className="relative group">
              <button
                onClick={handleVisibilityClick}
                className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                  track.isVisible
                    ? 'bg-muted text-muted-foreground hover:bg-accent'
                    : 'bg-accent text-muted-foreground hover:bg-accent'
                }`}
                aria-label={track.isVisible ? t.timeline.track.hide : t.timeline.track.show}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  {track.isVisible ? (
                    <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                  ) : (
                    <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                  )}
                </svg>

                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {track.isVisible ? t.timeline.track.hide : t.timeline.track.show}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>

            {/* Delete track button */}
            <div className="relative group">
              <button
                onClick={handleRemoveTrackClick}
                disabled={track.isLocked}
                aria-label={t.timeline.track.removeTrack}
                className={`p-1 rounded transition-colors w-5 h-5 flex items-center justify-center ${
                  track.isLocked
                    ? 'opacity-50 cursor-not-allowed'
                    : 'bg-muted text-muted-foreground hover:bg-red-100 hover:text-red-600'
                }`}
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                </svg>

                <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 z-[9999] pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                  <div className="bg-background text-foreground text-xs px-2 py-1 rounded-md whitespace-nowrap border border-border">
                    {t.timeline.track.removeTrack}
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                      <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Track content area */}
      <div
        className={`track-content flex-1 relative ${
          isDragOver ? 'bg-primary/10 border-2 border-primary border-dashed' : 'bg-card'
        }`}
        style={{
          opacity: track.isVisible ? 1 : 0.3,
          pointerEvents: track.isLocked ? 'none' : 'auto',
          height: trackHeight,
        }}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Background grid */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `repeating-linear-gradient(to right, var(--border) 0px, var(--border) 1px, transparent 1px, transparent ${pixelsPerSecond}px)`,
            backgroundSize: `${pixelsPerSecond}px 100%`,
          }}
        />

        {/* Render all items on this track */}
        {track.items.map((item) => (
          <TimelineItem
            key={item.id}
            item={item}
            pixelsPerSecond={pixelsPerSecond}
            trackHeight={trackHeight}
          />
        ))}

        {/* Empty track placeholder */}
        {track.items.length === 0 && (
          <div className={`absolute inset-0 flex items-center justify-center text-muted-foreground text-xs pointer-events-none ${
            isDragOver ? 'text-primary' : ''
          }`}>
            <div className="flex items-center space-x-1">
              <div className="w-3 h-3">
                {getTrackIcon()}
              </div>
              <span>
                {track.type === 'video' ? t.timeline.track.dropVideoHere :
                 track.type === 'audio' ? t.timeline.track.dropAudioHere :
                 t.timeline.track.dropSubtitleHere}
              </span>
            </div>
          </div>
        )}

        {/* Drag-over overlay */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10 bg-opacity-90 pointer-events-none">
            <div className="bg-primary text-primary-foreground px-2 py-1 rounded">
              <div className="flex items-center space-x-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span className="text-xs">{t.timeline.track.dropToTrack.replace('{trackName}', trackDisplayName)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Track;
