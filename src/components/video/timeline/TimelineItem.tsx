'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useTimelineStore, splitAction } from './store';
import type { TimelineItemData } from './domain/types';
import type { LocalProxyStatus } from '@/types';
import SentenceSegmentBar from './SentenceSegmentBar';
import AudioWaveformCanvas from './AudioWaveformCanvas';
import { formatTimelineTime } from './timeFormat';
import { ZoomLevel } from './domain/value-objects/ZoomLevel';
import {
  FilmstripCache,
  type FilmstripItem,
  type FilmstripSlot,
} from '../lib/filmstrip/filmstripCache';
import { selectPlaybackUrl } from '../lib/selectPlaybackUrl';

// ---------------------------------------------------------------------------
// Filmstrip: one process-wide cache so frames resolved for a clip persist
// across re-renders / scroll / re-zoom to the same tier (spec 03 §2.3 hit
// reuse). Defaults mirror the backend ThumbnailConfig filmstrip params.
// ---------------------------------------------------------------------------

const filmstripCache = new FilmstripCache({ slotPx: 80, maxFrames: 24, quality: 0.7 });

// Throttle window (ms) between filmstrip ensure() passes for one clip so
// dragging the zoom slider does not fire an extraction per frame.
const FILMSTRIP_ENSURE_THROTTLE_MS = 250;

// ---------------------------------------------------------------------------
// Props — only data that cannot come from the store
// ---------------------------------------------------------------------------

/**
 * Round-2 local-download state for a material, fed down from the authoritative
 * `materials` list (same source as the readiness gate — C4, no dual data
 * source). See docs/plans/video-editor-client-preview-download/spec.md §3.3.7.
 * Direct-local desktop uploads are omitted from this map by TimelinePanel, so
 * they render as normal clips without download overlays.
 */
export interface LocalProxyMaskState {
  status?: LocalProxyStatus;
  progress?: number;
}

interface TimelineItemProps {
  item: TimelineItemData;
  pixelsPerSecond: number;
  trackHeight: number;
  /** Local-download status keyed by materialId (authoritative `materials`). */
  localProxyStatusMap?: Map<string, LocalProxyMaskState>;
  /** Mount-locked local-preview flag, passed from the parent (avoids per-item read). */
  localPreviewEnabled?: boolean;
  /** Retry a failed / degraded local download (clears localProxy* → re-arms). */
  onRetryLocalDownload?: (materialId: string) => void;
  /**
   * Detach this video item's embedded audio to an independent audio track.
   * Wired by the parent (which holds the live `materials` list) so the
   * has-audio gate can read the source material; omitted → no detach entry.
   * See spec local-video-editing-refactor 01 §2.4.
   */
  onDetachAudio?: (itemId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TimelineItem: React.FC<TimelineItemProps> = ({
  item,
  pixelsPerSecond,
  trackHeight,
  localProxyStatusMap,
  localPreviewEnabled,
  onRetryLocalDownload,
  onDetachAudio,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();

  // ---------------------------------------------------------------------------
  // Store reads (selector pattern for render perf)
  // ---------------------------------------------------------------------------

  const isSelected = useTimelineStore(s => s.selectedItems.includes(item.id));
  const isDragging = useTimelineStore(s => s.isDragging);
  const isResizing = useTimelineStore(s => s.isResizing);
  const dragPreview = useTimelineStore(s =>
    s.dragPreview?.itemId === item.id ? s.dragPreview : null,
  );
  // True when THIS item is the swap target the drag preview is parked on.
  const isSwapTarget = useTimelineStore(s => s.swapTargetItemId === item.id);
  // True when any swap target is active (regardless of which item); used by
  // the dragged item itself to fade out so the target is more readable.
  const hasActiveSwapTarget = useTimelineStore(s => s.swapTargetItemId !== null);
  const editingSubtitleId = useTimelineStore(s => s.editingSubtitleId);
  const zoomLevel = useTimelineStore(s => s.zoomLevel);
  // Active editing tool — when 'cut', a click splits this clip at the cursor.
  const activeTool = useTimelineStore(s => s.activeTool);
  // Parent track's lock state — cannot come via props (Track passes only item,
  // pixelsPerSecond, trackHeight); read through selector so lock toggles re-render.
  const isTrackLocked = useTimelineStore(s => {
    const tr = s.tracks.find(t => t.id === item.trackId);
    return tr?.isLocked ?? false;
  });

  // Store actions
  const startDrag = useTimelineStore(s => s.startDrag);
  const selectItem = useTimelineStore(s => s.selectItem);
  const toggleItemSelection = useTimelineStore(s => s.toggleItemSelection);
  const deselectAll = useTimelineStore(s => s.deselectAll);
  const setEditingSubtitle = useTimelineStore(s => s.setEditingSubtitle);
  const updateItemSubtitle = useTimelineStore(s => s.updateItemSubtitle);

  // ---------------------------------------------------------------------------
  // Local UI state (subtitle editing only)
  // ---------------------------------------------------------------------------

  const isEditingSubtitle = editingSubtitleId === item.id;
  const [editingText, setEditingText] = useState('');

  // ---------------------------------------------------------------------------
  // Derived layout values — use dragPreview position when active
  // ---------------------------------------------------------------------------

  const effectiveStartTime = dragPreview ? dragPreview.startTime : item.startTime;
  const effectiveDuration = dragPreview ? dragPreview.duration : item.duration;
  const left = effectiveStartTime * pixelsPerSecond;
  const width = effectiveDuration * pixelsPerSecond;

  const isThisItemDragging = isDragging && dragPreview !== null;
  const isThisItemResizing = isResizing && dragPreview !== null;

  // ---------------------------------------------------------------------------
  // Filmstrip (spec 03 §2.4): zoom-aware multi-frame tiling for video clips.
  // The extraction source is the clip's SAME-ORIGIN playback URL (direct-local
  // → /api/storage/files); never /api/video-proxy. We render the cached slot
  // URLs (or the poster as fallback) and run ensure() in a throttled effect so
  // only the visible clip's frames are extracted, not on every render.
  // ---------------------------------------------------------------------------

  // Re-render this item whenever its filmstrip frames resolve.
  const [filmstripVersion, setFilmstripVersion] = useState(0);

  const filmstripItem = useMemo<FilmstripItem | null>(() => {
    if (item.type !== 'video') return null;
    // Prefer the same-origin local/cache URL; selectPlaybackUrl returns the
    // direct-local /api/storage/files path for desktop uploads.
    const src = selectPlaybackUrl(item, { purpose: 'preview' });
    if (!item.materialId || !src) return null;
    return {
      materialId: item.materialId,
      clipStart: item.clipStart,
      clipEnd: item.clipEnd,
      duration: item.duration,
      url: src,
    };
  }, [
    item.type,
    item.materialId,
    item.clipStart,
    item.clipEnd,
    item.duration,
    item.url,
    item.cacheUrl,
    item.serverUrl,
  ]);

  const zoom = useMemo(() => ZoomLevel.create(zoomLevel), [zoomLevel]);

  // Visible-range slot list (pure cache read). framesFor returns one slot per
  // frame the clip needs at this zoom; url=null until ensure() resolves it.
  const filmstripSlots: FilmstripSlot[] = useMemo(() => {
    if (!filmstripItem) return [];
    return filmstripCache.framesFor(filmstripItem, zoom);
    // filmstripVersion forces a recompute after ensure() populates the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filmstripItem, zoom, filmstripVersion]);

  // Throttled extract/persist of missing frames for the visible clip only.
  useEffect(() => {
    if (!filmstripItem) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      filmstripCache.ensure(filmstripItem, zoom).then(() => {
        if (!cancelled) setFilmstripVersion(v => v + 1);
      });
    }, FILMSTRIP_ENSURE_THROTTLE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [filmstripItem, zoom]);

  // ---------------------------------------------------------------------------
  // Waveform (spec 04): the same-origin audio source for an audio item. Uses
  // selectPlaybackUrl('export') because that prefers a backend-resolvable local
  // /api/storage/files reference — exactly what the waveform service can decode.
  // Null when the item has no materialId or no local reference (e.g. legacy
  // remote-only audio) → the track falls back to the static placeholder bars.
  // ---------------------------------------------------------------------------
  const waveformAudioUrl = useMemo<string | null>(() => {
    if (item.type !== 'audio' || !item.materialId) return null;
    const src = selectPlaybackUrl(item, { purpose: 'export' });
    return src || null;
  }, [item.type, item.materialId, item.url, item.cacheUrl, item.serverUrl]);

  // ---------------------------------------------------------------------------
  // Event handlers — delegate to store
  // ---------------------------------------------------------------------------

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;

    const relativeX = e.clientX - rect.left;

    // Cut tool: split this clip at the click point instead of dragging. The cut
    // time maps the pixel offset to a track-timeline time via clipStart-anchored
    // arithmetic (pixelsPerSecond is the live zoom→px scale). Locked tracks and
    // a click exactly on an edge are no-ops handled downstream (splitAction).
    if (activeTool === 'cut' && !isTrackLocked) {
      const tCut = item.startTime + relativeX / pixelsPerSecond;
      selectItem(item.id);
      splitAction(() => useTimelineStore.getState(), tCut, 'selected');
      return;
    }

    // Select the item (multi-select with Ctrl/Meta)
    if (e.ctrlKey || e.metaKey) {
      toggleItemSelection(item.id);
    } else {
      selectItem(item.id);
    }

    // Start drag via store (state machine decides move vs resize)
    startDrag({
      type: 'POINTER_DOWN',
      itemId: item.id,
      trackId: item.trackId,
      clientX: e.clientX,
      clientY: e.clientY,
      relativeX,
      itemWidth: width,
      originalStartTime: item.startTime,
      originalDuration: item.duration,
      zoomLevel,
      clipStart: item.clipStart,
      clipEnd: item.clipEnd,
      originalMediaDuration: item.originalDuration,
    });
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (item.type === 'subtitle') {
      setEditingText(item.text || '');
      setEditingSubtitle(item.id);
    }
  };

  // Right-click on a not-yet-detached video clip triggers audio detach. The
  // parent supplies onDetachAudio (it holds the live materials list for the
  // has-audio gate); without it, the entry is inert and the native menu shows.
  const canDetachAudio =
    !!onDetachAudio &&
    item.type === 'video' &&
    item.audioDetached !== true &&
    !isTrackLocked;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!canDetachAudio) return;
    e.preventDefault();
    e.stopPropagation();
    onDetachAudio?.(item.id);
  };

  // ---------------------------------------------------------------------------
  // Subtitle inline editing handlers
  // ---------------------------------------------------------------------------

  const handleSubtitleEditComplete = () => {
    const nextText = editingText.trim();
    const prevText = (item.text ?? '').trim();
    // Only commit (and push to undo history) when the value actually changed.
    // Allow empty commits so users can clear a caption without losing the clip.
    if (nextText !== prevText) {
      updateItemSubtitle(item.id, nextText);
    }
    setEditingSubtitle(null);
    setEditingText('');
  };

  const handleSubtitleEditCancel = () => {
    setEditingSubtitle(null);
    setEditingText('');
  };

  const handleSubtitleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubtitleEditComplete();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleSubtitleEditCancel();
    }
  };

  // Keyboard interaction on the item root (a11y). Enter/Space selects the
  // item; Delete/Backspace ensures selection then lets the global panel
  // handler delete; Escape clears selection. Locked tracks + active inline
  // subtitle editing bypass this handler entirely.
  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditingSubtitle) return;
    if (isTrackLocked) return;

    switch (e.key) {
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          toggleItemSelection(item.id);
        } else {
          selectItem(item.id);
        }
        return;
      }
      case 'Delete':
      case 'Backspace': {
        if (!isSelected) {
          selectItem(item.id);
        }
        return;
      }
      case 'Escape': {
        e.preventDefault();
        deselectAll();
        return;
      }
      default:
        return;
    }
  };

  // ---------------------------------------------------------------------------
  // Styles — preserve all original visual logic
  // ---------------------------------------------------------------------------

  const getItemStyles = () => {
    const padding = Math.max(2, Math.floor(trackHeight * 0.125));
    const itemHeight = trackHeight - padding * 2;

    // When a swap target is under the dragged item's center, fade the
    // dragged item more heavily so the highlighted target is clearly read.
    const draggedOpacity = hasActiveSwapTarget ? 0.65 : 0.8;

    const baseStyles = {
      position: 'absolute' as const,
      left: `${left}px`,
      width: `${Math.max(width, 20)}px`,
      height: `${Math.max(itemHeight, 16)}px`,
      top: `${padding}px`,
      borderRadius: '3px',
      cursor: isThisItemDragging ? 'grabbing' : 'grab',
      userSelect: 'none' as const,
      transition: isThisItemDragging || isThisItemResizing ? 'none' : 'all 0.2s ease',
      zIndex: isSwapTarget ? 9 : (isSelected ? 10 : 1),
      opacity: isThisItemDragging ? draggedOpacity : 1,
    };

    // Swap-target overlay: dashed cyan outline + glow.
    const swapTargetStyles = isSwapTarget
      ? {
          outline: '2px dashed #22d3ee',
          outlineOffset: '1px',
          boxShadow: '0 0 0 4px rgba(34, 211, 238, 0.25)',
        }
      : null;

    switch (item.type) {
      case 'video':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid var(--primary)' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px color-mix(in srgb, var(--primary) 30%, transparent)' : 'none',
          ...(swapTargetStyles ?? {}),
        };
      case 'audio':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(16, 185, 129, 0.3)' : 'none',
          ...(swapTargetStyles ?? {}),
        };
      case 'subtitle':
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, ${item.color} 0%, ${item.color}dd 100%)`,
          border: isSelected ? '2px solid #f59e0b' : '1px solid rgba(255,255,255,0.2)',
          boxShadow: isSelected ? '0 0 0 2px rgba(245, 158, 11, 0.3)' : 'none',
        };
      default:
        return baseStyles;
    }
  };

  // ---------------------------------------------------------------------------
  // Filmstrip render: tile the resolved frames across the clip bar. Each slot
  // shows its cached frame URL, falling back to the poster (item.thumbnailUrl)
  // when the frame has not resolved yet or extraction failed (degrade, spec
  // §2.3). A single-slot (narrow) clip renders one tile — same as the prior
  // single-thumbnail behaviour. Rendered as an absolutely-positioned layer
  // BEHIND the label so the name/duration stay readable.
  // ---------------------------------------------------------------------------

  const renderFilmstrip = () => {
    const slots = filmstripSlots;
    if (slots.length === 0) return null;
    const slotWidthPct = 100 / slots.length;
    return (
      <div
        className="pointer-events-none absolute inset-0 flex overflow-hidden"
        style={{ borderRadius: '3px', zIndex: 0 }}
        aria-hidden="true"
      >
        {slots.map((slot, i) => {
          const url = slot.url ?? item.thumbnailUrl ?? null;
          return (
            <div
              key={`${slot.tMs}-${i}`}
              className="h-full flex-shrink-0 bg-black/20"
              style={{ width: `${slotWidthPct}%` }}
            >
              {url && (
                <img
                  src={url}
                  alt=""
                  className="h-full w-full object-cover opacity-80"
                  draggable={false}
                  loading="lazy"
                />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render item content — preserve all original visual rendering
  // ---------------------------------------------------------------------------

  const renderItemContent = () => {
    const padding = Math.max(2, Math.floor(trackHeight * 0.125));
    const itemHeight = trackHeight - padding * 2;
    const contentPadding = Math.max(2, Math.floor(itemHeight * 0.15));
    const iconSize = Math.max(12, Math.min(24, Math.floor(itemHeight * 0.6)));
    const fontSize = Math.max(10, Math.min(14, Math.floor(itemHeight * 0.4)));
    const thumbnailSize = Math.max(12, Math.min(20, Math.floor(itemHeight * 0.7)));

    const contentStyle = {
      padding: `${Math.floor(contentPadding / 2)}px ${contentPadding}px`,
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      overflow: 'hidden',
    };

    switch (item.type) {
      case 'video':
        return (
          <>
            {renderFilmstrip()}
            {/* Label overlay sits ABOVE the filmstrip (relative z-index) with a
                subtle scrim so the name/duration stay readable over frames. */}
            <div
              style={contentStyle}
              className="relative z-[1]"
            >
              <div className="flex items-center space-x-1 min-w-0">
                {/* Keep a small poster chip only when no filmstrip is present
                    yet (single fallback for very early render); the filmstrip
                    background covers the cover role once frames resolve. */}
                {filmstripSlots.length === 0 && item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.name}
                    className="rounded object-cover flex-shrink-0"
                    style={{
                      width: `${thumbnailSize}px`,
                      height: `${thumbnailSize}px`,
                    }}
                  />
                )}
                <span
                  className="text-white font-medium truncate drop-shadow"
                  style={{
                    fontSize: `${fontSize}px`,
                    textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                  }}
                >
                  {item.name}
                </span>
              </div>
              <span
                className="text-white opacity-90 flex-shrink-0 ml-1"
                style={{
                  fontSize: `${Math.max(8, fontSize - 2)}px`,
                  textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                }}
              >
                {item.duration.toFixed(1)}s
              </span>
            </div>
          </>
        );
      case 'audio':
        return (
          <div style={contentStyle}>
            {item.sentenceSegments && item.sentenceSegments.sentences.length > 0 ? (
              <>
                <SentenceSegmentBar
                  sentenceSegments={item.sentenceSegments}
                  width={width}
                  height={trackHeight}
                  duration={item.duration}
                />
                <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
                  <div className="flex items-center space-x-1 min-w-0">
                    <div
                      className="flex-shrink-0 "
                      style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                    >
                      <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                      </svg>
                    </div>
                    <span
                      className="text-white font-medium truncate "
                      style={{ fontSize: `${fontSize}px` }}
                    >
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 flex-shrink-0">
                    <span
                      className="text-white opacity-90 bg-black bg-opacity-30 px-1.5 py-0.5 rounded text-xs font-medium "
                      style={{ fontSize: `${Math.max(8, fontSize - 2)}px` }}
                    >
                      {item.sentenceSegments.sentences.length} 句
                    </span>
                    <span
                      className="text-white opacity-75 "
                      style={{ fontSize: `${Math.max(8, fontSize - 2)}px` }}
                    >
                      {item.duration.toFixed(1)}s
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* spec 04: persisted local waveform behind the label. Falls
                    back to the static placeholder bars when no local audio
                    reference is available (e.g. legacy remote-only audio). */}
                {waveformAudioUrl && item.materialId && (
                  <AudioWaveformCanvas
                    materialId={item.materialId}
                    audioUrl={waveformAudioUrl}
                    width={width}
                    height={trackHeight}
                    clipStart={item.clipStart}
                    clipEnd={item.clipEnd}
                  />
                )}
                <div className="flex items-center space-x-1 min-w-0 relative z-[1]">
                  <div
                    className="flex-shrink-0"
                    style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                  >
                    <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                    </svg>
                  </div>
                  <span
                    className="text-white font-medium truncate"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {item.name}
                  </span>
                </div>
                {/* Static placeholder bars only when there is no real waveform
                    source — the persisted canvas replaces them otherwise. */}
                {!waveformAudioUrl && (
                  <div className="flex items-center space-x-0.5 flex-shrink-0">
                    {[...Array(Math.max(3, Math.min(8, Math.floor(iconSize / 2))))].map((_, i) => (
                      <div
                        key={i}
                        className="w-0.5 bg-white opacity-60"
                        style={{
                          height: `${Math.max(2, (((i * 7 + 3) % 11) / 11) * (iconSize * 0.6) + 2)}px`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      case 'subtitle':
        return (
          <div style={contentStyle}>
            {isEditingSubtitle ? (
              <div className="flex items-center space-x-1 min-w-0 w-full">
                <input
                  type="text"
                  value={editingText}
                  onChange={(e) => setEditingText(e.target.value)}
                  onKeyDown={handleSubtitleEditKeyDown}
                  onBlur={handleSubtitleEditComplete}
                  className="flex-1 bg-transparent text-white font-medium border-none outline-none"
                  style={{
                    minWidth: '0',
                    fontSize: `${fontSize}px`,
                  }}
                  autoFocus
                  placeholder={t.timeline.subtitleEditModal.placeholder}
                />
              </div>
            ) : (
              <div className="flex items-center space-x-1 min-w-0">
                <div
                  className="flex-shrink-0"
                  style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
                >
                  <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z"/>
                  </svg>
                </div>
                <span
                  className="text-white font-medium truncate"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {item.text || item.name}
                </span>
              </div>
            )}
          </div>
        );
      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Round-3 local-download visualization (spec docs/plans/
  // video-editor-track-download-progress/spec.md §3.3.3, G2). The CLIP BAR ITSELF
  // acts as the progress bar: while downloading, the already-downloaded portion
  // (0→progress%) keeps the bar's own colour and the not-yet-downloaded portion
  // (progress%→100%) is dimmed, with a thin highlight line at the boundary and a
  // small unobtrusive badge. transcoding → indeterminate pulse; error → red +
  // retry; degraded → amber + retry; ready/idle/undefined → no overlay.
  //
  // Only for video/audio clips (C2: image/subtitle excluded). Status comes from
  // the authoritative `materials`-derived map (same source as the readiness gate
  // — no dual data source, C4). NOTE: the guard below reads `item.type`, but the
  // map is already filtered to video/audio MATERIALS upstream (TimelinePanel
  // localProxyStatusMap), so an image dropped on a video track has no entry →
  // status === undefined → returns null (P2-3).
  // ---------------------------------------------------------------------------

  const renderLocalDownloadOverlay = () => {
    if (!localPreviewEnabled) return null;
    if (item.type !== 'video' && item.type !== 'audio') return null;
    if (!item.materialId) return null;
    const local = localProxyStatusMap?.get(item.materialId);
    const status = local?.status;
    if (
      status !== 'transcoding' &&
      status !== 'downloading' &&
      status !== 'error' &&
      status !== 'degraded'
    ) {
      return null; // idle / ready / undefined → no overlay (plain bar)
    }

    const stopDrag = (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const retry = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (item.materialId && onRetryLocalDownload) onRetryLocalDownload(item.materialId);
    };

    const spinner = (
      <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin flex-shrink-0" />
    );

    // downloading — the bar itself is the progress bar: dim only the portion to
    // the RIGHT of pct% (the not-yet-downloaded part), leaving the left "already
    // downloaded" segment showing the clip's own colour. A thin boundary line
    // marks the read-out, plus a small badge ("下载中 NN%"). All layers are
    // pointer-events-none so dragging / resize handles keep working (R2).
    if (status === 'downloading') {
      const pct = Math.max(0, Math.min(100, Math.round(local?.progress ?? 0)));
      return (
        <div
          className="pointer-events-none absolute inset-0 overflow-hidden"
          style={{ borderRadius: '3px', zIndex: 8 }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {/* not-yet-downloaded region (right of pct%) dimmed */}
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${pct}%`, right: 0, background: 'rgba(0,0,0,0.45)' }}
          />
          {/* progress boundary highlight line */}
          <div
            className="absolute top-0 bottom-0"
            style={{ left: `${pct}%`, width: '2px', background: 'rgba(255,255,255,0.9)' }}
          />
          {/* small badge — never tall enough to grow the bar; truncates on narrow clips */}
          <span
            className="absolute left-1 bottom-0.5 max-w-[calc(100%-8px)] px-1 rounded bg-black/55 text-white truncate"
            style={{ fontSize: '9px', lineHeight: '14px' }}
          >
            {t.timeline.track.localDownloading} {pct}%
          </span>
        </div>
      );
    }

    // transcoding — no byte progress yet: indeterminate pulse + spinner.
    if (status === 'transcoding') {
      return (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center animate-pulse"
          style={{ background: 'rgba(0,0,0,0.45)', borderRadius: '3px', fontSize: '10px', zIndex: 8 }}
        >
          <span className="flex items-center gap-1 text-white">
            {spinner}
            <span className="truncate">{t.timeline.track.localTranscoding}</span>
          </span>
        </div>
      );
    }

    // error / degraded — colour the bar + show a clickable retry. Only the button
    // is pointer-events-auto, and onPointerDown stops propagation so the click is
    // not mistaken for a drag start (R2).
    const isError = status === 'error';
    return (
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{
          background: isError ? 'rgba(220,38,38,0.35)' : 'rgba(245,158,11,0.30)',
          borderRadius: '3px',
          fontSize: '10px',
          zIndex: 8,
        }}
      >
        <button
          type="button"
          className={
            isError
              ? 'pointer-events-auto px-1.5 py-0.5 rounded bg-red-600/90 text-white hover:bg-red-600 truncate'
              : 'pointer-events-auto px-1.5 py-0.5 rounded bg-amber-500/90 text-white hover:bg-amber-500 truncate'
          }
          onPointerDown={stopDrag}
          onClick={retry}
          title={isError ? t.timeline.track.localDownloadFailed : t.timeline.track.localWillStream}
        >
          {isError ? t.timeline.track.localDownloadFailed : t.timeline.track.localWillStream}
        </button>
      </div>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={itemRef}
      role="button"
      tabIndex={isTrackLocked ? -1 : 0}
      aria-pressed={isSelected}
      aria-disabled={isTrackLocked || undefined}
      aria-label={
        `${item.name} ` +
        `${formatTimelineTime(item.startTime, { showMs: true })}–` +
        `${formatTimelineTime(item.startTime + item.duration, { showMs: true })}` +
        `${isSelected ? ` (${t.timeline.track.selected})` : ''}` +
        `${isTrackLocked ? ` (${t.timeline.track.trackLocked})` : ''}`
      }
      style={getItemStyles()}
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleItemKeyDown}
      className="timeline-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      data-clip-id={item.id}
      title={
        `${item.name} ` +
        `${formatTimelineTime(item.startTime, { showMs: true })} - ` +
        `${formatTimelineTime(item.startTime + item.duration, { showMs: true })}`
      }
    >
      {renderItemContent()}

      {renderLocalDownloadOverlay()}

      {/* Swap-target hint label: shown on the peer item that the drag preview
          center is hovering over. Hidden on subtitle items (subtitle tracks
          cannot be swap targets; the highlight is never applied, but guard
          anyway). */}
      {isSwapTarget && item.type !== 'subtitle' && (
        <div
          className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-6 px-2 py-0.5 rounded text-xs font-medium text-white bg-cyan-500/90 shadow-sm whitespace-nowrap"
        >
          {t.timeline.messages.swapHint}
        </div>
      )}

      {/* Resize handles */}
      {isSelected && (
        <>
          <div
            className="absolute left-0 top-0 w-1.5 h-full cursor-ew-resize bg-white bg-opacity-30 hover:bg-opacity-50"
            style={{ borderRadius: '3px 0 0 3px' }}
          />
          <div
            className="absolute right-0 top-0 w-1.5 h-full cursor-ew-resize bg-white bg-opacity-30 hover:bg-opacity-50"
            style={{ borderRadius: '0 3px 3px 0' }}
          />
        </>
      )}
    </div>
  );
};

export default TimelineItem;
