'use client';

/**
 * PreviewSurface — playback rendering layer.
 *
 * Spec: docs/plans/video-editor-playback-v2-phase2/spec.md §4.1 (PreviewSurface)
 *       docs/plans/video-editor-playback-optimization/specs/01-architecture-refactor.md §3
 *
 * Round 2 (v2 variant): owns the canvas + a single hidden `<video>`, builds
 * a {@link ResizeObserver} for DPR-aware sizing, and attaches a
 * {@link PlaybackEngine} for the lifetime of the mount. The legacy variant
 * still returns `null` so `VideoPlayerPanel` keeps owning that DOM.
 */

import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  PlaybackEngine,
  type IKillSwitchMonitor,
  type IProxyHitMeter,
  type OverlayPayload,
  type PlaybackEngineAttachDeps,
  type PlaybackTimelineFacade,
  type PlaybackSequenceResolver,
  type ICanvasViewport,
} from '../../playback';

export type PreviewSurfaceVariant = 'legacy' | 'v2';

export interface PreviewSurfaceV2Wiring {
  /** Engine instance owned by the parent (typically VideoPlayerPanel). */
  engine: PlaybackEngine;
  timeline: PlaybackTimelineFacade;
  resolver: PlaybackSequenceResolver;
  overlaysProvider: () => OverlayPayload[];
  viewport?: ICanvasViewport;
  /**
   * Invoked when the engine asks to be killed (rAF error, drift, etc).
   * Parent should toggle a state that unmounts this component, then trip the
   * playbackFlags kill-switch and reload the panel.
   */
  onKillSwitch?: (reason: string) => void;
  /**
   * Phase 4 §F12 — optional monitors injected by the parent. Either one
   * left undefined means "do not record" for that dimension; the engine
   * still works unchanged.
   */
  killSwitchMonitor?: IKillSwitchMonitor | null;
  proxyHitMeter?: IProxyHitMeter | null;
}

export interface PreviewSurfaceProps {
  variant: PreviewSurfaceVariant;
  className?: string;
  ariaLabel?: string;
  /** Inline style for the wrapping <div>. Used by the panel for letterbox. */
  style?: React.CSSProperties;
  /** Required when variant === 'v2'. Ignored for legacy. */
  v2?: PreviewSurfaceV2Wiring;
}

export interface PreviewSurfaceHandle {
  /** v2: backing `<canvas>`. legacy: null. */
  getCanvas(): HTMLCanvasElement | null;
  /** v2: hidden `<video>` element A. legacy: null. */
  getVideoA(): HTMLVideoElement | null;
  /** v2: hidden `<video>` element B (Phase 2 not used yet). legacy: null. */
  getVideoB(): HTMLVideoElement | null;
}

/** Hidden video — lives off-screen so the canvas is the user-visible surface. */
const HIDDEN_VIDEO_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  opacity: 0,
  pointerEvents: 'none',
  // Note: muted is no longer hard-coded here. Engine.attach controls it via
  // _activeVideo.volume / .muted from the current setVolume intent (spec §3.2.1).
};

const PreviewSurface = forwardRef<PreviewSurfaceHandle, PreviewSurfaceProps>(
  function PreviewSurface({ variant, className, ariaLabel, style, v2 }, ref) {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const videoARef = useRef<HTMLVideoElement | null>(null);
    const videoBRef = useRef<HTMLVideoElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        getVideoA: () => videoARef.current,
        getVideoB: () => videoBRef.current,
      }),
      [],
    );

    // v2: attach the engine and wire the ResizeObserver.
    useEffect(() => {
      if (variant !== 'v2' || !v2) return undefined;
      const canvas = canvasRef.current;
      const video = videoARef.current;
      const wrapper = wrapperRef.current;
      if (!canvas || !video || !wrapper) return undefined;

      // Initial sizing — DPR-aware.
      const sync = () => {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const cw = wrapper.clientWidth || 1;
        const ch = wrapper.clientHeight || 1;
        canvas.width = Math.max(1, Math.round(cw * dpr));
        canvas.height = Math.max(1, Math.round(ch * dpr));
        canvas.style.width = '100%';
        canvas.style.height = '100%';
      };
      sync();

      const attachDeps: PlaybackEngineAttachDeps = {
        canvas,
        activeVideo: video,
        // Phase-3 §3.4 — supply the second buffer element so spec 04
        // prewarm/swap fast-paths can engage. When the v2 mount only has
        // one element bound the buffer degrades to single-video mode.
        prewarmVideo: videoBRef.current,
        timeline: v2.timeline,
        resolver: v2.resolver,
        overlaysProvider: v2.overlaysProvider,
        viewport: v2.viewport,
        onKillSwitch: v2.onKillSwitch,
        killSwitchMonitor: v2.killSwitchMonitor ?? null,
        proxyHitMeter: v2.proxyHitMeter ?? null,
      };
      try {
        v2.engine.attach(attachDeps);
      } catch (err) {
        v2.onKillSwitch?.(`attach_threw:${(err as Error)?.message ?? 'unknown'}`);
        return undefined;
      }

      let resizeObserver: ResizeObserver | null = null;
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          sync();
        });
        resizeObserver.observe(wrapper);
      }

      return () => {
        resizeObserver?.disconnect();
        try {
          v2.engine.dispose();
        } catch {
          // ignore
        }
      };
      // We deliberately depend only on `variant` + `v2.engine` so the engine
      // attach happens exactly once per mount. Other v2 fields (overlaysProvider,
      // resolver) are read on every tick via the closures already passed in.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [variant, v2?.engine]);

    if (variant === 'legacy') {
      return null;
    }

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
        <video
          ref={videoARef}
          playsInline
          preload="auto"
          style={HIDDEN_VIDEO_STYLE}
        />
        <video
          ref={videoBRef}
          playsInline
          preload="auto"
          style={HIDDEN_VIDEO_STYLE}
        />
      </div>
    );
  },
);

export default PreviewSurface;
