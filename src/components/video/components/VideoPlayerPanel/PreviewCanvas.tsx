'use client';

/**
 * PreviewCanvas — the multi-track compositor HOST (spec 02 §2.1 / §3, S3).
 *
 * Renders the user-visible preview `<canvas>` plus a hidden container that holds
 * the per-track decode `<video>` sources the {@link VideoSourcePool} manages
 * (one A/B pair per visible video track) and one hidden `<audio>`/`<video>` per
 * audio track. It exposes — through a {@link PreviewCanvasHandle} ref — exactly
 * the DOM surface the {@link MultiTrackPlaybackEngine}'s
 * {@link MultiTrackAttachDeps} needs:
 *   - `canvas`               — the preview canvas (sized in device px, DPR-aware);
 *   - `resolveTrackElements` — the active + prewarm decode `<video>` for a track;
 *   - `resolveAudioElement`  — the hidden media element for an audio track.
 *
 * Subtitles are laid out in output pixels (EXO-09), so the host no longer
 * measures text.
 *
 * It owns NO business logic and NO engine lifecycle — the hook
 * ({@link useCompositionPlayback}) attaches/plays/seeks/disposes the engine. The
 * host only: creates DOM lazily, keeps the canvas sized to its wrapper, and
 * hands out element handles. The VideoSourcePool assigns each decode element's
 * `src` itself (RC-B), so this host MUST NOT set `src` on the decode `<video>`s.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';
import type { TrackVideoElements } from '../../playback';
import type { VideoElementLike } from '../../playback';
import { PreviewGainRouter } from '../../playback/audio/PreviewGainRouter';

/** Which pooled element of a track a volume / recycle request is about. */
export type PreviewElementRole = 'active' | 'prewarm' | 'audio';

// ME-06：远程未缓存素材在预览中听不出超过 100% 的音量；每个会话只提示一次。
let volumeBoostUnavailableNotified = false;

/** Hidden decode source — off-screen so the canvas is the user-visible surface. */
const HIDDEN_MEDIA_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: 'none',
  left: -9999,
  top: 0,
};

const HIDDEN_HOST_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 0,
  height: 0,
  overflow: 'hidden',
  pointerEvents: 'none',
};

/**
 * The DOM contract the orchestration hook consumes to build
 * {@link MultiTrackAttachDeps}. Stable across re-renders (ref-backed).
 */
export interface PreviewCanvasHandle {
  /** The preview canvas, or null before mount. */
  getCanvas(): HTMLCanvasElement | null;
  /**
   * The active + prewarm decode `<video>` pair for a visible video track id,
   * created on first request and cached for the host's lifetime. Returns null
   * only before the hidden host mounts.
   */
  resolveTrackElements(trackId: string): TrackVideoElements | null;
  /**
   * The hidden media element for an audio track id, created on first request
   * and cached. Returns null only before the hidden host mounts.
   */
  resolveAudioElement(trackId: string): VideoElementLike | null;
  /**
   * Write an effective [0,2] preview volume to a pooled element (ME-06): above
   * 100% a same-origin element is routed through a WebAudio gain stage.
   */
  applyVolume(element: VideoElementLike, volume: number): void;
  /**
   * Replace a track's pooled element with a fresh, un-routed one (a gain-routed
   * element cannot play a cross-origin url). Returns the new element, or null
   * when the track has none yet.
   */
  recycleElement(trackId: string, role: PreviewElementRole): VideoElementLike | null;
  /** `element`, or a recycled replacement when it is gain-routed and `url` is cross-origin. */
  prepareElementForSrc(
    trackId: string,
    role: PreviewElementRole,
    element: VideoElementLike,
    url: string,
  ): VideoElementLike;
  /** Resume the preview AudioContext; called when playback starts. */
  resumeAudio(): void;
  /**
   * Subscribe to viewport (canvas) size changes. The compositor's rAF loop is
   * stopped while paused, so a resize would not repaint by itself; the
   * orchestration hook subscribes here to request a single non-playing repaint
   * (re-letterbox the last frame — H5). Returns an unsubscribe fn. Stable across
   * renders (ref-backed).
   */
  subscribeViewportChange(cb: () => void): () => void;
}

export interface PreviewCanvasProps {
  className?: string;
  ariaLabel?: string;
  /** Inline style for the wrapping <div> (the panel uses it for letterbox). */
  style?: React.CSSProperties;
  /** Called at most once per session when a >100% volume cannot be boosted (ME-06). */
  onVolumeBoostUnavailable?: () => void;
}

/**
 * PreviewCanvas — the compositor host surface. Pure DOM ownership; the engine
 * lifecycle is driven by {@link useCompositionPlayback} via the exposed handle.
 */
const PreviewCanvas = forwardRef<PreviewCanvasHandle, PreviewCanvasProps>(
  function PreviewCanvas({ className, ariaLabel, style, onVolumeBoostUnavailable }, ref) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const sourceHostRef = useRef<HTMLDivElement | null>(null);

    // Per-track decode pools, created lazily and cached for the host lifetime.
    // Cleared on unmount so a remount starts fresh.
    const videoPoolRef = useRef<Map<string, TrackVideoElements>>(new Map());
    const audioPoolRef = useRef<Map<string, VideoElementLike>>(new Map());
    // Viewport-change subscribers (the orchestration hook requests a non-playing
    // repaint on resize). Ref-backed so the handle method stays stable.
    const viewportListenersRef = useRef<Set<() => void>>(new Set());
    // ME-06: one gain router per host, created on first use, disposed on unmount.
    const gainRouterRef = useRef<PreviewGainRouter | null>(null);
    const onVolumeBoostUnavailableRef = useRef(onVolumeBoostUnavailable);
    onVolumeBoostUnavailableRef.current = onVolumeBoostUnavailable;

    const createHiddenVideo = useCallback((): HTMLVideoElement => {
      const el = document.createElement('video');
      el.playsInline = true;
      el.preload = 'auto';
      // muted is OWNED by the VideoSourcePool per frame (RISK 2 routing): a
      // non-detached track's decode element carries its own audio (unmuted), a
      // detached / idle one is muted. el.volume is likewise applied by the pool
      // each frame (the active clip's effective loudness) so preview follows live
      // track/clip volume. Start muted so nothing plays before the first sync.
      el.muted = true;
      Object.assign(el.style, HIDDEN_MEDIA_STYLE);
      sourceHostRef.current?.appendChild(el);
      return el;
    }, []);

    const createHiddenAudio = useCallback((): HTMLVideoElement => {
      // A hidden <video> doubles as the audio element for INDEPENDENT audio
      // tracks (and the audio detached from a video via spec 01 §2.4) so it
      // shares one decode path (matches the engine adapter, which reads
      // currentTime/volume/paused + play/pause).
      const el = document.createElement('video');
      el.playsInline = true;
      el.preload = 'auto';
      Object.assign(el.style, HIDDEN_MEDIA_STYLE);
      sourceHostRef.current?.appendChild(el);
      return el;
    }, []);

    const resolveTrackElements = useCallback(
      (trackId: string): TrackVideoElements | null => {
        if (!sourceHostRef.current) return null;
        const pool = videoPoolRef.current;
        const existing = pool.get(trackId);
        if (existing) return existing;
        const pair: TrackVideoElements = {
          active: createHiddenVideo() as unknown as VideoElementLike,
          prewarm: createHiddenVideo() as unknown as VideoElementLike,
        };
        pool.set(trackId, pair);
        return pair;
      },
      [createHiddenVideo],
    );

    const resolveAudioElement = useCallback(
      (trackId: string): VideoElementLike | null => {
        if (!sourceHostRef.current) return null;
        const pool = audioPoolRef.current;
        const existing = pool.get(trackId);
        if (existing) return existing;
        const el = createHiddenAudio() as unknown as VideoElementLike;
        pool.set(trackId, el);
        return el;
      },
      [createHiddenAudio],
    );

    const subscribeViewportChange = useCallback((cb: () => void): (() => void) => {
      const listeners = viewportListenersRef.current;
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }, []);

    const gainRouter = useCallback((): PreviewGainRouter => {
      if (!gainRouterRef.current) gainRouterRef.current = new PreviewGainRouter();
      return gainRouterRef.current;
    }, []);

    const applyVolume = useCallback((element: VideoElementLike, volume: number) => {
      const outcome = gainRouter().apply(element as unknown as HTMLMediaElement, volume);
      if (outcome !== 'unboostable' || volumeBoostUnavailableNotified) return;
      volumeBoostUnavailableNotified = true;
      onVolumeBoostUnavailableRef.current?.();
    }, [gainRouter]);

    /** Drop `old` (pause, unload, disconnect, detach) and hand back a fresh element. */
    const replaceElement = useCallback(
      (old: VideoElementLike, create: () => HTMLVideoElement): HTMLVideoElement => {
        const media = old as unknown as HTMLVideoElement;
        gainRouterRef.current?.release(media);
        media.pause();
        media.removeAttribute('src');
        media.load();
        media.remove();
        return create();
      },
      [],
    );

    const recycleElement = useCallback(
      (trackId: string, role: PreviewElementRole): VideoElementLike | null => {
        if (role === 'audio') {
          const old = audioPoolRef.current.get(trackId);
          if (!old) return null;
          const next = replaceElement(old, createHiddenAudio) as unknown as VideoElementLike;
          audioPoolRef.current.set(trackId, next);
          return next;
        }
        const pair = videoPoolRef.current.get(trackId);
        if (!pair || !pair[role]) return null;
        const next = replaceElement(pair[role]!, createHiddenVideo) as unknown as VideoElementLike;
        videoPoolRef.current.set(trackId, { ...pair, [role]: next });
        return next;
      },
      [createHiddenAudio, createHiddenVideo, replaceElement],
    );

    const prepareElementForSrc = useCallback(
      (trackId: string, role: PreviewElementRole, element: VideoElementLike, url: string) => {
        const router = gainRouterRef.current;
        if (!router || !router.needsRecycleFor(element as unknown as HTMLMediaElement, url)) {
          return element;
        }
        return recycleElement(trackId, role) ?? element;
      },
      [recycleElement],
    );

    const resumeAudio = useCallback(() => {
      void gainRouterRef.current?.resume();
    }, []);

    // The handle is ref-backed, so it is stable across renders — the hook reads
    // it once at attach and the methods always see the current pools.
    const handle = useMemo<PreviewCanvasHandle>(
      () => ({
        getCanvas: () => canvasRef.current,
        resolveTrackElements,
        resolveAudioElement,
        applyVolume,
        recycleElement,
        prepareElementForSrc,
        resumeAudio,
        subscribeViewportChange,
      }),
      [
        resolveTrackElements,
        resolveAudioElement,
        applyVolume,
        recycleElement,
        prepareElementForSrc,
        resumeAudio,
        subscribeViewportChange,
      ],
    );

    useImperativeHandle(ref, () => handle, [handle]);

    // DPR-aware canvas sizing, kept in sync with the wrapper via ResizeObserver.
    useEffect(() => {
      const canvas = canvasRef.current;
      const wrapper = wrapperRef.current;
      if (!canvas || !wrapper) return undefined;

      const sync = () => {
        const dpr =
          typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const cw = wrapper.clientWidth || 1;
        const ch = wrapper.clientHeight || 1;
        canvas.width = Math.max(1, Math.round(cw * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      };
      sync();

      let observer: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          sync();
          // The paused compositor will not repaint on its own; notify the hook so
          // it can request a single non-playing repaint at the current time.
          viewportListenersRef.current.forEach((cb) => {
            try {
              cb();
            } catch {
              // a listener throwing must not break sizing
            }
          });
        });
        observer.observe(wrapper);
      }
      return () => observer?.disconnect();
    }, []);

    // Release the lazily-created decode elements when the host unmounts so a
    // remount does not accumulate orphaned <video> sources.
    useEffect(() => {
      const videoPool = videoPoolRef.current;
      const audioPool = audioPoolRef.current;
      const viewportListeners = viewportListenersRef.current;
      return () => {
        videoPool.clear();
        audioPool.clear();
        viewportListeners.clear();
        gainRouterRef.current?.dispose();
        gainRouterRef.current = null;
      };
    }, []);

    return (
      <div
        ref={wrapperRef}
        className={className}
        aria-label={ariaLabel}
        style={style}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
        {/* Hidden decode-source container — the per-track A/B <video> sources
            and per-track audio elements are appended here by the handle. */}
        <div ref={sourceHostRef} style={HIDDEN_HOST_STYLE} aria-hidden="true" />
      </div>
    );
  },
);

export default PreviewCanvas;
