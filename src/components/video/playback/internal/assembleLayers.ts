/**
 * assembleLayers — pure layer-list assembly for the multi-track compositor
 * (spec 02 §2.2 / §2.3 / §2.4 / §4).
 *
 * Given a composition time `t` and the live decode elements per track, this
 * builds the ordered {@link CompositorLayer}[] that {@link CanvasCompositor
 * .renderFrame} draws bottom→top. It composes the S1 data layers — never
 * re-implementing their logic:
 *   - video layers: one per visible video track that has an active clip + a
 *     ready-ish element, with effective opacity = item.opacity × transition
 *     alpha ({@link TransitionLayer.alphaFor});
 *   - subtitle layers: from {@link SubtitleLayer.activeAt} + `.layout(...)`;
 *   - image layers: from {@link ImageOverlayLayer.buildLayers}.
 *
 * PURE: no DOM beyond reading `VideoElementLike` fields, no canvas. This is the
 * jsdom-testable seam that lets us assert z-order, per-layer opacity, and that
 * an upper video with opacity<1 still leaves a lower video in the list (spec 02
 * §6 case 8) without a real GPU.
 */

import { activeClipAt } from '../TrackScheduler';
import { alphaFor, type TransitionClip } from '../TransitionLayer';
import {
  activeSubtitlesAt,
  resolveSubtitleStyle,
  wrapText,
  type TextMeasurer,
} from '../SubtitleLayer';
import { buildImageLayersAt, type ImageOverlayInput, type FitRect } from '../ImageOverlayLayer';
import { resolveCameraDraw } from '../camera/resolveCameraDraw';
import type { CompositorLayer, VideoTrackGroup } from '../types';
import type { VideoSequenceItem, SubtitleSequenceItem } from '../../types';

/**
 * Minimal `<video>`-readable surface for layer assembly (decode source).
 *
 * `videoWidth`/`videoHeight` are optional and read ONLY to derive the camera
 * motion's `frameAspect` (review P1-1). They stay optional so jsdom tests can
 * stub the source with just `readyState`.
 */
export interface DrawableVideoSource {
  readonly readyState: number;
  readonly videoWidth?: number;
  readonly videoHeight?: number;
}

/** One track's resolved active draw source for this frame. */
export interface ActiveVideoEntry {
  trackId: string;
  /** Z-order — lower draws first (bottom). */
  z: number;
  /** The decode element to draw, or null when the track is idle this frame. */
  source: DrawableVideoSource | null;
  /** The active clip (carries opacity + transition metadata), or null. */
  clip: VideoSequenceItem | null;
}

export interface AssembleLayersInput {
  /** Resolved per-track active draw entries (from the VideoSourcePool sync). */
  videoEntries: readonly ActiveVideoEntry[];
  /** Visible subtitle items across all subtitle tracks. */
  subtitleItems: readonly SubtitleSequenceItem[];
  /** Visible image-overlay items across all image tracks. */
  imageItems: readonly ImageOverlayInput[];
  /** Composition time (seconds). */
  t: number;
  /** Max text width (px) for subtitle wrapping. */
  subtitleMaxWidthPx: number;
  /** Text measurer for subtitle layout (injected; jsdom uses a stub). */
  measureSubtitle: TextMeasurer;
  /** Optional fit-rect for image overlays (defaults to full canvas inside the layer). */
  imageFit?: FitRect;
  /** Base z applied to subtitle/image layers so they sit ABOVE all video. */
  overlayBaseZ?: number;
}

/** Default z floor for overlays — well above any realistic track z. */
const DEFAULT_OVERLAY_BASE_Z = 1_000_000;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function itemOpacity(clip: VideoSequenceItem): number {
  return clip.opacity === undefined || clip.opacity === null ? 1 : clamp01(clip.opacity);
}

/**
 * Build the video layers for this frame. A track contributes a layer when it
 * has an active clip AND a non-null draw source. Effective opacity folds the
 * item opacity with the transition alpha at `t` so fade-in/out and cross-
 * dissolve are honoured (the lower clip stays in the list even when an upper
 * clip is partially transparent → §6 case 8).
 */
export function buildVideoLayers(
  entries: readonly ActiveVideoEntry[],
  t: number,
): Extract<CompositorLayer, { kind: 'video' }>[] {
  const layers: Extract<CompositorLayer, { kind: 'video' }>[] = [];
  for (const entry of entries) {
    if (!entry.source || !entry.clip) continue;
    const transitionClip: TransitionClip = {
      startTime: entry.clip.startTime,
      duration: entry.clip.duration,
      transitionIn: entry.clip.transitionIn ?? null,
      transitionOut: entry.clip.transitionOut ?? null,
    };
    const alpha = alphaFor(transitionClip, t);
    const opacity = clamp01(itemOpacity(entry.clip) * alpha);
    // Camera motion (camera-motion-2d-3d §4.3.1). `frameAspect` is a REQUIRED
    // input to the math kernel, so when the source's intrinsic size is not up
    // yet (readyState < 1) we draw WITHOUT motion rather than guessing an
    // aspect — a wrong guess is a one-frame framing jump.
    const width = entry.source.videoWidth;
    const height = entry.source.videoHeight;
    const frameAspect = width && height ? width / height : undefined;
    const camera = frameAspect
      ? resolveCameraDraw(
          entry.clip.cameraMotion,
          t - entry.clip.startTime,
          entry.clip.duration,
          frameAspect,
        )
      : undefined;
    layers.push({
      kind: 'video',
      id: entry.trackId,
      source: entry.source as unknown as HTMLVideoElement,
      opacity,
      z: entry.z,
      camera,
    });
  }
  return layers;
}

/**
 * Build the subtitle layers active at `t`. Each active subtitle is wrapped via
 * the SubtitleLayer's pure layout (`wrapText` + `resolveSubtitleStyle`) so the
 * compositor only draws pre-laid-out lines. Empty layouts are dropped.
 */
export function buildSubtitleLayers(
  items: readonly SubtitleSequenceItem[],
  t: number,
  maxWidthPx: number,
  measure: TextMeasurer,
  baseZ: number,
): Extract<CompositorLayer, { kind: 'subtitle' }>[] {
  const active = activeSubtitlesAt(items, t);
  const layers: Extract<CompositorLayer, { kind: 'subtitle' }>[] = [];
  active.forEach((item, index) => {
    if (!item.text) return;
    const style = resolveSubtitleStyle(item.style);
    const lines = wrapText(item.text, style, maxWidthPx, measure);
    if (lines.length === 0) return;
    layers.push({
      kind: 'subtitle',
      id: item.id,
      lines,
      style: {
        fontSize: style.fontSize,
        color: style.color,
        background: style.background,
        bold: style.bold,
        italic: style.italic,
        align: style.align,
        vAnchor: style.vAnchor,
      },
      opacity: 1,
      z: baseZ + index,
    });
  });
  return layers;
}

/**
 * Assemble the full ordered layer list for composition time `t`. Layers are
 * returned z-ascending (bottom→top): video layers by their track z, then image
 * and subtitle layers lifted above all video by `overlayBaseZ`. The compositor
 * itself also sorts by z, so this order is advisory but kept stable + tested.
 */
export function assembleLayers(input: AssembleLayersInput): CompositorLayer[] {
  const baseZ = input.overlayBaseZ ?? DEFAULT_OVERLAY_BASE_Z;
  const video = buildVideoLayers(input.videoEntries, input.t);

  // The SPREAD is load-bearing: it is what carries `cameraInput` (and anything
  // added later) through to the compositor. Rebuilding the object field by field
  // here is exactly how `compositorPassthroughFields` once dropped a camera —
  // see the assembleLayers passthrough test (camera-motion-stills P2-1).
  const images = buildImageLayersAt(input.imageItems, input.t, input.imageFit).map(
    (layer, index) => ({ ...layer, z: baseZ + layer.z + index }),
  );

  const subtitles = buildSubtitleLayers(
    input.subtitleItems,
    input.t,
    input.subtitleMaxWidthPx,
    input.measureSubtitle,
    // Subtitles sit above images so a caption is never occluded by an overlay.
    baseZ * 2,
  );

  const all: CompositorLayer[] = [...video, ...images, ...subtitles];
  all.sort((a, b) => a.z - b.z);
  return all;
}

/**
 * Resolve the active video clip for a track at `t` without touching DOM — a thin
 * convenience the orchestrator uses to pair the VideoSourcePool element with its
 * clip for {@link ActiveVideoEntry}. Delegates to spec 01 / S1 `activeClipAt`.
 */
export function activeVideoClipAt(
  group: VideoTrackGroup,
  t: number,
): VideoSequenceItem | null {
  const hit = activeClipAt(group.items, t);
  return hit ? hit.clip : null;
}
