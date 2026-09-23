/**
 * stampMaterialForSegment — the one way a library material is tagged as
 * "belongs to segment N" (spec R2 §3.6).
 *
 * ScriptPanel's "更换画面" stamps the matched videos in place (same id, the
 * library replaces the entry). Replacing a segment's visual with a material
 * already stamped for ANOTHER segment must not re-tag it — that would move
 * every clip of the other segment — so that path asks for a copy with a new
 * id instead.
 */

import type { MaterialItem } from '@/types';

export interface SegmentStamp {
  segmentId: string;
  segmentNumber: number;
  segmentTitle?: string;
  /** 1-based slot of the video inside the segment. */
  videoIndexInSegment: number;
  /** `segment_assigned_at`; auto-mix keeps the newest stamp per slot. */
  assignedAt: number;
  /** Localised "第 {index} 段" prefix for the name / description. */
  segmentPrefix: string;
}

export function stampMaterialForSegment(
  material: MaterialItem,
  stamp: SegmentStamp,
  copyId?: string,
): MaterialItem {
  const prefix = stamp.segmentPrefix.replace('{index}', String(stamp.segmentNumber));
  return {
    ...material,
    ...(copyId ? { id: copyId } : {}),
    name: `${prefix} - ${material.name}`,
    description: `${prefix} "${stamp.segmentTitle || ''}" - ${material.description || material.name}`,
    metadata: {
      ...material.metadata,
      segment_id: stamp.segmentId,
      segment_number: stamp.segmentNumber,
      segment_title: stamp.segmentTitle,
      video_index_in_segment: stamp.videoIndexInSegment,
      segment_assigned_at: stamp.assignedAt,
    },
  };
}

/** The segment a material is stamped for (`segment_id`, else `linkedSegmentId`). */
export function readMaterialSegmentStamp(material: MaterialItem): string | null {
  const fromSegment: unknown = material.metadata?.segment_id;
  if (typeof fromSegment === 'string' && fromSegment.length > 0) return fromSegment;
  const linked: unknown = material.metadata?.linkedSegmentId;
  return typeof linked === 'string' && linked.length > 0 ? linked : null;
}
