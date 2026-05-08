'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { selectPlaybackUrl } from '@/components/video/lib/selectPlaybackUrl';
import type { MaterialItem } from '@/types';
import CapturedFramesList from './CapturedFramesList';
import FrameScrubBar from './FrameScrubBar';
import useFrameExtraction, { DEFAULT_FRAME_CAP } from './useFrameExtraction';

// CORS allow-list for the <video crossOrigin="anonymous"> attribute.
// Tagging a no-CORS host taints the canvas AND can cause the metadata
// fetch to stall outright (the symptom that leaves the rail dead). Keep
// this list narrow: only hosts that are documented to advertise
// `Access-Control-Allow-Origin: *` on video objects belong here.
//   - videos.pexels.com / *.pexels.com → ✅ documented CORS
//   - ARK / TOS (volc...) → ❌ no CORS, must NOT be tagged
const KNOWN_CORS_FRIENDLY_SUFFIXES = ['.pexels.com', 'pexels.com'] as const;

function shouldTagCrossOrigin(playbackUrl: string): boolean {
  if (!playbackUrl) return false;
  if (typeof window === 'undefined') return false;
  let parsed: URL;
  try {
    parsed = new URL(playbackUrl, window.location.origin);
  } catch {
    return false;
  }
  if (parsed.origin === window.location.origin) return false;
  const host = parsed.hostname.toLowerCase();
  return KNOWN_CORS_FRIENDLY_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

function describeMediaError(err: MediaError | null | undefined): string | null {
  if (!err) return null;
  switch (err.code) {
    case 1: return 'Aborted';
    case 2: return 'Network error';
    case 3: return 'Decode error';
    case 4: return 'Source not supported (possible CORS block)';
    default: return err.message || 'Unknown error';
  }
}

interface FrameExtractorLayoutProps {
  source: MaterialItem;
  onBack: () => void;
  onDone: (frames: ReturnType<typeof useFrameExtraction>['frames']) => Promise<void>;
  isSaving: boolean;
  errorMessage?: string | null;
}

const FrameExtractorLayout: React.FC<FrameExtractorLayoutProps> = ({
  source,
  onBack,
  onDone,
  isSaving,
  errorMessage,
}) => {
  const { t } = useLocale();
  const fe = t.videoProcessing.frameExtraction;
  const [duration, setDuration] = useState<number>(source.duration ?? 0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { videoRef, frames, capture, remove, isAtCap } = useFrameExtraction({
    source,
    maxFrames: DEFAULT_FRAME_CAP,
    onCaptureError: (msg) => setLoadError(msg),
  });

  const playbackUrl = useMemo(
    () => selectPlaybackUrl(source, { purpose: 'preview' }),
    [source],
  );

  const tagCrossOrigin = useMemo(() => shouldTagCrossOrigin(playbackUrl), [playbackUrl]);

  // Whenever the source changes, sync duration from the actual <video>.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onMeta = () => {
      if (video.duration && isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };
    video.addEventListener('loadedmetadata', onMeta);
    if (video.readyState >= 1) onMeta();
    return () => video.removeEventListener('loadedmetadata', onMeta);
  }, [videoRef, playbackUrl]);

  useEffect(() => {
    setLoadError(null);
  }, [playbackUrl]);

  const handleVideoError = () => {
    const reason = describeMediaError(videoRef.current?.error);
    setLoadError(reason ?? 'Video failed to load');
  };

  const handleSeek = (timestampSec: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, timestampSec);
    video.pause();
  };

  const handleDone = async () => {
    if (frames.length === 0) return;
    await onDone(frames);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <button
          type="button"
          onClick={onBack}
          disabled={isSaving}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t.videoProcessing.buttons.back}
        </button>
        <div className="text-xs font-medium text-foreground truncate max-w-[60%]" title={source.name}>
          {source.name}
        </div>
        <div className="flex items-center gap-2">
          {isAtCap && (
            <span className="text-[10px] text-amber-600">
              {fe?.capReached.replace('{max}', String(DEFAULT_FRAME_CAP))}
            </span>
          )}
          <button
            type="button"
            onClick={handleDone}
            disabled={frames.length === 0 || isSaving}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              frames.length === 0 || isSaving
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {isSaving ? fe?.saving : fe?.done}
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="px-4 py-2 text-xs text-destructive bg-destructive/5 border-b border-destructive/20">
          {errorMessage}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-[1fr_280px]">
        <div className="flex flex-col min-h-0 border-r border-border">
          <div className="flex-1 min-h-0 bg-black flex items-center justify-center">
            {playbackUrl ? (
              <video
                ref={videoRef}
                src={playbackUrl}
                playsInline
                {...(tagCrossOrigin ? { crossOrigin: 'anonymous' as const } : {})}
                onError={handleVideoError}
                className="max-h-full max-w-full"
              />
            ) : (
              <span className="text-muted-foreground text-sm">{t.materialsPanel.noVideoMaterials}</span>
            )}
          </div>
          {loadError && (
            <div className="px-3 py-1.5 text-[11px] text-destructive bg-destructive/5 border-t border-destructive/20">
              {loadError}
            </div>
          )}
          <FrameScrubBar
            videoRef={videoRef}
            duration={duration}
            onCapture={capture}
            isAtCap={isAtCap}
            capturedTimestamps={frames.map((f) => f.timestampSec)}
          />
        </div>

        <div className="flex flex-col min-h-0">
          <CapturedFramesList
            frames={frames}
            maxFrames={DEFAULT_FRAME_CAP}
            onRemove={remove}
            onSeek={handleSeek}
          />
        </div>
      </div>
    </div>
  );
};

export default FrameExtractorLayout;
