'use client';

import React, {
  useEffect,
  useRef,
  useCallback,
  useState,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import type { SilenceSegment } from './SilenceSegmentList';
import { useLocale } from '@/contexts/LocaleContext';
import { fetchWaveform } from '@/components/video/lib/waveform/waveformClient';

// wavesurfer.js v7+ imports
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions';

// ---- Types ----

export interface WaveformPreviewProps {
  audioUrl: string;
  segments: SilenceSegment[];
  selectedIds: Set<string>;
  onSegmentUpdate: (id: string, start: number, end: number) => void;
  focusSegmentId: string | null;
  onFocusHandled: () => void;
  /**
   * spec 04 — when provided, the component first tries the persisted backend
   * peaks for this material (no in-browser decode). On a miss it falls back to
   * wavesurfer live decode of `audioUrl`, preserving prior behaviour.
   */
  materialId?: string;
}

/** Methods exposed to parent via ref */
export interface WaveformPreviewHandle {
  /** Play a segment with 1s context before/after */
  playSegmentContext: (segmentId: string) => void;
}

// ---- Color constants ----

const COLORS = {
  light: {
    waveColor: '#4a90d9',
    progressColor: '#2563eb',
  },
  dark: {
    waveColor: '#6bb5ff',
    progressColor: '#3b82f6',
  },
  region: {
    selected: 'rgba(255, 0, 0, 0.15)',     // red = will be removed
    deselected: 'rgba(128, 128, 128, 0.1)', // gray = kept
  },
};

// ---- Component ----

const WaveformPreview = forwardRef<WaveformPreviewHandle, WaveformPreviewProps>(
  (
    {
      audioUrl,
      segments,
      selectedIds,
      onSegmentUpdate,
      focusSegmentId,
      onFocusHandled,
      materialId,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const regionsPluginRef = useRef<RegionsPlugin | null>(null);
    const { t } = useLocale();

    // spec 04: persisted peaks (camelCase doc) loaded before wavesurfer init so
    // the player can skip in-browser decode. null until resolved / on a miss.
    const [persistedPeaks, setPersistedPeaks] = useState<{
      peaks: number[];
      durationSec: number;
    } | null>(null);
    // Gate wavesurfer init until the persisted-peaks probe settles, so we never
    // double-render (once live, once with peaks). Skipped entirely when no
    // materialId is supplied (legacy callers).
    const [peaksProbeDone, setPeaksProbeDone] = useState(false);

    // Suppress region-updated callbacks during bulk region syncs
    const isSyncingRegionsRef = useRef(false);

    // Track active context-playback timeupdate listener for cleanup
    const activeContextListenerRef = useRef<((t: number) => void) | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isReady, setIsReady] = useState(false);
    const [zoomLevel, setZoomLevel] = useState(0); // 0 = fit to container
    const [isPreviewingOverall, setIsPreviewingOverall] = useState(false);

    // Keep refs so event callbacks always see the latest value
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;

    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;

    const isPreviewingOverallRef = useRef(isPreviewingOverall);
    isPreviewingOverallRef.current = isPreviewingOverall;

    // Ref-based zoom level for wheel handler (avoids re-registering listener)
    const zoomLevelRef = useRef(zoomLevel);
    zoomLevelRef.current = zoomLevel;

    // Detect dark mode
    const isDarkMode = useMemo(() => {
      if (typeof window === 'undefined') return false;
      return document.documentElement.classList.contains('dark');
    }, []);

    // ---- Probe persisted peaks (spec 04) before init ----
    useEffect(() => {
      if (!materialId) {
        // Legacy caller — go straight to live decode.
        setPersistedPeaks(null);
        setPeaksProbeDone(true);
        return;
      }
      let cancelled = false;
      setPeaksProbeDone(false);
      setPersistedPeaks(null);
      fetchWaveform(materialId)
        .then((doc) => {
          if (cancelled) return;
          if (
            doc.status === 'ready' &&
            Array.isArray(doc.peaks) &&
            doc.peaks.length > 0
          ) {
            setPersistedPeaks({
              peaks: doc.peaks,
              durationSec: doc.durationSec ?? 0,
            });
          }
        })
        .catch(() => {
          // Miss / error → fall back to live decode below.
        })
        .finally(() => {
          if (!cancelled) setPeaksProbeDone(true);
        });
      return () => {
        cancelled = true;
      };
    }, [materialId]);

    // ---- Initialize wavesurfer ----
    useEffect(() => {
      if (!containerRef.current || !audioUrl) return;
      // Wait for the persisted-peaks probe to settle so we render once.
      if (!peaksProbeDone) return;

      const regionsPlugin = RegionsPlugin.create();
      regionsPluginRef.current = regionsPlugin;

      const colors = isDarkMode ? COLORS.dark : COLORS.light;

      // When persisted peaks are available, hand them to wavesurfer so it
      // renders WITHOUT decoding the audio. We still pass `url` so seeking /
      // playback works; wavesurfer skips the decode pass when `peaks` is set.
      const usePersisted =
        persistedPeaks !== null && persistedPeaks.durationSec > 0;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        waveColor: colors.waveColor,
        progressColor: colors.progressColor,
        url: audioUrl,
        ...(usePersisted
          ? {
              peaks: [persistedPeaks!.peaks],
              duration: persistedPeaks!.durationSec,
            }
          : {}),
        height: 120,
        barWidth: 2,
        barGap: 1,
        cursorColor: isDarkMode ? '#e2e8f0' : '#1e293b',
        cursorWidth: 1,
        plugins: [regionsPlugin],
        normalize: true,
      });

      wavesurferRef.current = ws;

      // ---- Events ----
      ws.on('ready', () => {
        setDuration(ws.getDuration());
        setIsReady(true);
      });

      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));
      ws.on('finish', () => {
        setIsPlaying(false);
        setIsPreviewingOverall(false);
      });

      ws.on('timeupdate', (time: number) => {
        setCurrentTime(time);

        // If previewing overall effect: skip selected silence segments
        if (isPreviewingOverallRef.current) {
          for (const seg of segmentsRef.current) {
            if (selectedIdsRef.current.has(seg.id) && time >= seg.start && time < seg.end) {
              ws.setTime(seg.end);
              break;
            }
          }
        }
      });

      // Region events
      regionsPlugin.on('region-updated', (region) => {
        if (isSyncingRegionsRef.current) return;
        onSegmentUpdate(region.id, region.start, region.end);
      });

      regionsPlugin.on('region-clicked', (region, e) => {
        e.stopPropagation();
        // Clean up any previous context-playback listener to avoid accumulation
        if (activeContextListenerRef.current) {
          ws.un('timeupdate', activeContextListenerRef.current);
          activeContextListenerRef.current = null;
        }
        // Play from 1s before the region to 1s after
        const contextStart = Math.max(0, region.start - 1);
        const contextEnd = Math.min(ws.getDuration(), region.end + 1);
        ws.setTime(contextStart);
        ws.play();
        const checkStop = (t: number) => {
          if (t >= contextEnd) {
            ws.pause();
            ws.un('timeupdate', checkStop);
            activeContextListenerRef.current = null;
          }
        };
        activeContextListenerRef.current = checkStop;
        ws.on('timeupdate', checkStop);
      });

      // Cleanup
      return () => {
        activeContextListenerRef.current = null;
        ws.destroy();
        wavesurferRef.current = null;
        regionsPluginRef.current = null;
        setIsReady(false);
        setIsPlaying(false);
        setCurrentTime(0);
        setDuration(0);
        setZoomLevel(0);
        setIsPreviewingOverall(false);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioUrl, isDarkMode, peaksProbeDone, persistedPeaks]);

    // ---- Sync regions when segments or selectedIds change ----
    useEffect(() => {
      const rp = regionsPluginRef.current;
      if (!rp || !isReady) return;

      isSyncingRegionsRef.current = true;

      rp.clearRegions();

      for (const seg of segments) {
        const isSelected = selectedIds.has(seg.id);
        rp.addRegion({
          id: seg.id,
          start: seg.start,
          end: seg.end,
          color: isSelected ? COLORS.region.selected : COLORS.region.deselected,
          drag: true,
          resize: true,
          minLength: 0.05,
        });
      }

      isSyncingRegionsRef.current = false;
    }, [segments, selectedIds, isReady]);

    // ---- Focus segment: scroll to it ----
    useEffect(() => {
      if (!focusSegmentId || !wavesurferRef.current || !isReady) return;

      const seg = segments.find((s) => s.id === focusSegmentId);
      if (!seg) return;

      wavesurferRef.current.setTime(seg.start);
      onFocusHandled();
    }, [focusSegmentId, segments, isReady, onFocusHandled]);

    // ---- Zoom via mouse wheel (Ctrl+wheel) ----
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleWheel = (e: WheelEvent) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();

        const ws = wavesurferRef.current;
        if (!ws) return;

        const delta = e.deltaY > 0 ? -10 : 10;
        const newZoom = Math.max(0, Math.min(500, zoomLevelRef.current + delta));
        zoomLevelRef.current = newZoom;
        setZoomLevel(newZoom);
        ws.zoom(newZoom);
      };

      container.addEventListener('wheel', handleWheel, { passive: false });
      return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    // ---- Double-click to fit a region ----
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const handleDblClick = (e: MouseEvent) => {
        const ws = wavesurferRef.current;
        if (!ws) return;

        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        // When zoomed, the scrollable width may differ from rect.width,
        // so account for the scroll position
        const scrollLeft = container.scrollLeft;
        const totalWidth = container.scrollWidth;
        const clickTime = ((x + scrollLeft) / totalWidth) * ws.getDuration();

        const targetSeg = segmentsRef.current.find(
          (s) => clickTime >= s.start && clickTime <= s.end
        );
        if (!targetSeg) return;

        const regionDuration = targetSeg.end - targetSeg.start;
        if (regionDuration <= 0) return;

        const containerWidth = container.clientWidth;
        const targetPxPerSec = (containerWidth * 0.6) / regionDuration;
        const newZoom = Math.min(500, Math.max(0, Math.round(targetPxPerSec)));
        zoomLevelRef.current = newZoom;
        setZoomLevel(newZoom);
        ws.zoom(newZoom);

        ws.setTime(targetSeg.start);
      };

      container.addEventListener('dblclick', handleDblClick);
      return () => container.removeEventListener('dblclick', handleDblClick);
    }, []);

    // ---- Playback controls ----
    const handlePlayPause = useCallback(() => {
      wavesurferRef.current?.playPause();
    }, []);

    /** Play a specific segment with 1s context before and after */
    const playSegmentContext = useCallback((segmentId: string) => {
      const ws = wavesurferRef.current;
      if (!ws) return;

      const seg = segmentsRef.current.find((s) => s.id === segmentId);
      if (!seg) return;

      // Clean up any previous context-playback listener to avoid accumulation
      if (activeContextListenerRef.current) {
        ws.un('timeupdate', activeContextListenerRef.current);
        activeContextListenerRef.current = null;
      }

      const contextStart = Math.max(0, seg.start - 1);
      const contextEnd = Math.min(ws.getDuration(), seg.end + 1);

      ws.setTime(contextStart);
      ws.play();

      const checkStop = (t: number) => {
        if (t >= contextEnd) {
          ws.pause();
          ws.un('timeupdate', checkStop);
          activeContextListenerRef.current = null;
        }
      };
      activeContextListenerRef.current = checkStop;
      ws.on('timeupdate', checkStop);
    }, []);

    /** Preview overall effect: play and skip selected silence segments */
    const handlePreviewOverall = useCallback(() => {
      const ws = wavesurferRef.current;
      if (!ws) return;

      if (isPreviewingOverall) {
        setIsPreviewingOverall(false);
        ws.pause();
        return;
      }

      setIsPreviewingOverall(true);
      ws.setTime(0);
      ws.play();
    }, [isPreviewingOverall]);

    // ---- Expose imperative methods to parent ----
    useImperativeHandle(
      ref,
      () => ({
        playSegmentContext,
      }),
      [playSegmentContext]
    );

    // ---- Format time ----
    const formatTime = (seconds: number): string => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    };

    return (
      <div className="flex flex-col gap-2">
        {/* Waveform container */}
        <div
          ref={containerRef}
          className="w-full rounded-md border border-border bg-background overflow-x-auto"
          style={{ minHeight: 120 }}
        />

        {/* Control bar */}
        <div className="flex items-center gap-2">
          {/* Play / Pause */}
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={!isReady}
            className="w-8 h-8 flex items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            title={isPlaying ? t.videoProcessing.waveform.pause : t.videoProcessing.waveform.play}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Preview overall effect (skip silence) */}
          <button
            type="button"
            onClick={handlePreviewOverall}
            disabled={!isReady}
            className={`h-8 px-3 text-xs rounded-md border transition-colors disabled:opacity-50 ${
              isPreviewingOverall
                ? 'bg-destructive text-destructive-foreground border-destructive'
                : 'bg-muted text-foreground border-border hover:bg-accent'
            }`}
            title={t.videoProcessing.waveform.previewEffect}
          >
            {isPreviewingOverall ? t.videoProcessing.waveform.stopPreview : t.videoProcessing.waveform.preview}
          </button>

          {/* Time display */}
          <span className="text-xs font-mono text-muted-foreground ml-auto">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          {/* Zoom indicator */}
          <span
            className="text-xs text-muted-foreground"
            title={t.videoProcessing.waveform.zoomHint}
          >
            {zoomLevel > 0 ? `${zoomLevel}x` : 'fit'}
          </span>
        </div>
      </div>
    );
  }
);

WaveformPreview.displayName = 'WaveformPreview';

export default WaveformPreview;
