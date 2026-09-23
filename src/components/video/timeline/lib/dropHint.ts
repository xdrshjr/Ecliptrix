/**
 * dropHint — what the badge next to the pointer says while a material is
 * dragged over a lane (spec R2 §3.10). Drops always append at the lane's end
 * (§2.2), so the accepted hint names that exact time.
 */

import type { MaterialItem } from '@/types';
import { computeAppendStart, type AppendTrackLike } from '../domain/services/ItemPlacementService';
import { formatTimelineTime } from '../timeFormat';

export interface DropHintCopy {
  /** '追加到末尾 · {time}' */
  dropAppend: string;
  dropLocked: string;
  /** '此轨道不接受{type}' */
  dropIncompatible: string;
}

/** Localized material type names, e.g. materialsPanel.typeVideo. */
export interface MaterialTypeLabels {
  typeVideo: string;
  typeAudio: string;
  typeImage: string;
  typeSubtitle: string;
}

export type DropHintTone = 'accept' | 'refuse';

export interface DropHint {
  text: string;
  tone: DropHintTone;
}

export interface DescribeDropHintInput {
  track: AppendTrackLike & { isLocked: boolean };
  materialType: string;
  /** Result of the lane's own compatibility check, lock folded in or not. */
  isCompatible: boolean;
  copy: DropHintCopy;
  typeLabels: MaterialTypeLabels;
}

function materialTypeLabel(type: string, labels: MaterialTypeLabels): string {
  const byType: Partial<Record<MaterialItem['type'], string>> = {
    video: labels.typeVideo,
    audio: labels.typeAudio,
    image: labels.typeImage,
    subtitle: labels.typeSubtitle,
  };
  return byType[type as MaterialItem['type']] ?? type;
}

/** Lock wins over type: a locked lane refuses everything. */
export function describeDropHint(input: DescribeDropHintInput): DropHint {
  const { track, materialType, isCompatible, copy, typeLabels } = input;
  if (track.isLocked) return { text: copy.dropLocked, tone: 'refuse' };
  if (!isCompatible) {
    const label = materialTypeLabel(materialType, typeLabels);
    return { text: copy.dropIncompatible.replace('{type}', label), tone: 'refuse' };
  }
  const time = formatTimelineTime(computeAppendStart(track), { showMs: true });
  return { text: copy.dropAppend.replace('{time}', time), tone: 'accept' };
}
