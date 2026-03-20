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
 * The extraction preserves EXACT behavior:
 *   - URL selection: serverUrl preferred, fallback to url
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
  CompositionConfig,
  VideoCompositionRequest,
} from '../domain/ports';
import type { TrackData, MaterialData } from '../domain/types';

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
  metadata?: {
    isWatermarkRemoved?: boolean;
    source?: string;
    [key: string]: unknown;
  };
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
   * 3. Select URL: prefer material.serverUrl, fallback material.url
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

        // URL selection: prefer serverUrl, fallback url
        // This matches the exact logic in useTimelineComposition.ts:
        //   const finalUrl = material.serverUrl || material.url;
        const finalUrl = material.serverUrl || material.url || '';

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
          startTime: item.startTime,
          duration: item.duration,
          thumbnailUrl: item.thumbnailUrl || material.thumbnailUrl,
          materialId: item.materialId,
          trackId: item.trackId,
          clipStart,
          clipEnd,
          originalDuration,
          volume,
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
   * 3. Select URL: prefer material.serverUrl, fallback material.url
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

        // URL selection: prefer serverUrl, fallback url
        const finalUrl = material.serverUrl || material.url || '';

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
