/**
 * segmentMenuExtras — the R2 entries of a segment card's ⋯ menu (spec R2
 * §3.4.2 / §3.8 / §3.12): polish, apply the new voice-over, voice versions,
 * move up / down. Pure builders so the menu order is unit-testable.
 */

import type { MaterialItem, ScriptSegment } from '@/types';
import type { SegmentLinksValue } from '../../lib/segments/SegmentLinksContext';
import type { SegmentCommands } from '../../hooks/useSegmentCommands';
import { isCandidateStale, voiceLength } from '../../lib/segments/segmentCommands';
import type { SegmentMenuItem } from './SegmentMoreMenu';

export interface CommandMenuCopy {
  polish: string;
  applyNewVoice: string;
  voiceVersionItem: string;
  voiceVersionCurrent: string;
  voiceVersionStale: string;
  moveUp: string;
  moveDown: string;
}

export interface CommandMenuInput {
  segment: ScriptSegment;
  position: number;
  count: number;
  links: SegmentLinksValue;
  commands: SegmentCommands;
  copy: CommandMenuCopy;
  onPolish?(segment: ScriptSegment): void;
}

function formatClock(material: MaterialItem): string {
  const stamp: unknown = material.metadata?.segment_assigned_at;
  if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return '--:--';
  const date = new Date(stamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The voice-over currently used by the segment (applied, else latest on the timeline). */
function currentVoiceId(segment: ScriptSegment, links: SegmentLinksValue): string | null {
  const status = links.statusById.get(segment.id);
  if (!status || status.voiceOnTimeline === 'absent') return null;
  return segment.appliedVoiceMaterialId ?? links.latestVoiceById.get(segment.id)?.id ?? null;
}

export function buildVoiceVersionItems(input: CommandMenuInput): SegmentMenuItem[] {
  const { segment, links, commands, copy } = input;
  const versions = links.voiceVersionsById?.get(segment.id) ?? [];
  const current = currentVoiceId(segment, links);
  return versions.map((material, index) => {
    const values = { time: formatClock(material), duration: voiceLength(material).toFixed(1) };
    const fill = (template: string) =>
      template.replace('{time}', values.time).replace('{duration}', values.duration);
    const stale = isCandidateStale(material, segment);
    const isCurrent = material.id === current;
    return {
      key: `voice-version-${material.id}`,
      label: isCurrent
        ? fill(copy.voiceVersionCurrent)
        : `${fill(copy.voiceVersionItem)}${stale ? copy.voiceVersionStale : ''}`,
      disabled: isCurrent,
      onSelect: () => commands.applyVoice(segment.id, material.id, { allowStale: true }),
      separatorBefore: index === 0,
    };
  });
}

/** Entries placed before the existing "generate voice" item. */
export function buildLeadingCommandItems(input: CommandMenuInput): SegmentMenuItem[] {
  const { segment, links, commands, copy, onPolish } = input;
  const items: SegmentMenuItem[] = [];
  if (onPolish) items.push({ key: 'polish', label: copy.polish, onSelect: () => onPolish(segment) });
  const candidate = links.statusById.get(segment.id)?.candidate;
  if (candidate && !candidate.isStale) {
    items.push({
      key: 'apply-voice',
      label: copy.applyNewVoice,
      onSelect: () => commands.applyVoice(segment.id, candidate.materialId),
    });
  }
  return items;
}

/** Entries placed before "delete": voice versions, then move up / down. */
export function buildTrailingCommandItems(input: CommandMenuInput): SegmentMenuItem[] {
  const { segment, position, count, commands, copy } = input;
  return [
    ...buildVoiceVersionItems(input),
    {
      key: 'move-up',
      label: copy.moveUp,
      onSelect: () => commands.move(segment.id, position - 1),
      disabled: position === 0,
      separatorBefore: true,
    },
    {
      key: 'move-down',
      label: copy.moveDown,
      onSelect: () => commands.move(segment.id, position + 1),
      disabled: position >= count - 1,
    },
  ];
}
