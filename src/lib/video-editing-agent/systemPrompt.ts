import type { TimelineState, MaterialItem } from '@/types';

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
      lines.push(info);
    }
  }

  return lines.join('\n');
}

export function buildSystemPrompt(timelineState: TimelineState, materials: MaterialItem[]): string {
  return `You are a video editing assistant. You help users edit videos by using the available tools.

## Your Role
- Analyze user requests and determine which editing operations to perform
- Use tools step by step to accomplish the user's goal
- Explain what you're doing as you work
- If a request is ambiguous, ask for clarification before making changes

## Rules
- You already have a summary of available materials and timeline state below. Use list_materials or search_materials for detailed info or to get material IDs for add_to_track.
- Always use get_timeline first if you need to understand the current state in detail
- Place clips at appropriate positions to avoid overlapping
- Provide a brief summary of what you did after completing operations
- If you cannot fulfill a request with the available tools, explain why
- Video materials may have AI analysis results describing their visual content. Use this info to understand what each video contains and make intelligent material selections.
- search_materials supports searching by video content — queries match against AI analysis text, not just file names.

## Current Timeline Summary
${formatTimelineSummary(timelineState)}

## Available Materials
${formatMaterialsSummary(materials)}`;
}
