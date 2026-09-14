/**
 * External timeline update ids.
 *
 * Every write that reaches the timeline store from outside the panel (agent
 * operations, agent undo, file import) is tagged with an id; TimelinePanel
 * applies an update only when the id differs from the last one it saw. Ids
 * built from `Date.now()` alone collide when two renders land in the same
 * millisecond, and the second write is then silently dropped — so every id
 * carries a module-level monotonic counter as well.
 */

import type { ReplaceTimelineReason } from '../store/actions/replaceTimeline';

export type ExternalUpdatePrefix =
  | 'agent-op'
  | 'agent-undo'
  | 'agent-undo-single'
  | 'timeline-update';

let externalUpdateCounter = 0;

/** Build a unique id for an external timeline write. */
export function nextExternalUpdateId(prefix: ExternalUpdatePrefix): string {
  externalUpdateCounter += 1;
  return `${prefix}-${Date.now()}-${externalUpdateCounter}`;
}

/** Map an external update id back to the history reason it records. */
export function reasonFromExternalUpdateId(id: string): ReplaceTimelineReason {
  if (id.startsWith('agent-undo')) return 'agent-undo';
  if (id.startsWith('agent-op')) return 'agent';
  return 'import';
}
