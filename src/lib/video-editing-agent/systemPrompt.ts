import type { TimelineState, MaterialItem } from '@/types';

/**
 * Tool overview entry: tool name and a one-line description.
 * Kept in sync with the actual tool definitions in ./tools/.
 * The descriptions here are intentionally brief — full parameter schemas
 * are provided through the function-calling `tools` parameter (L1).
 */
interface ToolOverviewEntry {
  name: string;
  desc: string;
}

/**
 * Registry of all tools with their one-line descriptions.
 * This is the single source of truth for the L0 tool overview in the system prompt.
 * When adding or removing tools, update this array accordingly.
 */
const TOOL_OVERVIEW_ENTRIES: ToolOverviewEntry[] = [
  { name: 'get_timeline', desc: 'Get full timeline state (tracks, clips, timing, properties)' },
  { name: 'list_materials', desc: 'List all materials in the library, optionally filtered by type' },
  { name: 'search_materials', desc: 'Search materials by name, content description, or transcript text' },
  { name: 'add_to_track', desc: 'Add a material to a timeline track at a specified position' },
  { name: 'trim_clip', desc: 'Trim a clip by adjusting its source in/out points' },
  { name: 'delete_clip', desc: 'Remove a clip from the timeline' },
  { name: 'move_clip', desc: 'Move a clip to a new position or different track' },
  { name: 'resize_clip', desc: 'Change a clip\'s display duration on the timeline' },
];

/**
 * Format a one-line-per-tool overview for the system prompt.
 * No parameter schemas — those are provided via function-calling tools definition (L1).
 *
 * Example output:
 *   - get_timeline: Get full timeline state (tracks, clips, timing, properties)
 *   - list_materials: List all materials in the library, optionally filtered by type
 *   ...
 */
export function formatToolOverview(): string {
  return TOOL_OVERVIEW_ENTRIES.map(t => `- ${t.name}: ${t.desc}`).join('\n');
}

/**
 * Map from internal track type to human-readable label.
 */
const TRACK_TYPE_LABELS: Record<string, string> = {
  video: 'video',
  audio: 'audio',
  subtitle: 'subtitle',
};

/**
 * Format a compact project summary containing only aggregate statistics.
 * Replaces the old formatTimelineSummary() + formatMaterialsSummary() pair.
 *
 * Design constraints:
 * - Output must stay under ~100 tokens regardless of project scale (even 100+ materials)
 * - Contains enough information for the Agent to decide whether to call get_timeline/search_materials
 * - Includes track annotations (locked/muted) since they affect which operations are possible
 *
 * Example output for a mid-size project:
 *   Tracks: video(3 clips), audio(2 clips), subtitle(empty)
 *   Duration: 45.2s
 *   Materials: 5 video, 3 audio, 8 image, 0 subtitle
 *
 * Example output for an empty project:
 *   Tracks: none
 *   Duration: 0.0s
 *   Materials: none
 */
export function formatCompactSummary(
  timelineState: TimelineState,
  materials: MaterialItem[]
): string {
  const lines: string[] = [];

  // --- Track summary ---
  const tracks = timelineState.tracks ?? [];
  if (tracks.length === 0) {
    lines.push('Tracks: none');
  } else {
    const trackParts: string[] = [];
    for (const track of tracks) {
      const items = track.items ?? [];
      const clipCount = items.length;
      const label = TRACK_TYPE_LABELS[track.type] ?? track.type;

      // Build annotation suffixes for locked/muted states
      const annotations: string[] = [];
      if (track.isLocked) annotations.push('locked');
      if (track.isMuted) annotations.push('muted');

      let part: string;
      if (clipCount === 0) {
        part = `${label}(empty)`;
      } else {
        part = `${label}(${clipCount} clip${clipCount !== 1 ? 's' : ''})`;
      }

      if (annotations.length > 0) {
        part += ` [${annotations.join(',')}]`;
      }

      trackParts.push(part);
    }
    lines.push(`Tracks: ${trackParts.join(', ')}`);
  }

  // --- Duration ---
  const totalDuration = timelineState.totalDuration ?? 0;
  lines.push(`Duration: ${totalDuration.toFixed(1)}s`);

  // --- Material summary ---
  if (materials.length === 0) {
    lines.push('Materials: none');
  } else {
    const counts: Record<string, number> = {};
    for (const m of materials) {
      counts[m.type] = (counts[m.type] ?? 0) + 1;
    }

    // Use a stable ordering: video, audio, image, subtitle, then anything else
    const typeOrder = ['video', 'audio', 'image', 'subtitle'];
    const orderedParts: string[] = [];
    const seen = new Set<string>();

    for (const t of typeOrder) {
      orderedParts.push(`${counts[t] ?? 0} ${t}`);
      seen.add(t);
    }

    // Append any unexpected types that aren't in the standard order
    for (const t of Object.keys(counts)) {
      if (!seen.has(t)) {
        orderedParts.push(`${counts[t]} ${t}`);
      }
    }

    lines.push(`Materials: ${orderedParts.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Build the L0 system prompt for the video editing agent.
 *
 * This is the progressive context system's base level — always injected, always compact.
 * The prompt is structured as:
 *   1. Role (minimal — 2 sentences)
 *   2. Tool overview (one line per tool, no param schemas)
 *   3. Project summary (aggregate stats only)
 *   4. Operation guidelines (how to use tools effectively)
 *
 * Total token budget: < 500 tokens under any project size.
 * The Agent gets detailed data through L1 (function-calling tool schemas) and
 * L2 (calling get_timeline / list_materials / search_materials at runtime).
 *
 * @param timelineState - Current timeline state (tracks, clips, duration)
 * @param materials - All materials in the library
 * @returns The complete system prompt string
 */
export function buildSystemPrompt(
  timelineState: TimelineState,
  materials: MaterialItem[]
): string {
  return `You are a video editing assistant. Analyze user requests, select the right tools, and execute editing operations step by step.

## Rules (MANDATORY)
- You MUST call tools to perform ANY timeline operation (add, trim, delete, move, resize). Describing operations in text does NOT execute them — the user will see no changes.
- NEVER say "I have done X" or "I will do X" without actually calling the corresponding tool first. Text descriptions are NOT operations.
- Workflow: (1) query state with get_timeline/list_materials/search_materials, (2) call operation tools to make changes, (3) briefly summarize what was done.
- If the user asks you to edit, cut, add, or arrange materials, you MUST call the operation tools. Do not just describe a plan.

## Tools
${formatToolOverview()}

## Project
${formatCompactSummary(timelineState, materials)}

## Guidelines
- For detailed timeline state, call get_timeline. For finding materials, call list_materials or search_materials.
- When the user's intent is clear and specific (e.g. "trim the first clip by 5s"), operate directly using clip/track info from previous tool results or conversation context.
- When the request is ambiguous or you need IDs, query first with get_timeline or search_materials before operating.
- search_materials matches against names, AI-generated content descriptions, and transcript text.
- After completing operations, briefly summarize what you did. Do not repeat the full operation details — the user can see tool results.`.trim();
}

// ============================================================================
// Legacy functions — kept for backward compatibility during transition.
// These are no longer used by buildSystemPrompt() but may be referenced
// by other modules or tests. Marked deprecated; remove once all consumers
// have migrated.
// ============================================================================

/**
 * @deprecated Use formatCompactSummary() instead. This function produces verbose
 * per-clip output that bloats the system prompt. Retained temporarily for
 * backward compatibility.
 */
export function formatTimelineSummary(timelineState: TimelineState): string {
  const lines: string[] = [];
  const totalDuration = timelineState.totalDuration ?? 0;
  const tracks = timelineState.tracks ?? [];
  lines.push(`Total duration: ${totalDuration.toFixed(1)}s`);
  lines.push(`Tracks: ${tracks.length}`);

  for (const track of tracks) {
    const items = track.items ?? [];
    const clipCount = items.length;
    const locked = track.isLocked ? ' [LOCKED]' : '';
    const muted = track.isMuted ? ' [MUTED]' : '';
    lines.push(`- ${track.name || track.id} (${track.type})${locked}${muted}: ${clipCount} clip(s)`);

    for (const item of items) {
      const startTime = item.startTime ?? 0;
      const duration = item.duration ?? 0;
      lines.push(
        `  - "${item.name}" id=${item.id} at ${startTime.toFixed(1)}s, duration=${duration.toFixed(1)}s`
      );
    }
  }

  return lines.join('\n');
}

/**
 * @deprecated Use formatCompactSummary() instead. This function dumps every
 * material's full attributes including AI analysis text, which can reach
 * 2000+ tokens. Retained temporarily for backward compatibility.
 */
export function formatMaterialsSummary(materials: MaterialItem[]): string {
  if (materials.length === 0) return 'No materials available.';

  const lines: string[] = [];
  lines.push(`Total materials: ${materials.length}`);

  const byType = new Map<string, MaterialItem[]>();
  for (const m of materials) {
    const list = byType.get(m.type) || [];
    list.push(m);
    byType.set(m.type, list);
  }

  for (const [type, items] of Array.from(byType.entries())) {
    lines.push(`\n### ${type} (${items.length})`);
    for (let i = 0; i < items.length; i++) {
      const m = items[i];
      let info = `${i + 1}. "${m.name}" id=${m.id}`;
      if (m.duration) info += ` ${m.duration.toFixed(1)}s`;
      if (m.width && m.height) info += ` ${m.width}x${m.height}`;
      if (m.format) info += ` [${m.format}]`;
      if (m.description) info += ` - ${m.description}`;
      if (m.tags?.length) info += ` tags:[${m.tags.join(',')}]`;
      if (m.analysisResult?.status === 'completed' && m.analysisResult.analysis) {
        info += ` | AI分析: ${m.analysisResult.analysis}`;
      } else if (m.analysisResult?.status === 'pending') {
        info += ` | (解析中...)`;
      }
      if (m.sentenceSegments?.sentences.length) {
        const fullText = m.sentenceSegments.sentences.map(s => s.text).join('');
        const displayText = fullText.length > 100 ? fullText.substring(0, 100) + '...' : fullText;
        info += ` | 原始文本: "${displayText}"`;
      }
      lines.push(info);
    }
  }

  return lines.join('\n');
}
