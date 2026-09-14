'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  useTimelineStore,
  setTrackVolumePreviewAction,
  commitTrackVolumeAction,
} from './store';
import { revertTrackVolumePreviewAction } from './store/actions/trackActions';
import { useLocale } from '@/contexts/LocaleContext';
import { deriveTrackDisplayName } from './trackDisplayName';
import { trackMouseGesture } from './lib/mouseGesture';

/**
 * VolumeSlider — Track volume control popover.
 *
 * Reads visibility / position / trackId from `useTimelineStore.showVolumeSlider`.
 * While dragging / keyboard-stepping it pushes the live value through
 * `setTrackVolumePreviewAction` (rAF-throttled, no undo entry) so the
 * composition preview audio follows the slider in real time, then calls
 * `commitTrackVolumeAction` once on release to record the single undo entry for
 * the gesture. The commit restores the pre-gesture value before snapshotting
 * history, so Undo reverts to where the gesture started (not a mid-drag frame
 * left behind by the live-preview writes). Calls `store.hideVolumeSlider` on
 * close.
 *
 * No props required — everything comes from the store.
 */

const VolumeSlider: React.FC = () => {
  const { t } = useLocale();
  const showVolumeSlider = useTimelineStore(s => s.showVolumeSlider);
  const tracks = useTimelineStore(s => s.tracks);
  const hideVolumeSlider = useTimelineStore(s => s.hideVolumeSlider);

  const sliderRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [displayVolume, setDisplayVolume] = useState(100);
  const isDraggingRef = useRef(false);
  const localVolumeRef = useRef(100);
  // track.volume captured at the START of the current gesture. The live-preview
  // channel mutates the store every drag/keyboard tick, so the commit on release
  // restores this value first → one gesture undoes to its pre-gesture value.
  const preGestureVolumeRef = useRef(100);
  // Keyboard step coalescing: one undo entry per ~300 ms window.
  const keyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVolumeRef = useRef<number>(100);
  // Bug 3: guard auto-focus race — only allow blur-close after focus has landed
  const hasBeenFocusedRef = useRef(false);

  // Derive track volume from store
  const trackId = showVolumeSlider?.trackId ?? null;
  const position = showVolumeSlider?.position ?? { x: 0, y: 0 };
  const isVisible = showVolumeSlider !== null;

  const trackData = tracks.find(t => t.id === trackId);
  const volume = trackData?.volume ?? 100;
  const isLocked = trackData?.isLocked ?? false;
  const trackDisplayName = trackData
    ? deriveTrackDisplayName(trackData, t.timeline.track)
    : '';
  const popoverId = trackId ? `volume-popover-${trackId}` : undefined;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync external volume when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setDisplayVolume(volume);
      localVolumeRef.current = volume;
      pendingVolumeRef.current = volume;
    }
  }, [volume]);

  // Return focus to whatever opened the popover (the track's volume button).
  // Track.tsx unmounts this component on close, so the hand-back runs in the
  // unmount cleanup. A layout effect captures the opener before the
  // focus-on-open frame below moves focus into the popover. Focus the user
  // already moved elsewhere (a click, Tab) is left alone.
  useLayoutEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const active = document.activeElement;
      const focusWasInPopover =
        active === null ||
        active === document.body ||
        !active.isConnected ||
        // Read at unmount on purpose: the popover node mounts after this
        // effect (the `mounted` gate), so a copy taken here would be null.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        sliderRef.current?.contains(active) === true;
      if (focusWasInPopover && opener?.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  // Focus-on-open: schedule rAF only; cleanup cancels rAF, no focus side-effect.
  useEffect(() => {
    if (!isVisible || isLocked || !mounted) return;
    let cancelled = false;
    let rafId: number | null = null;
    // Two-stage delay: microtask runs after the current commit; rAF runs on
    // the next paint. By that point the portal child is in the DOM and
    // `trackRef.current` resolves.
    const run = () => {
      if (cancelled) return;
      rafId = requestAnimationFrame(() => {
        if (!cancelled) trackRef.current?.focus();
      });
    };
    queueMicrotask(run);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isVisible, isLocked, mounted]);

  // Bug 3: reset focus-guard whenever the popover is hidden
  useEffect(() => {
    if (!isVisible) hasBeenFocusedRef.current = false;
  }, [isVisible]);

  const calculateVolume = useCallback((clientX: number) => {
    if (!trackRef.current) return localVolumeRef.current;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * 200);
  }, []);

  const updateVolume = useCallback((newVolume: number) => {
    localVolumeRef.current = newVolume;
    setDisplayVolume(newVolume);
  }, []);

  // Live-preview channel: while a gesture is in progress, push the value to the
  // store via a NO-HISTORY setter so the composition preview audio follows in
  // real time. Coalesced through requestAnimationFrame because mousemove can
  // fire at 60-120 Hz and each write re-runs useTimelineComposition's full
  // signature rebuild — an unthrottled write would stutter on busy timelines.
  const livePreviewRafRef = useRef<number | null>(null);
  const livePreviewValueRef = useRef<number>(100);

  const cancelLivePreview = useCallback(() => {
    if (livePreviewRafRef.current === null) return;
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(livePreviewRafRef.current);
    }
    livePreviewRafRef.current = null;
  }, []);

  const scheduleLivePreview = useCallback((vol: number) => {
    if (!trackId) return;
    livePreviewValueRef.current = vol;
    if (typeof requestAnimationFrame === 'undefined') {
      setTrackVolumePreviewAction(() => useTimelineStore.getState(), trackId, vol);
      return;
    }
    if (livePreviewRafRef.current !== null) return; // already scheduled this frame
    livePreviewRafRef.current = requestAnimationFrame(() => {
      livePreviewRafRef.current = null;
      if (trackId) {
        setTrackVolumePreviewAction(
          () => useTimelineStore.getState(),
          trackId,
          livePreviewValueRef.current,
        );
      }
    });
  }, [trackId]);

  // Cancel any pending live-preview frame on unmount.
  useEffect(() => cancelLivePreview, [cancelLivePreview]);

  // Document listeners of the pointer / touch drag in flight.
  const dragDisposeRef = useRef<(() => void) | null>(null);

  /**
   * Abandon an in-flight drag (Escape, window blur, touchcancel, unmount): the
   * live preview goes back to the pre-gesture value and no history is written.
   */
  const cancelDrag = useCallback(() => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    dragDisposeRef.current?.();
    dragDisposeRef.current = null;
    cancelLivePreview();
    if (trackId) {
      revertTrackVolumePreviewAction(
        () => useTimelineStore.getState(),
        trackId,
        preGestureVolumeRef.current,
      );
    }
    updateVolume(preGestureVolumeRef.current);
  }, [cancelLivePreview, trackId, updateVolume]);
  // Document listeners and the unmount cleanup always reach the latest closure.
  const cancelDragRef = useRef(cancelDrag);
  cancelDragRef.current = cancelDrag;

  // The popover closes (unmounts) on outside interaction; a drag still held
  // at that point must not leave its preview value behind.
  useEffect(() => () => cancelDragRef.current(), []);

  /** A released drag commits once: restores pre-gesture, then records the final value. */
  const finishDrag = useCallback(() => {
    dragDisposeRef.current = null;
    isDraggingRef.current = false;
    cancelLivePreview();
    if (trackId) {
      commitTrackVolumeAction(
        () => useTimelineStore.getState(),
        trackId,
        preGestureVolumeRef.current,
        localVolumeRef.current,
      );
    }
  }, [cancelLivePreview, trackId]);

  // Commit any pending keyboard-stepped volume immediately. Clears the timer
  // and nulls the ref before dispatch so a re-entrant call cannot double-commit.
  const flushPendingKeyCommit = useCallback(() => {
    if (!keyCommitTimerRef.current) return;
    clearTimeout(keyCommitTimerRef.current);
    keyCommitTimerRef.current = null;
    if (trackId) {
      commitTrackVolumeAction(
        () => useTimelineStore.getState(),
        trackId,
        preGestureVolumeRef.current,
        pendingVolumeRef.current,
      );
    }
  }, [trackId]);

  // Schedule a trailing 300 ms commit. Subsequent keystrokes reset the timer
  // so a burst coalesces into a single undo entry.
  const scheduleKeyCommit = useCallback((v: number) => {
    pendingVolumeRef.current = v;
    if (keyCommitTimerRef.current) clearTimeout(keyCommitTimerRef.current);
    keyCommitTimerRef.current = setTimeout(() => {
      keyCommitTimerRef.current = null;
      if (trackId) {
        commitTrackVolumeAction(
          () => useTimelineStore.getState(),
          trackId,
          preGestureVolumeRef.current,
          pendingVolumeRef.current,
        );
      }
    }, 300);
  }, [trackId]);

  // Click-outside + Escape handler. Flush any pending keyboard commit so the
  // undo entry lands before the popover closes.
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (isDraggingRef.current) return;
      const target = event.target as Node;
      if (sliderRef.current && sliderRef.current.contains(target)) return;

      // Let the owning volume button's onClick drive the toggle —
      // otherwise we race with it and cannot close on a second click.
      if (popoverId) {
        const owner = document.querySelector<HTMLElement>(
          `[aria-controls~="${CSS.escape(popoverId)}"]`,
        );
        if (owner && owner.contains(target)) return;
      }

      flushPendingKeyCommit();
      hideVolumeSlider();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // stopImmediatePropagation is required: the TimelinePanel global
        // keydown handler is also bound to document and would otherwise
        // still run and call deselectAll. stopPropagation alone does NOT
        // block other listeners on the same target.
        event.stopImmediatePropagation();
        event.preventDefault();
        // Escape mid-drag abandons the drag only; a second Escape closes.
        if (isDraggingRef.current) {
          cancelDragRef.current();
          return;
        }
        flushPendingKeyCommit();
        hideVolumeSlider();
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isVisible, hideVolumeSlider, flushPendingKeyCommit, popoverId]);

  // Flush pending commit on unmount and when trackId changes while the popover
  // stays open (popover swapped to a different track's volume button).
  // The [trackId] dep is load-bearing: the cleanup's closure captures the
  // old trackId so the pending volume commits to the correct track before
  // the new one takes over.
  useEffect(() => {
    return () => {
      if (!keyCommitTimerRef.current) return;
      clearTimeout(keyCommitTimerRef.current);
      keyCommitTimerRef.current = null;
      if (trackId) {
        commitTrackVolumeAction(
          () => useTimelineStore.getState(),
          trackId,
          preGestureVolumeRef.current,
          pendingVolumeRef.current,
        );
      }
    };
  }, [trackId]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isLocked) {
      // Locked tracks: block drag AND suppress focus so arrow keys don't act.
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    // preventDefault suppresses the default focus change that mousedown
    // would otherwise trigger on a focusable element; restore it so keyboard
    // users can follow a mouse click with Home/End/Arrow etc.
    (e.currentTarget as HTMLDivElement).focus();
    isDraggingRef.current = true;
    // Captured before any live-preview write so the gesture undoes to its start.
    // localVolumeRef tracks store.volume while not dragging (sync effect above).
    preGestureVolumeRef.current = localVolumeRef.current;

    // If mousedown lands on the thumb, do NOT jump to the click position;
    // drag continues via mousemove. Thumb is w-5 (20px) with translate(-50%)
    // so centre is at (localVolumeRef/200)*width and hit radius is 10px.
    const rect = trackRef.current?.getBoundingClientRect();
    if (rect) {
      const thumbCenterPx = rect.left + (localVolumeRef.current / 200) * rect.width;
      const THUMB_RADIUS_PX = 10;
      const onThumb = Math.abs(e.clientX - thumbCenterPx) <= THUMB_RADIUS_PX;
      if (!onThumb) {
        const newVolume = calculateVolume(e.clientX);
        updateVolume(newVolume);
      }
    } else {
      const newVolume = calculateVolume(e.clientX);
      updateVolume(newVolume);
    }

    dragDisposeRef.current?.();
    dragDisposeRef.current = trackMouseGesture({
      onMove: (moveEvent) => {
        moveEvent.preventDefault();
        const vol = calculateVolume(moveEvent.clientX);
        updateVolume(vol);
        scheduleLivePreview(vol);
      },
      onEnd: finishDrag,
      onCancel: () => cancelDragRef.current(),
    });
  }, [calculateVolume, updateVolume, scheduleLivePreview, finishDrag, isLocked]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isLocked) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      return;
    }
    e.stopPropagation();
    isDraggingRef.current = true;
    // Captured before any live-preview write so the gesture undoes to its start.
    preGestureVolumeRef.current = localVolumeRef.current;

    const touch = e.touches[0];
    const newVolume = calculateVolume(touch.clientX);
    updateVolume(newVolume);

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const vol = calculateVolume(t.clientX);
      updateVolume(vol);
      scheduleLivePreview(vol);
    };

    const removeTouchListeners = () => {
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
    };

    const handleTouchEnd = () => {
      removeTouchListeners();
      finishDrag();
    };

    const handleTouchCancel = () => cancelDragRef.current();

    dragDisposeRef.current?.();
    dragDisposeRef.current = removeTouchListeners;
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchCancel);
  }, [calculateVolume, updateVolume, scheduleLivePreview, finishDrag, isLocked]);

  if (!mounted || !isVisible) return null;

  const getVolumeIcon = () => {
    if (displayVolume === 0) {
      return (
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      );
    } else if (displayVolume < 50) {
      return (
        <path d="M3 9v6h4l5 5V4L7 9H3z"/>
      );
    } else if (displayVolume < 100) {
      return (
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
      );
    } else {
      return (
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      );
    }
  };

  // Gradient: green up to 100%, yellow for boost range
  const gradientPercent = displayVolume / 2; // 0-200 -> 0%-100% of slider track
  const mark100Percent = 50; // 100% volume = 50% of slider width

  const trackBackground = displayVolume <= 100
    ? `linear-gradient(to right, #10b981 0%, #10b981 ${gradientPercent}%, var(--muted) ${gradientPercent}%, var(--muted) 100%)`
    : `linear-gradient(to right, #10b981 0%, #10b981 ${mark100Percent}%, #f59e0b ${mark100Percent}%, #f59e0b ${gradientPercent}%, var(--muted) ${gradientPercent}%, var(--muted) 100%)`;

  const thumbLeft = gradientPercent; // 0-100%

  // Viewport-edge clamp. Popover is ~200px × ~140px; 8px safe margin.
  const MARGIN = 8;
  const POPOVER_W = 200;
  const POPOVER_H = 140; // conservative: icon row + slider + ticks + padding + arrow
  const vpW = typeof window !== 'undefined' ? window.innerWidth : POPOVER_W;
  const vpH = typeof window !== 'undefined' ? window.innerHeight : POPOVER_H;

  const halfW = POPOVER_W / 2;
  let clampedLeft = position.x;
  if (position.x - halfW < MARGIN) clampedLeft = MARGIN + halfW;
  if (position.x + halfW > vpW - MARGIN) clampedLeft = vpW - MARGIN - halfW;

  // Default: anchor ABOVE (translateY(-100%)). If clipping the top, anchor BELOW.
  const anchorBelow = position.y - POPOVER_H < MARGIN;
  const clampedTop = anchorBelow
    ? Math.min(position.y + 24, vpH - MARGIN - POPOVER_H)
    : position.y;

  const sliderContent = (
    <div
      ref={sliderRef}
      id={popoverId}
      role="dialog"
      aria-modal="false"
      aria-label={trackDisplayName
        ? `${t.timeline.toolbar.volumeControl} - ${trackDisplayName}`
        : t.timeline.toolbar.volumeControl}
      className="fixed bg-background text-foreground rounded-lg p-3 w-[200px] border border-border shadow-lg"
      style={{
        zIndex: 999999,
        left: clampedLeft,
        top: clampedTop,
        transform: anchorBelow
          ? 'translateX(-50%) translateY(0)'
          : 'translateX(-50%) translateY(-100%)',
      }}
      onFocus={() => { hasBeenFocusedRef.current = true; }}
      onBlur={(e) => {
        // Only close after focus has actually landed inside at least once.
        if (!hasBeenFocusedRef.current) return;
        // If focus is moving to another element INSIDE the dialog, don't close.
        const next = e.relatedTarget as Node | null;
        if (next && sliderRef.current?.contains(next)) return;
        // Focus left the dialog → treat like outside-click.
        flushPendingKeyCommit();
        hideVolumeSlider();
      }}
    >
      {/* Volume icon and value */}
      <div className="flex items-center justify-between mb-2">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          {getVolumeIcon()}
        </svg>
        <span className="text-xs font-medium tabular-nums">{displayVolume}%</span>
      </div>

      {/* Custom volume slider */}
      <div className="relative">
        <div
          ref={trackRef}
          role="slider"
          tabIndex={isLocked ? -1 : 0}
          aria-disabled={isLocked || undefined}
          aria-label={trackDisplayName
            ? `${t.timeline.toolbar.volumeControl} - ${trackDisplayName}`
            : t.timeline.toolbar.volumeControl}
          aria-valuemin={0}
          aria-valuemax={200}
          aria-valuenow={displayVolume}
          aria-valuetext={`${displayVolume}%`}
          className={`relative w-full h-3 rounded-md select-none focus:outline-none focus:ring-2 focus:ring-emerald-500 ${isLocked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          style={{ background: trackBackground }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onKeyDown={(e) => {
            if (isLocked) return;
            let next = displayVolume;
            let handled = true;
            const step = e.shiftKey ? 10 : 1;
            switch (e.key) {
              case 'ArrowRight':
              case 'ArrowUp':
                next = Math.min(200, displayVolume + step);
                break;
              case 'ArrowLeft':
              case 'ArrowDown':
                next = Math.max(0, displayVolume - step);
                break;
              case 'Home': next = 0; break;
              case 'End':  next = 200; break;
              case 'PageUp':   next = Math.min(200, displayVolume + 10); break;
              case 'PageDown': next = Math.max(0,   displayVolume - 10); break;
              default: handled = false;
            }
            if (handled) {
              e.preventDefault();
              e.stopPropagation();
              // First keystroke of a new burst: remember the pre-gesture volume
              // so the coalesced commit undoes to where the burst started.
              if (keyCommitTimerRef.current === null) {
                preGestureVolumeRef.current = volume;
              }
              updateVolume(next);
              scheduleLivePreview(next);
              scheduleKeyCommit(next);
            }
          }}
          onBlur={flushPendingKeyCommit}
        >
          {/* Thumb */}
          <div
            className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-emerald-500 shadow-md pointer-events-none"
            style={{
              left: `${thumbLeft}%`,
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.3)'
            }}
          />
        </div>
        {/* 100% mark line */}
        <div
          className="absolute top-0 h-3 w-px bg-foreground-a/30 pointer-events-none"
          style={{ left: '50%' }}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
      </div>

      {/* Arrow indicator — flips when anchored below */}
      {anchorBelow ? (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2">
          <div className="w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-background"></div>
        </div>
      ) : (
        <div className="absolute top-full left-1/2 transform -translate-x-1/2">
          <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
        </div>
      )}
    </div>
  );

  return createPortal(sliderContent, document.body);
};

export default VolumeSlider;
