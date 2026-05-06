/**
 * Pure helpers for inspecting a `ChatMessage[]` history and surfacing the
 * advanced tool categories the user has previously drilled into via
 * `explore_tools`.
 *
 * Spec: docs/plans/video-agent-prompt-persistence/spec.md §2.7 / §3 row 3.
 *
 * NOTE: `CategoryId` and `ON_DEMAND_CATEGORY_IDS` are re-exported by
 * `./registry` (see `registry/index.ts`) — do NOT redefine them here.
 */

import type { ChatMessage, AgentToolCallRecord } from '@/types';
import { ON_DEMAND_CATEGORY_IDS, type CategoryId } from './registry';

/**
 * Extract the agent tool-call records (if any) from a single chat message.
 * Returns an empty array for user messages, plain assistant messages, or
 * agent assistant messages that didn't produce any tool calls.
 *
 * Pure — no side effects.
 */
export function extractAgentToolCalls(message: ChatMessage): AgentToolCallRecord[] {
  if (message.role !== 'assistant') return [];
  if (!message.isAgentMessage) return [];
  const calls = message.agentToolCalls;
  if (!Array.isArray(calls)) return [];
  return calls;
}

/**
 * Walk `messages` in order and return the deduplicated, ordered list of
 * advanced tool category IDs that the agent has already loaded via
 * `explore_tools` in earlier turns of this conversation.
 *
 * Filtering rules (see spec §2.7 / §6.1):
 *   - Tool name must be exactly `'explore_tools'`.
 *   - `params.category` must be a string and must appear in
 *     `ON_DEMAND_CATEGORY_IDS` (defensive: ignore unknown categories).
 *   - `status` must be `'completed'`. The other statuses
 *     (`'executing'`, `'error'`, `'undone'`) are excluded — see notes below.
 *
 * Why exclude statuses other than `'completed'`:
 *   - `'executing'` — call hasn't returned yet; result not materialised.
 *   - `'error'` — explore failed; we have no expanded block to replay.
 *   - `'undone'` — the user rolled back this turn; replaying the category
 *     in the system prompt would resurrect guidance the user explicitly
 *     reverted.
 *
 * Order is "first-seen wins" within the conversation. Pure — no side effects.
 */
export function scanExploredCategories(messages: ChatMessage[]): CategoryId[] {
  const valid = new Set<string>(ON_DEMAND_CATEGORY_IDS as readonly string[]);
  const seen = new Set<string>();
  const ordered: CategoryId[] = [];

  for (const msg of messages) {
    const calls = extractAgentToolCalls(msg);
    for (const call of calls) {
      if (call.name !== 'explore_tools') continue;
      if (call.status !== 'completed') continue;

      const rawCategory = call.params?.['category'];
      if (typeof rawCategory !== 'string') continue;
      if (!valid.has(rawCategory)) continue;
      if (seen.has(rawCategory)) continue;

      seen.add(rawCategory);
      ordered.push(rawCategory as CategoryId);
    }
  }

  return ordered;
}
