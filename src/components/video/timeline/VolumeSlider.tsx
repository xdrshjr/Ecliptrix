'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTimelineStore } from './store';

/**
 * VolumeSlider — Track volume control popover.
 *
 * Reads visibility / position / trackId from `useTimelineStore.showVolumeSlider`.
 * Calls `store.setTrackVolume` on change and `store.hideVolumeSlider` on close.
 *
 * No props required — everything comes from the store.
 */

const VolumeSlider: React.FC = () => {
  const showVolumeSlider = useTimelineStore(s => s.showVolumeSlider);
  const tracks = useTimelineStore(s => s.tracks);
  const setTrackVolume = useTimelineStore(s => s.setTrackVolume);
  const hideVolumeSlider = useTimelineStore(s => s.hideVolumeSlider);

  const sliderRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [displayVolume, setDisplayVolume] = useState(100);
  const isDraggingRef = useRef(false);
  const localVolumeRef = useRef(100);

  // Derive track volume from store
  const trackId = showVolumeSlider?.trackId ?? null;
  const position = showVolumeSlider?.position ?? { x: 0, y: 0 };
  const isVisible = showVolumeSlider !== null;

  const trackData = tracks.find(t => t.id === trackId);
  const volume = trackData?.volume ?? 100;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync external volume when not dragging
  useEffect(() => {
    if (!isDraggingRef.current) {
      setDisplayVolume(volume);
      localVolumeRef.current = volume;
    }
  }, [volume]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDraggingRef.current) return;

      const target = event.target as Node;

      if (sliderRef.current && sliderRef.current.contains(target)) {
        return;
      }

      hideVolumeSlider();
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isVisible, hideVolumeSlider]);

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

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    isDraggingRef.current = true;

    const newVolume = calculateVolume(e.clientX);
    updateVolume(newVolume);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const vol = calculateVolume(moveEvent.clientX);
      updateVolume(vol);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      if (trackId) {
        setTrackVolume(trackId, localVolumeRef.current);
      }
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [calculateVolume, updateVolume, setTrackVolume, trackId]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    isDraggingRef.current = true;

    const touch = e.touches[0];
    const newVolume = calculateVolume(touch.clientX);
    updateVolume(newVolume);

    const handleTouchMove = (moveEvent: TouchEvent) => {
      moveEvent.preventDefault();
      const t = moveEvent.touches[0];
      const vol = calculateVolume(t.clientX);
      updateVolume(vol);
    };

    const handleTouchEnd = () => {
      isDraggingRef.current = false;
      if (trackId) {
        setTrackVolume(trackId, localVolumeRef.current);
      }
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };

    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
  }, [calculateVolume, updateVolume, setTrackVolume, trackId]);

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

  const sliderContent = (
    <div
      ref={sliderRef}
      className="fixed bg-background text-foreground rounded-lg p-3 w-[200px] border border-border shadow-lg"
      style={{
        zIndex: 999999,
        left: position.x,
        top: position.y,
        transform: 'translateX(-50%) translateY(-100%)'
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
          className="relative w-full h-3 rounded-md cursor-pointer select-none"
          style={{ background: trackBackground }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
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
          className="absolute top-0 h-3 w-px bg-foreground/30 pointer-events-none"
          style={{ left: '50%' }}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
      </div>

      {/* Arrow indicator */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
        <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-background"></div>
      </div>
    </div>
  );

  return createPortal(sliderContent, document.body);
};

export default VolumeSlider;
