import type { TimelineState } from '@/types';

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

export function buildSystemPrompt(timelineState: TimelineState): string {
  return `You are a video editing assistant. You help users edit videos by using the available tools.

## Your Role
- Analyze user requests and determine which editing operations to perform
- Use tools step by step to accomplish the user's goal
- Explain what you're doing as you work
- If a request is ambiguous, ask for clarification before making changes

## Rules
- Always use get_timeline first if you need to understand the current state
- When adding materials, search the material library first
- Place clips at appropriate positions to avoid overlapping
- Provide a brief summary of what you did after completing operations
- If you cannot fulfill a request with the available tools, explain why

## Current Timeline Summary
${formatTimelineSummary(timelineState)}`;
}
