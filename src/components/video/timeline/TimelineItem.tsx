'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import { useTimelineStore, splitAction } from './store';
import { updateSubtitleTextAction } from './store/actions/updateItemFields';
import type { TimelineItemData } from './domain/types';
import SentenceSegmentBar from './SentenceSegmentBar';
import SentenceHitLayer from './SentenceHitLayer';
import { useAudioClipDisplay } from './audioClipDisplayPref';
import { projectSentencesOntoClip } from './lib/sentenceWindow';
import AudioWaveformCanvas from './AudioWaveformCanvas';
import { formatTimelineTime } from './timeFormat';
import { ZoomLevel } from './domain/value-objects/ZoomLevel';
import {
  detectInteractionType,
  edgeHandleWidthPx,
  type InteractionType,
} from './domain/machines/dragMachine';
import {
  filmstripCache,
  type FilmstripItem,
  type FilmstripSlot,
} from '../lib/filmstrip/filmstripCache';
import { selectPlaybackUrl } from '../lib/selectPlaybackUrl';
import { computeItemStyles } from './timelineItemStyles';
import { presetLabel } from '../components/CameraMotionModal/presetLabels';
import { canApplyCameraMotion } from '../playback/camera/eligibility';
import TimelineItemFilmstrip from './TimelineItemFilmstrip';
import TimelineItemDownloadOverlay, {
  type LocalProxyMaskState,
} from './TimelineItemDownloadOverlay';
import { useSegmentLinksValue } from '../lib/segments/SegmentLinksContext';
import type { SegmentIndexEntry } from '../lib/segments/segmentLinks';

// Re-export so existing consumers (TimelinePanel / Track / TrackContainer)
// keep importing the type from './TimelineItem' unchanged.
export type { LocalProxyMaskState };

// ---------------------------------------------------------------------------
// Filmstrip: one process-wide cache (the shared `filmstripCache` singleton) so
// frames resolved for a clip persist across re-renders / scroll / re-zoom to
// the same tier (spec 03 §2.3 hit reuse) AND so the spec-06 delete-联动 flow
// evicts the very keys this renderer reads. Defaults mirror the backend
// ThumbnailConfig filmstrip params.
// ---------------------------------------------------------------------------

// Throttle window (ms) between filmstrip ensure() passes for one clip so
// dragging the zoom slider does not fire an extraction per frame.
const FILMSTRIP_ENSURE_THROTTLE_MS = 250;

// ---------------------------------------------------------------------------
// Props — only data that cannot come from the store
// ---------------------------------------------------------------------------

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
  /**
   * Open the camera-motion panel for this clip (camera-motion-2d-3d §4.5.1).
   * Wired by the parent; omitted → double-click and the badge are inert.
   */
  onOpenCameraMotion?: (itemId: string) => void;
  /** The clip's material is gone from the library: preview skips it, export refuses it (N-01). */
  isMaterialMissing?: boolean;
}

/** Red dashed ring on a clip whose material is gone (N-01). */
const MISSING_MATERIAL_OUTLINE: React.CSSProperties = {
  outline: '2px dashed #dc2626',
  outlineOffset: '-2px',
};

interface ClipNameProps {
  name: string;
  segment: SegmentIndexEntry | null;
  fontSize: number;
}

/**
 * Main clip label (spec §3.8): 「[01] 丝滑亮相」 — the same ordinal badge and
 * title as the script card — when the clip belongs to a segment; otherwise
 * the file name, exactly as before. The file name moves to the tooltip.
 */
const ClipName: React.FC<ClipNameProps> = ({ name, segment, fontSize }) => {
  if (!segment) return <>{name}</>;
  // Compact badge: it has to fit the shortest lane (clip height ≈ 16px).
  const badgeSize = Math.max(12, fontSize + 2);
  return (
    <>
      <span
        className="ws-badge-ordinal mr-1 align-middle"
        style={{ height: badgeSize, minWidth: badgeSize, fontSize: Math.max(9, fontSize - 2) }}
        aria-hidden="true"
      >
        {segment.badge}
      </span>
      {segment.title}
    </>
  );
};

// ---------------------------------------------------------------------------
// Audio clip body (editor-shell-ui-consolidation W6): the label strip and the
// waveform / sentence area are stacked vertically and never overlap, so no
// text is ever drawn over the waveform.
// ---------------------------------------------------------------------------

/** Height of the label strip above an audio clip's waveform. */
export const AUDIO_LABEL_STRIP_PX = 14;
/** Lanes shorter than this get no label strip; the name lives in the tooltip. */
const AUDIO_LABEL_STRIP_MIN_TRACK_PX = 36;
const AUDIO_LABEL_FONT_PX = 11;
const TIMELINE_WAVEFORM_COLOR = 'rgba(255,255,255,0.78)';

interface AudioClipBodyProps {
  item: TimelineItemData;
  width: number;
  /** Lane height: decides whether the label strip fits. */
  trackHeight: number;
  /** Rendered clip box height (lane minus its vertical padding); the
   *  waveform area is sized from this so it is not clipped at the bottom. */
  clipHeight: number;
  iconSize: number;
  waveformAudioUrl: string | null;
  visibleSentenceCount: number;
  segmentEntry: SegmentIndexEntry | null;
}

/** Static bars for audio without a local waveform source (legacy remote). */
const PlaceholderBars: React.FC<{ iconSize: number }> = ({ iconSize }) => (
  <div className="absolute inset-0 flex items-center justify-center space-x-0.5">
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
);

const AudioClipBody: React.FC<AudioClipBodyProps> = ({
  item, width, trackHeight, clipHeight, iconSize, waveformAudioUrl, visibleSentenceCount,
  segmentEntry,
}) => {
  const { t } = useLocale();
  const [audioDisplay] = useAudioClipDisplay();
  const showLabelStrip = trackHeight >= AUDIO_LABEL_STRIP_MIN_TRACK_PX;
  const bodyTop = showLabelStrip ? AUDIO_LABEL_STRIP_PX : 0;
  const bodyHeight = Math.max(1, clipHeight - bodyTop);
  const hasSentences = !!item.sentenceSegments && visibleSentenceCount > 0;
  const useSentenceView = audioDisplay === 'sentences' && hasSentences;
  const durationText = `${item.duration.toFixed(1)}s`;
  const tooltipParts = [segmentEntry ? segmentEntry.title : item.name];
  if (hasSentences) {
    tooltipParts.push(t.timeline.sentenceSegment.sentenceCount
      .replace('{count}', String(visibleSentenceCount)));
  }
  tooltipParts.push(durationText);

  const renderBody = () => {
    if (useSentenceView && item.sentenceSegments) {
      return (
        <SentenceSegmentBar sentenceSegments={item.sentenceSegments} width={width}
          height={bodyHeight} duration={item.duration} clipStart={item.clipStart ?? 0} />
      );
    }
    if (waveformAudioUrl && item.materialId) {
      return (
        <AudioWaveformCanvas materialId={item.materialId} audioUrl={waveformAudioUrl}
          width={width} height={bodyHeight} clipStart={item.clipStart}
          clipEnd={item.clipEnd} color={TIMELINE_WAVEFORM_COLOR} />
      );
    }
    return <PlaceholderBars iconSize={iconSize} />;
  };

  return (
    <div className="relative h-full overflow-hidden" title={tooltipParts.join(' · ')}>
      {showLabelStrip && (
        <div className="ws-audio-label-strip" style={{ height: AUDIO_LABEL_STRIP_PX }}>
          <span className="ws-audio-label-name">
            <ClipName name={item.name} segment={segmentEntry} fontSize={AUDIO_LABEL_FONT_PX} />
          </span>
          <span className="ws-audio-label-meta">{durationText}</span>
        </div>
      )}
      <div className="absolute left-0 right-0" data-audio-body
        style={{ top: bodyTop, height: bodyHeight }}>
        {renderBody()}
        {!useSentenceView && hasSentences && item.sentenceSegments && (
          <SentenceHitLayer sentenceSegments={item.sentenceSegments}
            duration={item.duration} clipStart={item.clipStart ?? 0} />
        )}
      </div>
    </div>
  );
};

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
  onOpenCameraMotion,
  isMaterialMissing = false,
}) => {
  const itemRef = useRef<HTMLDivElement>(null);
  const { t } = useLocale();
  const { showInfo, showWarning } = useNotification();

  // ---------------------------------------------------------------------------
  // Store reads (selector pattern for render perf)
  // ---------------------------------------------------------------------------

  const isSelected = useTimelineStore(s => s.selectedItems.includes(item.id));
  const isDragging = useTimelineStore(s => s.isDragging);
  const isResizing = useTimelineStore(s => s.isResizing);
  // From press to release, including the pre-threshold detecting phase.
  const isInteracting = useTimelineStore(s => s.isInteracting);
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

  // Segment links: one context read per clip, O(1) map lookups, no prop
  // drilling through Track (spec §3.8). Subtitles keep showing their text.
  const { itemSegmentMap, segmentIndex, highlightedItemIds } = useSegmentLinksValue();
  const linkedSegmentId = item.type === 'subtitle' ? undefined : itemSegmentMap.get(item.id);
  const segmentEntry = (linkedSegmentId && segmentIndex.get(linkedSegmentId)) || null;
  const isLinked = highlightedItemIds.has(item.id);

  // ---------------------------------------------------------------------------
  // Local UI state (subtitle editing only)
  // ---------------------------------------------------------------------------

  const isEditingSubtitle = editingSubtitleId === item.id;
  const [editingText, setEditingText] = useState('');
  // Which zone the pointer hovers (trim edge vs body). Drives the cursor and
  // the trim handles, so the user sees that a press will trim before pressing.
  const [hoverZone, setHoverZone] = useState<InteractionType>('move');

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

  // Sentences inside this clip's source window: after a split or trim the clip
  // shows only part of the recording (TL2-11). None visible → waveform instead.
  const visibleSentenceCount = useMemo(
    () => projectSentencesOntoClip(
      item.sentenceSegments?.sentences ?? [],
      item.clipStart ?? 0,
      item.duration,
    ).length,
    [item.sentenceSegments, item.clipStart, item.duration],
  );

  // ---------------------------------------------------------------------------
  // Event handlers — delegate to store
  // ---------------------------------------------------------------------------

  const handlePointerDown = (e: React.PointerEvent) => {
    // A press inside the inline subtitle editor places the caret or selects
    // text: no clip drag, and no preventDefault that would block it (UI3-04).
    if (isEditingSubtitle) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;

    const relativeX = e.clientX - rect.left;

    // Cut tool: split this clip at the click point instead of dragging. The cut
    // time maps the pixel offset to a track-timeline time via clipStart-anchored
    // arithmetic (pixelsPerSecond is the live zoom→px scale). A click exactly on
    // an edge is a no-op handled downstream (splitAction); a locked lane says
    // why nothing happened instead of staying silent (TL3-05).
    if (activeTool === 'cut') {
      selectItem(item.id);
      if (isTrackLocked) {
        showWarning(t.timeline.track.trackLocked);
        return;
      }
      const tCut = item.startTime + relativeX / pixelsPerSecond;
      const outcome = splitAction(() => useTimelineStore.getState(), tCut, 'selected');
      if (outcome === 'too-close') {
        showInfo(t.timeline.messages.splitTooCloseToEdge);
      }
      return;
    }

    // Select the item (multi-select with Ctrl/Meta)
    if (e.ctrlKey || e.metaKey) {
      toggleItemSelection(item.id);
    } else {
      selectItem(item.id);
    }

    // Locked tracks keep click-to-select but never start a move or trim.
    if (isTrackLocked) return;

    // A still image has no source length and a subtitle has no source media
    // at all, so their edges extend freely — a caption's left edge used to be
    // clamped as if its in-point were 0 (TL3-03). Legacy items without
    // originalDuration must not feed `undefined` into the machine's clamp
    // maths (it turned into NaN).
    const hasFreeEdges = item.originalMaterialType === 'image' || item.type === 'subtitle';

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
      originalMediaDuration: hasFreeEdges
        ? Number.POSITIVE_INFINITY
        : (item.originalDuration ?? Number.POSITIVE_INFINITY),
      isStill: hasFreeEdges,
    });
  };

  const handleHoverMove = (e: React.PointerEvent) => {
    // From press to release the drag machine owns the gesture. Re-detecting
    // while the pointer drifts inside the drag threshold would flip a trim
    // started near the handle's inner edge to "grab" for the whole trim.
    if (isInteracting || isTrackLocked || isEditingSubtitle) return;
    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;
    const zone = detectInteractionType(e.clientX - rect.left, width);
    if (zone !== hoverZone) setHoverZone(zone);
  };

  const handleHoverLeave = () => {
    if (!isInteracting) setHoverZone('move');
  };

  // camera-motion-2d-3d §4.5.1 / P2-7: eligibility goes through the SHARED
  // `canApplyCameraMotion` predicate — the toolbar, the M shortcut, the
  // double-click and this badge must never disagree, and re-stating the rule
  // here is exactly how they would drift apart.
  const cameraMotionEligible = useTimelineStore(s =>
    canApplyCameraMotion(item, s.tracks.find(t => t.id === item.trackId)),
  );
  const cameraMotionEnabled = !!onOpenCameraMotion && cameraMotionEligible;

  const handleDoubleClick = (e: React.MouseEvent) => {
    // Double-clicking a word in the open editor selects it; re-opening the
    // editor here would reset what the user typed to the stored text (UI3-04).
    if (isEditingSubtitle) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    if (item.metadata?.role === 'video-cover') {
      useTimelineStore.getState().onEditCover?.(item.id);
      return;
    }
    if (item.type === 'subtitle') {
      // The commit is refused on a locked track, which would silently throw
      // away what the user typed; don't open the editor at all.
      if (isTrackLocked) return;
      setEditingText(item.text || '');
      setEditingSubtitle(item.id);
      return;
    }
    // Video clips: double-click is the accelerator for the camera-motion panel
    // (this branch was previously empty, so there is no conflict).
    if (cameraMotionEnabled) {
      onOpenCameraMotion?.(item.id);
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

  const [coverMenu, setCoverMenu] = useState<{ x: number; y: number } | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    if (item.metadata?.role === 'video-cover') {
      e.preventDefault(); e.stopPropagation();
      setCoverMenu({ x: e.clientX, y: e.clientY });
      return;
    }
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
      updateSubtitleTextAction(() => useTimelineStore.getState(), item.id, nextText);
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
    // Keys aimed at a control inside the clip (camera-motion badge, retry
    // download) belong to that control; preventing them here swallowed its
    // Enter / Space activation (UI3-03).
    if (e.target !== e.currentTarget) return;
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
  // Styles + filmstrip render — delegated to sibling modules (computeItemStyles
  // / TimelineItemFilmstrip) so this renderer stays lean; visuals unchanged.
  // ---------------------------------------------------------------------------

  // A press with the cut tool splits wherever it lands, so the edges must not
  // advertise a trim there.
  const visibleHoverZone: InteractionType = activeTool === 'cut' ? 'move' : hoverZone;

  // Locked lanes keep click-to-select, so they say "not allowed" (IM-05);
  // otherwise the cursor predicts what a press does at this spot (TL2-06).
  const itemCursor = isEditingSubtitle
    ? 'text'
    : isTrackLocked
    ? 'not-allowed'
    : isThisItemDragging
      ? 'grabbing'
      : visibleHoverZone === 'move' ? 'grab' : 'ew-resize';

  // The visible handles are exactly the drag machine's hit zones, and they
  // shrink (to nothing) on narrow clips so a 12px move zone always survives.
  const trimHandleWidth = edgeHandleWidthPx(width);
  const showTrimHandles =
    !isTrackLocked && !isEditingSubtitle && trimHandleWidth > 0 &&
    (isSelected || visibleHoverZone !== 'move');

  const getItemStyles = () =>
    computeItemStyles({
      item,
      trackHeight,
      left,
      width,
      isSelected,
      isThisItemDragging,
      isThisItemResizing,
      isSwapTarget,
      hasActiveSwapTarget,
      isLinked,
    });

  const renderFilmstrip = () => (
    <TimelineItemFilmstrip slots={filmstripSlots} posterUrl={item.thumbnailUrl} />
  );

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
                  <ClipName name={item.name} segment={segmentEntry} fontSize={fontSize} />
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
          <AudioClipBody
            item={item}
            width={width}
            trackHeight={trackHeight}
            clipHeight={Math.max(itemHeight, 16)}
            iconSize={iconSize}
            waveformAudioUrl={waveformAudioUrl}
            visibleSentenceCount={visibleSentenceCount}
            segmentEntry={segmentEntry}
          />
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

  // Hover text / accessible name. A linked clip leads with its segment
  // 「01 丝滑亮相 · {file} · {start}–{end}」; an unlinked one is unchanged.
  const startLabel = formatTimelineTime(item.startTime, { showMs: true });
  const endLabel = formatTimelineTime(item.startTime + item.duration, { showMs: true });
  const clipSummary = segmentEntry
    ? `${segmentEntry.label} · ${item.name} · ${startLabel}–${endLabel}`
    : null;

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
        (clipSummary ?? `${item.name} ${startLabel}–${endLabel}`) +
        `${isSelected ? ` (${t.timeline.track.selected})` : ''}` +
        `${isTrackLocked ? ` (${t.timeline.track.trackLocked})` : ''}` +
        `${isMaterialMissing ? ` (${t.timeline.track.materialMissing})` : ''}`
      }
      style={{
        ...getItemStyles(),
        cursor: itemCursor,
        ...(isMaterialMissing ? MISSING_MATERIAL_OUTLINE : {}),
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handleHoverMove}
      onPointerLeave={handleHoverLeave}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleItemKeyDown}
      className={
        'timeline-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1' +
        (isLinked ? ' ws-item-linked' : '')
      }
      data-clip-id={item.id}
      title={clipSummary ?? `${item.name} ${startLabel} - ${endLabel}`}
    >
      {coverMenu && createPortal(
        <div role="menu" className="ws-preflight" style={{ position: 'fixed', left: coverMenu.x, top: coverMenu.y, zIndex: 1000 }}
          onMouseDown={event => event.stopPropagation()} onMouseLeave={() => setCoverMenu(null)}
          onKeyDown={event => { if (event.key === 'Escape') setCoverMenu(null); }}>
          {[{ label: t.coverStudio.editCover, run: () => useTimelineStore.getState().onEditCover?.(item.id) },
            { label: t.coverStudio.setDuration, run: () => useTimelineStore.getState().onEditCover?.(item.id) },
            { label: t.coverStudio.removeCollapse, run: () => useTimelineStore.getState().onRemoveCover?.(true) },
            { label: t.coverStudio.removeOnly, run: () => useTimelineStore.getState().onRemoveCover?.(false) }].map((action, index) => (
              <button autoFocus={index === 0} key={action.label} role="menuitem" type="button" className="ws-btn ws-btn--ghost"
                onClick={event => { event.stopPropagation(); setCoverMenu(null); action.run(); }}>{action.label}</button>
            ))}
        </div>, document.querySelector('.editor-workbench') ?? document.body,
      )}

      {renderItemContent()}

      {isMaterialMissing && (
        <span
          role="img"
          aria-label={t.timeline.track.materialMissing}
          title={t.timeline.track.materialMissing}
          data-testid="clip-material-missing"
          className="absolute left-1 top-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full
            bg-red-600 text-[10px] font-bold leading-none text-white shadow-sm"
        >
          !
        </span>
      )}

      {/* 运镜徽标：已配置运镜的 clip 右上角一枚 12px 摄像机标，点击再次打开面板。
          stopPropagation 防止触发 clip 拖拽。 */}
      {item.cameraMotion && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (cameraMotionEnabled) onOpenCameraMotion?.(item.id);
          }}
          title={t.timeline.cameraMotion.badgeTitle.replace(
            '{preset}',
            presetLabel(item.cameraMotion.presetId, t.timeline.cameraMotion.presets),
          )}
          aria-label={t.timeline.cameraMotion.badgeTitle.replace(
            '{preset}',
            presetLabel(item.cameraMotion.presetId, t.timeline.cameraMotion.presets),
          )}
          className="absolute right-1 top-1 z-10 flex items-center gap-0.5 rounded bg-black/60 px-1 py-0.5
            text-[9px] font-medium leading-none text-white backdrop-blur-sm transition-colors hover:bg-black/80
            focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
          <span className="hidden sm:inline">
            {presetLabel(item.cameraMotion.presetId, t.timeline.cameraMotion.presets)}
          </span>
        </button>
      )}

      <TimelineItemDownloadOverlay
        item={item}
        localPreviewEnabled={localPreviewEnabled}
        localProxyStatusMap={localProxyStatusMap}
        onRetryLocalDownload={onRetryLocalDownload}
        labels={{
          localDownloading: t.timeline.track.localDownloading,
          localTranscoding: t.timeline.track.localTranscoding,
          localDownloadFailed: t.timeline.track.localDownloadFailed,
          localWillStream: t.timeline.track.localWillStream,
        }}
      />

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

      {/* Resize handles — DaVinci-style trim brackets, sized from the same
          edgeHandleWidthPx the drag machine hit-tests with. */}
      {showTrimHandles && (
        <>
          <div
            className="absolute left-0 top-0 h-full cursor-ew-resize bg-white/70 hover:bg-white transition-colors"
            style={{ width: `${trimHandleWidth}px`, borderRadius: '4px 0 0 4px' }}
          />
          <div
            className="absolute right-0 top-0 h-full cursor-ew-resize bg-white/70 hover:bg-white transition-colors"
            style={{ width: `${trimHandleWidth}px`, borderRadius: '0 4px 4px 0' }}
          />
        </>
      )}
    </div>
  );
};

export default TimelineItem;
