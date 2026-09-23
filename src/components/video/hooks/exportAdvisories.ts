/**
 * exportAdvisories — the non-blocking notes of the pre-export check (spec R2
 * §3.11). They are computed only AFTER `planVideoExport` said "ready": the
 * blocking refusals (missing material, nothing visible) are unchanged (I-10).
 * An advisory may be exactly what the user wants (no subtitles, bars), so it
 * never stops the export — it only asks once.
 */

import type {
  CanvasFit,
  DismissibleExportAdvisory,
  MaterialItem,
} from '@/types';
import type { SegmentStatus } from '../lib/segments/segmentLinks';
import { resolveItemSegmentId } from '../lib/segments/segmentLinks';

export type ExportAdvisoryCode =
  | 'voice-pending' | 'voice-stale' | 'subtitle-none' | 'letterbox' | 'black-tail';

export interface ExportAdvisory {
  code: ExportAdvisoryCode;
  /** Ordinals of the segments concerned (voice advisories). */
  segmentOrdinals: number[];
  /** First segment to select for "review". */
  segmentId: string | null;
  /** Seconds of black tail (black-tail only). */
  seconds?: number;
  /** Only these can be dismissed for the project. */
  dismissible: boolean;
}

interface AdvisoryItem {
  type: string;
  materialId?: string;
  metadata?: Record<string, unknown>;
  sentenceSegments?: { segment_id?: string } | null;
}

interface AdvisoryTrack {
  type: string;
  items: readonly AdvisoryItem[];
}

export interface CollectExportAdvisoriesInput {
  /** Segment ids in script order. */
  segmentIds: readonly string[];
  statusById: ReadonlyMap<string, SegmentStatus>;
  tracks: readonly AdvisoryTrack[];
  materialsById: ReadonlyMap<string, MaterialItem>;
  fit: CanvasFit;
  /** Canvas ratio id, e.g. '16:9'. */
  aspectRatioId: string;
  blackTailSeconds: number;
  /** Tail length from which the black-tail note shows. */
  blackTailThreshold: number;
  dismissed: readonly DismissibleExportAdvisory[];
}

/** Relative ratio difference above which a picture counts as letterboxed. */
const LETTERBOX_TOLERANCE = 0.02;

export function parseAspectRatio(id: string): number | null {
  const [width, height] = id.split(':').map(Number);
  return width > 0 && height > 0 ? width / height : null;
}

function segmentsWhere(
  segmentIds: readonly string[],
  statusById: ReadonlyMap<string, SegmentStatus>,
  test: (status: SegmentStatus) => boolean,
): { ids: string[]; ordinals: number[] } {
  const ids: string[] = [];
  const ordinals: number[] = [];
  segmentIds.forEach((segmentId, index) => {
    const status = statusById.get(segmentId);
    if (status && test(status)) { ids.push(segmentId); ordinals.push(index + 1); }
  });
  return { ids, ordinals };
}

function hasNarrationWithoutSubtitles(input: CollectExportAdvisoriesInput): boolean {
  const narrated = input.tracks.some((track) => track.type === 'audio' && track.items.some(
    (item) => resolveItemSegmentId({ id: '', startTime: 0, duration: 0, ...item }, input.materialsById) !== null,
  ));
  const hasSubtitles = input.tracks.some((track) => track.type === 'subtitle' && track.items.length > 0);
  return narrated && !hasSubtitles;
}

function hasLetterbox(input: CollectExportAdvisoriesInput): boolean {
  const canvas = parseAspectRatio(input.aspectRatioId);
  if (input.fit !== 'contain' || canvas === null) return false;
  return input.tracks.some((track) => track.type === 'video' && track.items.some((item) => {
    if (item.type !== 'video') return false;
    const material = item.materialId ? input.materialsById.get(item.materialId) : undefined;
    if (!material || material.type !== 'video' || !material.width || !material.height) return false;
    const ratio = material.width / material.height;
    return Math.abs(ratio - canvas) / canvas > LETTERBOX_TOLERANCE;
  }));
}

export function collectExportAdvisories(input: CollectExportAdvisoriesInput): ExportAdvisory[] {
  const advisories: ExportAdvisory[] = [];
  const pending = segmentsWhere(input.segmentIds, input.statusById,
    (status) => status.candidate !== null && !status.candidate.isStale);
  if (pending.ids.length > 0) {
    advisories.push({ code: 'voice-pending', segmentOrdinals: pending.ordinals,
      segmentId: pending.ids[0], dismissible: false });
  }
  const stale = segmentsWhere(input.segmentIds, input.statusById, (status) => status.voice === 'stale');
  if (stale.ids.length > 0) {
    advisories.push({ code: 'voice-stale', segmentOrdinals: stale.ordinals,
      segmentId: stale.ids[0], dismissible: false });
  }
  if (!input.dismissed.includes('subtitle-none') && hasNarrationWithoutSubtitles(input)) {
    advisories.push({ code: 'subtitle-none', segmentOrdinals: [], segmentId: null, dismissible: true });
  }
  if (!input.dismissed.includes('letterbox') && hasLetterbox(input)) {
    advisories.push({ code: 'letterbox', segmentOrdinals: [], segmentId: null, dismissible: true });
  }
  if (input.blackTailSeconds > input.blackTailThreshold) {
    advisories.push({ code: 'black-tail', segmentOrdinals: [], segmentId: null,
      seconds: input.blackTailSeconds, dismissible: false });
  }
  return advisories;
}
