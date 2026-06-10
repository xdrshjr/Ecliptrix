'use client';

import React from 'react';
import type { TimelineItemData } from './domain/types';
import type { LocalProxyStatus } from '@/types';

/**
 * Round-2 local-download state for a material, fed down from the authoritative
 * `materials` list (same source as the readiness gate — C4, no dual data
 * source). See docs/plans/video-editor-client-preview-download/spec.md §3.3.7.
 */
export interface LocalProxyMaskState {
  status?: LocalProxyStatus;
  progress?: number;
}

interface TimelineItemDownloadOverlayProps {
  item: TimelineItemData;
  localPreviewEnabled?: boolean;
  localProxyStatusMap?: Map<string, LocalProxyMaskState>;
  onRetryLocalDownload?: (materialId: string) => void;
  /** Locale strings for the track download labels. */
  labels: {
    localDownloading: string;
    localTranscoding: string;
    localDownloadFailed: string;
    localWillStream: string;
  };
}

/**
 * Round-3 local-download visualization (spec docs/plans/
 * video-editor-track-download-progress/spec.md §3.3.3, G2). The CLIP BAR ITSELF
 * acts as the progress bar: while downloading, the already-downloaded portion
 * (0→progress%) keeps the bar's own colour and the not-yet-downloaded portion
 * (progress%→100%) is dimmed, with a thin highlight line at the boundary and a
 * small unobtrusive badge. transcoding → indeterminate pulse; error → red +
 * retry; degraded → amber + retry; ready/idle/undefined → no overlay.
 *
 * Only for video/audio clips (C2: image/subtitle excluded). Status comes from
 * the authoritative `materials`-derived map (same source as the readiness gate
 * — no dual data source, C4). The map is already filtered to video/audio
 * MATERIALS upstream (TimelinePanel localProxyStatusMap), so an image dropped on
 * a video track has no entry → status === undefined → returns null (P2-3).
 *
 * Extracted verbatim from TimelineItem (`renderLocalDownloadOverlay`);
 * behaviour unchanged.
 */
const TimelineItemDownloadOverlay: React.FC<TimelineItemDownloadOverlayProps> = ({
  item,
  localPreviewEnabled,
  localProxyStatusMap,
  onRetryLocalDownload,
  labels,
}) => {
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
          {labels.localDownloading} {pct}%
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
          <span className="truncate">{labels.localTranscoding}</span>
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
        title={isError ? labels.localDownloadFailed : labels.localWillStream}
      >
        {isError ? labels.localDownloadFailed : labels.localWillStream}
      </button>
    </div>
  );
};

export default TimelineItemDownloadOverlay;
