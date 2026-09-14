/**
 * clipCutResults — clip-cut placeholders and pairing the cut results with them.
 *
 * The backend skips a clip whose ffmpeg cut failed and returns only the
 * successful ones, each carrying the request id. Results used to be paired
 * with placeholders by array index, so after a failed middle clip the next
 * file landed on the wrong placeholder and the last placeholder stayed
 * "uploading" forever (DS3-04). Pairing is by id.
 *
 * A clip is a new material: it must not inherit the original's script
 * segment membership, or the auto-mix planner treats it as the segment's
 * newest match and it displaces the original (N-13).
 */

import type { MaterialItem, VideoCutClipRequest, VideoCutClipResult } from '@/types';
import { buildDerivedMaterial, withoutScriptSegment } from './derivedMaterial';

export interface PendingClip {
  clipId: string;
  material: MaterialItem;
}

export interface ClipCutMatch {
  pending: PendingClip;
  result: VideoCutClipResult;
}

/** mm:ss, as shown in the clip description. */
function formatClipTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${rest.toString().padStart(2, '0')}`;
}

/**
 * The "processing" material shown in the library while the cut runs.
 * `descriptionTemplate` is the localized `{name} / {start} / {end}` text, so
 * the stored description follows the UI language instead of fixed Chinese.
 */
export function buildClipPlaceholder(
  original: MaterialItem,
  clip: VideoCutClipRequest,
  index: number,
  total: number,
  descriptionTemplate: string,
): PendingClip {
  // ME-01: storage identity (storageKey / cacheUrl / localResolvedUrl) is never
  // inherited, so preview, export and delete never touch the original file.
  const derived = buildDerivedMaterial(
    original,
    { url: '', duration: clip.duration, thumbnailUrl: original.thumbnailUrl },
    {
      id: `${original.id}_clip_${clip.id}`,
      name: `${original.name} - ${clip.name}`,
      metadata: {
        ...withoutScriptSegment(original.metadata),
        isClip: true,
        originalMaterialId: original.id,
        originalMaterialDuration: original.duration,
        clipStartTime: clip.start_time,
        clipEndTime: clip.end_time,
        clipDuration: clip.duration,
        clipIndex: index + 1,
        totalClips: total,
      },
    },
  );
  const material: MaterialItem = {
    ...derived,
    type: 'video',
    format: original.format || 'mp4',
    size: 0,
    description: descriptionTemplate
      .replace('{name}', original.name)
      .replace('{start}', formatClipTime(clip.start_time))
      .replace('{end}', formatClipTime(clip.end_time)),
    analysisResult: undefined, // the original's analysis describes the whole video
    uploadStatus: 'uploading',
    uploadProgress: 0,
  };
  return { clipId: clip.id, material };
}

/** Pair results with placeholders by clip id; placeholders left over failed. */
export function matchClipCutResults(
  pending: readonly PendingClip[],
  results: readonly VideoCutClipResult[],
): { matched: ClipCutMatch[]; unmatched: PendingClip[] } {
  const resultsById = new Map<string, VideoCutClipResult>();
  const knownIds = new Set(pending.map((entry) => entry.clipId));
  results.forEach((result) => {
    if (!knownIds.has(result.id)) {
      console.warn('[clipCut] result for unknown clip id', { id: result.id });
      return;
    }
    resultsById.set(result.id, result);
  });
  const matched: ClipCutMatch[] = [];
  const unmatched: PendingClip[] = [];
  pending.forEach((entry) => {
    const result = resultsById.get(entry.clipId);
    if (result) {
      matched.push({ pending: entry, result });
    } else {
      unmatched.push(entry);
    }
  });
  return { matched, unmatched };
}

/** The finished clip material, its storage identity rebuilt from the cut file. */
export function buildCutClipMaterial(
  original: MaterialItem,
  pending: PendingClip,
  result: VideoCutClipResult,
): MaterialItem {
  const placeholder = pending.material;
  return {
    ...buildDerivedMaterial(
      original,
      {
        url: result.video_url,
        thumbnailUrl: result.thumbnail_url || placeholder.thumbnailUrl,
        duration: placeholder.duration,
      },
      {
        id: placeholder.id,
        name: placeholder.name,
        metadata: { ...placeholder.metadata, cutClipResult: result },
      },
    ),
    type: 'video',
    description: placeholder.description,
    analysisResult: undefined,
    size: result.file_size,
    width: result.width,
    height: result.height,
    format: result.format,
    uploadStatus: 'completed',
    uploadProgress: 100,
  };
}
