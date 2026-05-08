'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

interface FrameScrubBarProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  duration: number;
  onCapture: () => void;
  isAtCap: boolean;
  capturedTimestamps: number[];
  /** Frame rate hint used by the ±1-frame stepper. Falls back to 30 fps. */
  frameRate?: number;
}

function formatTimestamp(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00.00';
  const minutes = Math.floor(sec / 60);
  const remainder = sec - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

const FrameScrubBar: React.FC<FrameScrubBarProps> = ({
  videoRef,
  duration,
  onCapture,
  isAtCap,
  capturedTimestamps,
  frameRate,
}) => {
  const { t } = useLocale();
  const fe = t.videoProcessing.frameExtraction;
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  // Single reactive source of truth for the rail's positioning quantity.
  // Seeded from prop, then refreshed by loadedmetadata/durationchange so the
  // visual cursor, progress fill and capture markers don't sit at 0 while
  // the click-handlers happily seek via the <video> element fallback.
  const seedDuration = duration > 0 && Number.isFinite(duration) ? duration : 0;
  const [effectiveDuration, setEffectiveDuration] = useState<number>(seedDuration);
  const railRef = useRef<HTMLDivElement | null>(null);

  // Track currentTime / playback state and keep effectiveDuration in sync
  // with the actual <video> element (covers late-arriving duration on some
  // MP4s via durationchange).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => setCurrentTime(video.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const syncDuration = () => {
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) setEffectiveDuration(d);
    };
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', syncDuration);
    video.addEventListener('durationchange', syncDuration);
    if (video.readyState >= 1) syncDuration();
    return () => {
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', syncDuration);
      video.removeEventListener('durationchange', syncDuration);
    };
  }, [videoRef]);

  // Mirror prop changes into state when the prop tightens an upper bound.
  useEffect(() => {
    if (duration > 0 && Number.isFinite(duration) && duration !== effectiveDuration) {
      setEffectiveDuration(duration);
    }
    // Intentionally only depends on `duration` — we don't want a state update
    // to retrigger this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const stepFrame = (direction: 1 | -1) => {
    const video = videoRef.current;
    if (!video) return;
    const fps = frameRate && frameRate > 0 ? frameRate : 30;
    const delta = direction / fps;
    video.pause();
    const upper = effectiveDuration > 0 ? effectiveDuration : video.duration || 0;
    video.currentTime = Math.min(upper, Math.max(0, video.currentTime + delta));
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  };

  // Drag-scrub state. We remember whether the video was playing when the
  // user grabbed the rail so we can resume from where they release.
  const dragWasPlayingRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Resolve duration with one last element-fallback, in case the click
  // arrives between metadata load and the next React render.
  const resolveDuration = (video: HTMLVideoElement): number => {
    if (effectiveDuration > 0) return effectiveDuration;
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    return 0;
  };

  const seekFromClientX = (clientX: number) => {
    const rail = railRef.current;
    const video = videoRef.current;
    if (!rail || !video) return;
    const effective = resolveDuration(video);
    if (!effective) return;
    const rect = rail.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.currentTime = ratio * effective;
  };

  const onRailPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    const video = videoRef.current;
    if (!railRef.current || !video) return;
    if (!resolveDuration(video)) return;
    // Capture on the outer wrapper (the element receiving the event) so
    // pointermove / pointerup keep firing even when the cursor leaves it
    // or the window entirely.
    event.currentTarget.setPointerCapture(event.pointerId);
    isDraggingRef.current = true;
    dragWasPlayingRef.current = !video.paused;
    if (!video.paused) video.pause();
    seekFromClientX(event.clientX);
    event.preventDefault();
  };

  const onRailPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    seekFromClientX(event.clientX);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const video = videoRef.current;
    if (video && dragWasPlayingRef.current) {
      video.play().catch(() => undefined);
    }
    dragWasPlayingRef.current = false;
  };

  // Keyboard shortcuts (Space, ←/→, C). Bind on the wrapper div so they only
  // fire while the scrub bar is focused.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.code === 'Space') {
      event.preventDefault();
      togglePlay();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      stepFrame(-1);
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      stepFrame(1);
    } else if (event.code === 'KeyC') {
      event.preventDefault();
      if (!isAtCap) onCapture();
    }
  };

  const ratio = effectiveDuration > 0 ? Math.min(1, currentTime / effectiveDuration) : 0;
  const hasUsableDuration = effectiveDuration > 0;

  return (
    <div
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="border-t border-border bg-card px-3 py-2 flex flex-col gap-2 outline-none focus:ring-1 focus:ring-primary/30"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={togglePlay}
          className="px-2 py-1 rounded bg-muted hover:bg-accent text-foreground"
          title={fe?.playPause}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          onClick={() => stepFrame(-1)}
          className="px-2 py-1 rounded bg-muted hover:bg-accent text-foreground"
          title={fe?.previousFrame}
        >
          ⟨
        </button>
        <button
          type="button"
          onClick={() => stepFrame(1)}
          className="px-2 py-1 rounded bg-muted hover:bg-accent text-foreground"
          title={fe?.nextFrame}
        >
          ⟩
        </button>
        <span className="font-mono">
          {formatTimestamp(currentTime)} / {formatTimestamp(effectiveDuration)}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {fe?.seekHint}
        </span>
        <button
          type="button"
          onClick={onCapture}
          disabled={isAtCap}
          className={`ml-2 px-3 py-1 rounded text-xs font-medium transition-colors ${
            isAtCap
              ? 'bg-muted text-muted-foreground cursor-not-allowed'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          📸 {fe?.capture}
        </button>
      </div>

      {/* Outer pointer-target: 28 px tall (h-2 rail + py-2.5 padding) so the
          user has a comfortable Fitts-law hit zone, while the visible rail
          stays 8 px. setPointerCapture is on this element so drags continue
          to fire pointermove / pointerup even when the cursor leaves it. */}
      <div
        onPointerDown={onRailPointerDown}
        onPointerMove={onRailPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`relative py-2.5 touch-none select-none ${
          hasUsableDuration ? 'cursor-pointer' : 'cursor-wait opacity-60'
        }`}
        aria-disabled={!hasUsableDuration}
      >
        {!hasUsableDuration && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground pointer-events-none">
            {fe?.loadingDuration}
          </span>
        )}
        <div
          ref={railRef}
          className="relative h-2 rounded bg-muted"
        >
          <div
            className="absolute inset-y-0 left-0 bg-primary/40 rounded pointer-events-none"
            style={{ width: `${ratio * 100}%` }}
          />
          {/* Capture markers */}
          {effectiveDuration > 0 &&
            capturedTimestamps.map((ts, i) => {
              const left = Math.min(100, Math.max(0, (ts / effectiveDuration) * 100));
              return (
                <span
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 w-1 h-3.5 bg-amber-500 rounded-sm pointer-events-none"
                  style={{ left: `calc(${left}% - 2px)` }}
                />
              );
            })}
          {/* Cursor */}
          <span
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background pointer-events-none"
            style={{ left: `calc(${ratio * 100}% - 6px)` }}
          />
        </div>
      </div>
    </div>
  );
};

export default FrameScrubBar;
