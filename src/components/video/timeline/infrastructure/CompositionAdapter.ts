/**
 * CompositionAdapter — Infrastructure Adapter
 *
 * Converts timeline state (tracks + materials) into video/audio
 * composition sequences for export and playback.
 * Implements ICompositionPort from the domain ports.
 *
 * Extracted from: src/components/video/hooks/useTimelineComposition.ts
 *   - getVideoSequencesFromTimeline()
 *   - getAudioSequencesFromTimeline()
 *
 * The extraction preserves timeline behavior while selecting desktop-local
 * backend media references for export when available:
 *   - URL selection: cacheUrl/local url preferred, remote serverUrl fallback
 *   - Volume calculation: (item.volume ?? 1) * (track.volume / 100), clamped [0, 2]
 *   - Track filtering: video tracks must be visible and not locked
 *   - Audio track filtering: must be visible, not locked, and not muted
 *   - Items must have a materialId to be included
 *   - Audio results are sorted by startTime ascending
 */

import type {
  ICompositionPort,
  VideoSequenceItem,
  AudioSequenceItem,
  SubtitleSequenceItem,
  CompositionConfig,
  VideoCompositionRequest,
} from '../domain/ports';
import type { TrackData, MaterialData } from '../domain/types';
import { toCameraMotionWire } from '@/lib/api/videoComposition';
import { isLocalMediaReference } from '../../lib/selectPlaybackUrl';

// ---------------------------------------------------------------------------
// Expanded MaterialData for composition (extends domain MaterialData)
// ---------------------------------------------------------------------------

/**
 * The composition adapter needs access to serverUrl and metadata
 * that go beyond the minimal domain MaterialData. We accept a
 * broader interface here that matches MaterialItem from src/types.
 */
export interface CompositionMaterialData extends MaterialData {
  serverUrl?: string;
  /**
   * Same-origin URL when the remote asset has been pre-downloaded into
   * cached_materials. Forwarded into VideoSequenceItem.cacheUrl so the
   * playback preview can swap to it via `selectPlaybackUrl`. Not used on
   * the export composition path.
   */
  cacheUrl?: string;
  localResolvedUrl?: string;
  previewProxyLocalUrl?: string;
  localProxyUrl?: string;
  metadata?: {
    isWatermarkRemoved?: boolean;
    source?: string;
    localResolvedUrl?: string;
    [key: string]: unknown;
  };
}

function isPreviewOnlyReference(url: string | undefined): boolean {
  if (!url) return false;
  if (/^blob:/i.test(url)) return true;
  return (
    url.includes('/api/media/proxy') ||
    url.includes('/api/storage/files/preview-proxies/')
  );
}

/**
 * Pick the canonical backend media reference for export/preview extraction.
 *
 * Selection contract is IDENTICAL to `selectPlaybackUrl(material, { purpose:
 * 'export' })` (spec 05 §2.2) — same candidate priority (localResolvedUrl →
 * cacheUrl → url → serverUrl), local same-origin reference first via the shared
 * `isLocalMediaReference` predicate, durable remote URL only as a legacy
 * fallback, and preview-only blob/media-proxy/preview-proxy URLs never emitted.
 *
 * It deliberately returns the reference AS-IS (relative same-origin paths kept
 * relative) rather than absolutising against `window.location.origin`, because
 * this extractor also feeds the preview signature/cache pipeline which keys on
 * the relative path. The actual export REQUEST builder (`useVideoExport`) calls
 * `selectPlaybackUrl(export)` directly, which absolutises for desktop-shell
 * safety — both share this single selection priority.
 */
function selectCanonicalExportReference(material: CompositionMaterialData): string {
  const local = [
    material.metadata?.localResolvedUrl,
    material.localResolvedUrl,
    material.cacheUrl,
    material.url,
    material.serverUrl,
  ].find(isLocalMediaReference);
  if (local) return local;
  return [material.serverUrl, material.url].find(
    (candidate) => !isPreviewOnlyReference(candidate),
  ) || '';
}

// ---------------------------------------------------------------------------
// CompositionAdapter implementation
// ---------------------------------------------------------------------------

export class CompositionAdapter implements ICompositionPort {
  /**
   * Extract video sequences from timeline tracks.
   *
   * Logic extracted verbatim from useTimelineComposition.ts#getVideoSequencesFromTimeline:
   * 1. Filter tracks: type='video', isVisible=true, !isLocked
   * 2. For each item with type='video' and a materialId, find the matching material
   * 3. Select URL: prefer local backend reference, fallback serverUrl/url
   * 4. Compute volume: (item.volume ?? 1) * (track.volume / 100), clamped [0, 2]
   * 5. Include clip start/end/originalDuration
   */
  extractVideoSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ): VideoSequenceItem[] {
    const allVideoItems: VideoSequenceItem[] = [];

    for (const track of tracks) {
      // Filter: video tracks that are visible and unlocked
      if (track.type !== 'video' || !track.isVisible || track.isLocked) {
        continue;
      }

      for (const item of track.items) {
        // Only process video items with a material reference
        if (item.type !== 'video' || !item.materialId) {
          continue;
        }

        // Find matching material
        const material = materials.find(
          (m) => m.id === item.materialId
        ) as CompositionMaterialData | undefined;

        if (!material || material.type !== 'video') {
          continue;
        }

        // Clip info
        const clipStart = item.clipStart ?? 0;
        const clipEnd = item.clipEnd ?? item.originalDuration ?? item.duration;
        const originalDuration = item.originalDuration ?? item.duration;

        const finalUrl = selectCanonicalExportReference(material);

        // Volume calculation — exact match with useTimelineComposition.ts:
        //   Math.max(0, Math.min((item.volume ?? 1) * (track.volume / 100), 2))
        const volume = Math.max(
          0,
          Math.min((item.volume ?? 1) * (track.volume / 100), 2)
        );

        const videoSequence: VideoSequenceItem = {
          id: item.id,
          name: item.name,
          url: finalUrl,
          // Same-origin local storage hint retained for preview diagnostics.
          // Export uses `url`, which is already the canonical local reference
          // when one is available.
          cacheUrl: material.cacheUrl,
          startTime: item.startTime,
          duration: item.duration,
          thumbnailUrl: item.thumbnailUrl || material.thumbnailUrl,
          materialId: item.materialId,
          trackId: item.trackId,
          clipStart,
          clipEnd,
          originalDuration,
          volume,
          // Pass through the detach flag verbatim so 02/05 can suppress this
          // video's audio. URL selection is intentionally unchanged (spec 01 §3).
          audioDetached: item.audioDetached,
          // Multi-track / transition metadata (spec 05 §2.2). z-order from the
          // track order (lower draws first), opacity + transitions verbatim so
          // the export filtergraph reproduces the preview compositor.
          trackZ: track.order,
          opacity: item.opacity,
          transitionIn: item.transitionIn,
          transitionOut: item.transitionOut,
          // 2D/3D 运镜 — the preview compositor samples it per frame; the export
          // mapping below carries the SAME object to the backend so the two
          // renderers consume one geometry (timeline-camera-motion §1.3 L2).
          cameraMotion: item.cameraMotion,
        };

        allVideoItems.push(videoSequence);
      }
    }

    return allVideoItems;
  }

  /**
   * Extract audio sequences from timeline tracks.
   *
   * Logic extracted verbatim from useTimelineComposition.ts#getAudioSequencesFromTimeline:
   * 1. Filter tracks: type='audio', isVisible=true, !isLocked, !isMuted
   * 2. For each item with type='audio' and a materialId, find the matching material
   * 3. Select URL: prefer local backend reference, fallback serverUrl/url
   * 4. Compute volume: (item.volume ?? 1) * (track.volume / 100), clamped [0, 2]
   * 5. Sort results by startTime ascending
   */
  extractAudioSequences(
    tracks: TrackData[],
    materials: MaterialData[]
  ): AudioSequenceItem[] {
    const allAudioItems: AudioSequenceItem[] = [];

    for (const track of tracks) {
      // Filter: audio tracks that are visible, unlocked, and unmuted
      // Matches exact condition from useTimelineComposition.ts:
      //   track.type === 'audio' && track.isVisible && !track.isLocked && !track.isMuted
      if (
        track.type !== 'audio' ||
        !track.isVisible ||
        track.isLocked ||
        track.isMuted
      ) {
        continue;
      }

      for (const item of track.items) {
        if (item.type !== 'audio' || !item.materialId) {
          continue;
        }

        const material = materials.find(
          (m) => m.id === item.materialId
        ) as CompositionMaterialData | undefined;

        if (!material || material.type !== 'audio') {
          continue;
        }

        // Clip info
        const clipStart = item.clipStart ?? 0;
        const clipEnd = item.clipEnd ?? item.originalDuration ?? item.duration;
        const originalDuration = item.originalDuration ?? item.duration;

        const finalUrl = selectCanonicalExportReference(material);

        // Volume calculation — same formula as video
        const volume = Math.max(
          0,
          Math.min((item.volume ?? 1) * (track.volume / 100), 2)
        );

        const audioSequence: AudioSequenceItem = {
          id: item.id,
          name: item.name,
          url: finalUrl,
          startTime: item.startTime,
          duration: item.duration,
          materialId: item.materialId,
          trackId: item.trackId,
          volume,
          clipStart,
          clipEnd,
          originalDuration,
        };

        allAudioItems.push(audioSequence);
      }
    }

    // Sort by startTime ascending (matches useTimelineComposition.ts)
    allAudioItems.sort((a, b) => a.startTime - b.startTime);

    return allAudioItems;
  }

  /**
   * Extract subtitle sequences from timeline tracks (spec 02 §2.3 / §5).
   *
   * Filters for visible subtitle tracks and subtitle items carrying text.
   * Materials are not consulted — subtitle text/style live on the item. The
   * SubtitleLayer resolves `style` (timeline `SubtitleStyle`) to draw defaults.
   * Sorted by startTime ascending for stable signature ordering.
   */
  extractSubtitleSequences(tracks: TrackData[]): SubtitleSequenceItem[] {
    const subtitles: SubtitleSequenceItem[] = [];

    for (const track of tracks) {
      if (track.type !== 'subtitle' || !track.isVisible) {
        continue;
      }

      for (const item of track.items) {
        const text = item.text?.trim();
        if (item.type !== 'subtitle' || !text) {
          continue;
        }

        subtitles.push({
          id: item.id,
          text: item.text ?? '',
          startTime: item.startTime,
          duration: item.duration,
          trackId: item.trackId,
          style: item.subtitleStyle,
        });
      }
    }

    subtitles.sort((a, b) => a.startTime - b.startTime);
    return subtitles;
  }

  /**
   * Build a video composition request from extracted sequences.
   *
   * Transforms domain-layer sequence items into the snake_case format
   * expected by the backend /api/video-compose endpoint.
   */
  buildCompositionRequest(
    videoSequences: VideoSequenceItem[],
    audioSequences: AudioSequenceItem[],
    config: CompositionConfig
  ): VideoCompositionRequest {
    return {
      video_sequences: videoSequences.map((seq) => ({
        id: seq.id,
        name: seq.name,
        url: seq.url,
        start_time: seq.startTime,
        duration: seq.duration,
        clip_start: seq.clipStart,
        clip_end: seq.clipEnd,
        original_duration: seq.originalDuration,
        volume: seq.volume ?? 1,
        audio_detached: seq.audioDetached,
        // Multi-track / transition pass-through (spec 05 §2.2): z-order,
        // opacity, and fade/dissolve transitions reproduce the preview.
        track_z: seq.trackZ,
        opacity: seq.opacity,
        transition_in: seq.transitionIn,
        transition_out: seq.transitionOut,
        camera_motion: toCameraMotionWire(seq.cameraMotion),
      })),
      audio_sequences: audioSequences.map((seq) => ({
        id: seq.id,
        name: seq.name,
        url: seq.url,
        start_time: seq.startTime,
        duration: seq.duration,
        clip_start: seq.clipStart,
        clip_end: seq.clipEnd,
        volume: seq.volume ?? 1,
      })),
      output_config: {
        width: config.width ?? 1920,
        height: config.height ?? 1080,
        format: config.format ?? 'mp4',
      },
      task_id: config.taskId,
      total_duration: config.totalDuration,
    };
  }
}
