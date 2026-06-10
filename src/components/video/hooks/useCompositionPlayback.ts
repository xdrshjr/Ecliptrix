'use client';

/**
 * useCompositionPlayback — the multi-track preview ORCHESTRATION hook
 * (spec 02 §2.1 / §2.6 / §3, S3). Replaces useVideoPlayback's responsibility on
 * the new compositor path (the new path coexists with v1 until S4 deletes v1).
 *
 * Given `compositionPlayback` (videoSequences + audioSequences +
 * subtitleSequences + passthrough fields), the live materials, and a
 * {@link PreviewCanvasHandle}, it:
 *
 *   1. Builds the {@link VideoTrackGroup}[] / {@link AudioSyncGroup}[] the
 *      {@link MultiTrackPlaybackEngine} consumes — grouping sequences by track,
 *      carrying z / opacity / transition / audioDetached, and tagging audio
 *      groups so a detached video track's embedded audio is owned by its paired
 *      audio sequence (no double audio, spec 01 §2.4).
 *   2. Injects `resolveSequencePlaybackUrl(seq, liveMaterials, lockedOpts)` as
 *      the engine's source resolver with the SAME locked options on every call,
 *      so the VideoSourcePool's "did the source change?" key equals the value it
 *      assigns (RC-B "比对键 == 赋值"). Options are locked at first build.
 *   3. Owns the engine lifecycle: attach to the PreviewCanvas refs, play / pause
 *      / seek / scrub from the single composition clock, dispose on unmount.
 *   4. Applies the readiness gate: a direct local material is ready as soon as
 *      `canPreviewDirectLocalMaterial(material)` is true — never blocked on a
 *      missing proxy / download state.
 *   5. Feeds REAL overlay data (subtitle items + image items) to the engine, so
 *      the new path assembles layers itself and does NOT depend on the old v2
 *      `v2OverlaysProvider` `[]` stub.
 *
 * Pure decision logic (group building, readiness, image extraction) is exported
 * as functions so it is jsdom-testable WITHOUT a real engine or canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MaterialItem, TimelineState } from '@/types';
import type {
  CompositionPlayback,
  VideoSequenceItem,
  AudioSequenceItem,
  SubtitleSequenceItem,
} from '../types';
import {
  MultiTrackPlaybackEngine,
  type MultiTrackAttachDeps,
  type MultiTrackTimelineFacade,
  type MultiTrackPhase,
  type VideoTrackGroup,
  type AudioSyncGroup,
} from '../playback';
import type { ImageOverlayInput } from '../playback/ImageOverlayLayer';
import {
  resolveSequencePlaybackUrl,
  type ResolveSequencePlaybackUrlOptions,
} from '../lib/resolveSequencePlaybackUrl';
import { canPreviewDirectLocalMaterial } from '../lib/localMaterial';
import type { PreviewCanvasHandle } from '../components/VideoPlayerPanel/PreviewCanvas';

// ---------------------------------------------------------------------------
// Pure group / overlay builders (jsdom-testable without an engine or canvas).
// ---------------------------------------------------------------------------

/**
 * Group video sequences into per-track {@link VideoTrackGroup}s ordered bottom→
 * top. `z` is taken from each track's first item `trackZ` (lower draws first),
 * falling back to first-seen track order so the result is deterministic even
 * when `trackZ` is absent. Item order within a track is preserved (the upstream
 * extractor keeps them startTime-ordered, satisfying TrackScheduler INV-5).
 */
export function buildVideoTrackGroups(
  sequences: readonly VideoSequenceItem[],
): VideoTrackGroup[] {
  const byTrack = new Map<string, VideoSequenceItem[]>();
  const order: string[] = [];
  for (const seq of sequences) {
    const trackId = seq.trackId;
    let bucket = byTrack.get(trackId);
    if (!bucket) {
      bucket = [];
      byTrack.set(trackId, bucket);
      order.push(trackId);
    }
    bucket.push(seq);
  }
  const groups = order.map((trackId, index) => {
    const items = byTrack.get(trackId) ?? [];
    const z = items[0]?.trackZ ?? index;
    return { trackId, z, items };
  });
  // Stable z-ascending order (bottom→top) regardless of insertion order.
  groups.sort((a, b) => a.z - b.z);
  return groups;
}

/**
 * Build the audio sync groups the {@link AudioSyncPool} ticks — one `'audio'`
 * group per INDEPENDENT audio sequence track. RISK 2 routing decision: a video
 * track's EMBEDDED audio is NOT routed here; it plays from the track's own
 * decode `<video>` element (the VideoSourcePool unmutes a non-detached active
 * clip and mutes a detached one). The AudioSyncPool therefore owns only
 * independent audio tracks (including the audio sequence DETACHED from a video
 * via spec 01 §2.4), which is exactly what keeps "no double audio" intact:
 * a detached video track's decode element is muted, and its paired audio
 * sequence (an independent `'audio'` group here) carries the sound.
 *
 * Track volume is already normalized into each sequence's `volume` by the
 * CompositionAdapter (item.volume × track.volume / 100, clamped [0,2]); we carry
 * a per-group `volume` of 1 and let the per-clip `volume` express the effective
 * gain so we never double-apply the track scalar.
 */
export function buildAudioSyncGroups(
  audioSequences: readonly AudioSequenceItem[],
): AudioSyncGroup[] {
  const groups: AudioSyncGroup[] = [];

  const audioByTrack = new Map<string, AudioSequenceItem[]>();
  const audioOrder: string[] = [];
  for (const seq of audioSequences) {
    let bucket = audioByTrack.get(seq.trackId);
    if (!bucket) {
      bucket = [];
      audioByTrack.set(seq.trackId, bucket);
      audioOrder.push(seq.trackId);
    }
    bucket.push(seq);
  }
  for (const trackId of audioOrder) {
    groups.push({
      trackId,
      muted: false,
      volume: 1,
      kind: 'audio',
      items: (audioByTrack.get(trackId) ?? []).map((seq) => ({
        id: seq.id,
        startTime: seq.startTime,
        duration: seq.duration,
        clipStart: seq.clipStart,
        clipEnd: seq.clipEnd,
        volume: seq.volume,
      })),
    });
  }

  return groups;
}

/**
 * Extract the active-able image-overlay inputs from the timeline state. Mirrors
 * the v1 `getCurrentImageOverlays` selection — items with
 * `originalMaterialType === 'image'` on a visible track — but as a TIME-
 * INDEPENDENT input list (the ImageOverlayLayer does the per-frame `t` filter).
 * The image URL is resolved from the live material (same authority as video).
 * Items whose material has no usable URL are dropped.
 */
export function buildImageOverlayInputs(
  timelineState: TimelineState | undefined,
  materials: readonly MaterialItem[],
): ImageOverlayInput[] {
  if (!timelineState) return [];
  const byId = new Map(materials.map((m) => [m.id, m] as const));
  const inputs: ImageOverlayInput[] = [];
  for (const track of timelineState.tracks) {
    if (!track.isVisible) continue;
    for (const item of track.items) {
      if (item.originalMaterialType !== 'image') continue;
      const material = item.materialId ? byId.get(item.materialId) : undefined;
      const src = material?.url;
      if (!src) continue;
      inputs.push({
        id: item.id,
        src,
        startTime: item.startTime,
        duration: item.duration,
        position: item.imagePosition ?? null,
        opacity: item.opacity ?? null,
      });
    }
  }
  return inputs;
}

/**
 * Readiness gate (spec 02 §2.6): the timeline is previewable when EVERY video
 * sequence either resolves to a playable URL via the live material OR its
 * material is a direct-local material (ready the moment
 * `canPreviewDirectLocalMaterial` is true — NOT blocked on proxy/download).
 * An empty timeline is trivially ready. A sequence whose material is missing or
 * whose URL cannot be resolved yet (e.g. a still-uploading remote placeholder)
 * holds the gate.
 */
export function isCompositionReady(
  videoSequences: readonly VideoSequenceItem[],
  materials: readonly MaterialItem[],
  opts: ResolveSequencePlaybackUrlOptions,
): boolean {
  if (videoSequences.length === 0) return true;
  const byId = new Map(materials.map((m) => [m.id, m] as const));
  for (const seq of videoSequences) {
    const material = seq.materialId ? byId.get(seq.materialId) : undefined;
    if (material && canPreviewDirectLocalMaterial(material)) continue;
    const resolved = resolveSequencePlaybackUrl(seq, materials as MaterialItem[], opts);
    if (resolved?.url) continue;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseCompositionPlaybackOptions {
  compositionPlayback: CompositionPlayback | undefined;
  materials: readonly MaterialItem[];
  timelineState?: TimelineState;
  /** Locked at mount by the caller (preview-proxy flag). */
  preferPreviewProxy: boolean;
  /** Locked at mount by the caller (local-preview flag). */
  preferLocalProxy: boolean;
  /** The current composition time (timeline cursor), driven by the parent. */
  currentTime: number;
  /**
   * Transport state driven by the parent. The hook drives the engine PROP-
   * DRIVEN: `isPlaying` true → `engine.play()`, false → `engine.pause()` — the
   * panel never has to call play()/pause() imperatively.
   */
  isPlaying: boolean;
  /** Push composition time back to the parent as the clock advances. */
  onTimeUpdate?: (t: number) => void;
  /** Letterbox aspect ratio for fixed-ratio preview, e.g. 16/9. */
  aspectRatio?: number;
  /** Whether the new compositor path is active (flag on). Off → fully inert. */
  enabled: boolean;
}

export interface UseCompositionPlaybackReturn {
  /**
   * Callback ref to bind onto the PreviewCanvas host
   * (`<PreviewCanvas ref={hook.hostRef} />`). Implemented as a callback ref so
   * the engine attaches the moment the host's imperative handle commits,
   * regardless of parent/child effect ordering.
   */
  hostRef: (handle: PreviewCanvasHandle | null) => void;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  /** Current engine phase (idle/playing/paused/ended/disposed). */
  getPhase: () => MultiTrackPhase;
  /** True when every video material is previewable (readiness gate). */
  isReady: boolean;
}

/**
 * Orchestrate the multi-track compositor for the v2 preview path. Owns one
 * {@link MultiTrackPlaybackEngine} for the lifetime of the enabled mount.
 */
export function useCompositionPlayback(
  options: UseCompositionPlaybackOptions,
): UseCompositionPlaybackReturn {
  const {
    compositionPlayback,
    materials,
    timelineState,
    preferPreviewProxy,
    preferLocalProxy,
    currentTime,
    isPlaying,
    onTimeUpdate,
    aspectRatio,
    enabled,
  } = options;

  const hostHandleRef = useRef<PreviewCanvasHandle | null>(null);
  const engineRef = useRef<MultiTrackPlaybackEngine | null>(null);
  // BUG 1 fix: the seek guard reads THIS ref, which is updated ONLY after a seek
  // actually fires — NOT the render-body `currentTimeRef` write. Without a
  // separate ref the render-body `currentTimeRef.current = currentTime` ran
  // BEFORE the scrub effect, so `|currentTimeRef - currentTime| < epsilon` was
  // always true and `engine.seek()` never fired on a prop-driven paused scrub.
  const lastSeekedTimeRef = useRef<number | null>(null);
  // Bumped whenever the host handle (un)binds so the attach effect re-runs once
  // the PreviewCanvas imperative handle is available — robust to effect order.
  const [hostVersion, setHostVersion] = useState(0);

  const hostRef = useCallback((handle: PreviewCanvasHandle | null) => {
    if (hostHandleRef.current === handle) return;
    hostHandleRef.current = handle;
    setHostVersion((v) => v + 1);
  }, []);

  // Locked resolver options — built once and never mutated, so the resolver's
  // compare key equals its assigned value across every call (RC-B).
  const resolverOptsRef = useRef<ResolveSequencePlaybackUrlOptions | null>(null);
  if (resolverOptsRef.current === null) {
    resolverOptsRef.current = { preferPreviewProxy, preferLocalProxy };
  }

  // Latest-value refs so the engine's per-tick closures read fresh data without
  // re-attaching (re-attach would reset the engine state machine every render).
  const compositionRef = useRef(compositionPlayback);
  const materialsRef = useRef(materials);
  const timelineStateRef = useRef(timelineState);
  const currentTimeRef = useRef(currentTime);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  compositionRef.current = compositionPlayback;
  materialsRef.current = materials;
  timelineStateRef.current = timelineState;
  currentTimeRef.current = currentTime;
  onTimeUpdateRef.current = onTimeUpdate;

  const isReady = useMemo(
    () =>
      isCompositionReady(
        compositionPlayback?.videoSequences ?? [],
        materials,
        resolverOptsRef.current as ResolveSequencePlaybackUrlOptions,
      ),
    [compositionPlayback?.videoSequences, materials],
  );

  // The engine's per-tick timeline facade. Reads live refs so it always sees the
  // freshest sequences without re-attaching the engine.
  const buildTimelineFacade = useCallback((): MultiTrackTimelineFacade => {
    return {
      getVideoTrackGroups: () =>
        buildVideoTrackGroups(compositionRef.current?.videoSequences ?? []),
      getAudioSyncGroups: () =>
        buildAudioSyncGroups(compositionRef.current?.audioSequences ?? []),
      getSubtitleItems: (): SubtitleSequenceItem[] =>
        compositionRef.current?.subtitleSequences ?? [],
      getImageItems: () =>
        buildImageOverlayInputs(timelineStateRef.current, materialsRef.current),
      getTotalDuration: () =>
        compositionRef.current?.totalCompositionDuration ?? 0,
      getCurrentTime: () => currentTimeRef.current ?? 0,
      setCurrentTime: (t: number) => {
        currentTimeRef.current = t;
        // The engine's OWN clock advance flows back to the parent as the
        // `currentTime` prop; mark it seeked so the scrub effect does NOT
        // re-seek (fight the clock) on a self-originated time update.
        lastSeekedTimeRef.current = t;
        onTimeUpdateRef.current?.(t);
      },
    };
    // resolverOpts is locked; the facade closures read refs, so this is stable.
  }, []);

  // Attach / dispose the engine for the lifetime of the enabled mount. We
  // attach once (deps = [enabled]) and read live data through refs, so changing
  // materials / sequences never tears the engine down mid-playback.
  useEffect(() => {
    if (!enabled) return undefined;
    const host = hostHandleRef.current;
    const canvas = host?.getCanvas();
    if (!host || !canvas) return undefined;

    const engine = new MultiTrackPlaybackEngine();
    engineRef.current = engine;

    const deps: MultiTrackAttachDeps = {
      canvas,
      resolveTrackElements: (trackId) => host.resolveTrackElements(trackId),
      resolveAudioElement: (trackId) => host.resolveAudioElement(trackId),
      // RC-B: the SAME locked resolution drives both the change-decision and the
      // assignment inside the VideoSourcePool. Do NOT pass two resolvers.
      resolveSource: (seq) =>
        resolveSequencePlaybackUrl(
          seq,
          materialsRef.current as MaterialItem[],
          resolverOptsRef.current as ResolveSequencePlaybackUrlOptions,
        )?.url ?? null,
      timeline: buildTimelineFacade(),
      viewport: aspectRatio ? { aspectRatio, letterboxColor: '#000' } : null,
      measureSubtitle: host.measureSubtitle,
    };

    try {
      engine.attach(deps);
    } catch {
      // Attach failure (no 2d context, disposed instance) is non-fatal: the
      // panel still renders; the engine simply never drives frames. S4's sole
      // path will surface this via the kill-switch; here we fail soft.
      engine.dispose();
      engineRef.current = null;
      return undefined;
    }

    return () => {
      engineRef.current = null;
      try {
        engine.dispose();
      } catch {
        // ignore — already torn down
      }
    };
  }, [enabled, aspectRatio, buildTimelineFacade, hostVersion]);

  const play = useCallback(() => {
    engineRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const seek = useCallback((t: number) => {
    currentTimeRef.current = t;
    lastSeekedTimeRef.current = t;
    engineRef.current?.seek(t);
  }, []);

  const getPhase = useCallback<() => MultiTrackPhase>(
    () => engineRef.current?.getPhase() ?? 'idle',
    [],
  );

  // BUG 1b fix — PROP-DRIVEN transport. The parent toggles `isPlaying`; the hook
  // drives the engine so the panel never calls play()/pause() imperatively.
  useEffect(() => {
    if (!enabled) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (isPlaying) {
      engine.play();
    } else {
      engine.pause();
    }
  }, [isPlaying, enabled, hostVersion]);

  // BUG 1 fix — prop-driven SCRUB. When the parent moves the timeline cursor,
  // re-seek the engine so the preview repaints at the new time. The guard reads
  // `lastSeekedTimeRef` (updated only AFTER a seek fires), so the render-body
  // `currentTimeRef` write cannot pre-satisfy it: a scrub past epsilon DOES
  // seek; a scrub within epsilon does NOT re-seek. The engine's seek() preserves
  // the playing/paused phase, so this handles both paused-scrub (repaint one
  // frame) and a playing-scrub (jump the clock) with one effect.
  useEffect(() => {
    if (!enabled) return;
    const engine = engineRef.current;
    if (!engine) return;
    const last = lastSeekedTimeRef.current;
    if (last !== null && Math.abs(last - currentTime) < 1e-6) return;
    lastSeekedTimeRef.current = currentTime;
    currentTimeRef.current = currentTime;
    engine.seek(currentTime);
  }, [currentTime, enabled, hostVersion]);

  return { hostRef, play, pause, seek, getPhase, isReady };
}
