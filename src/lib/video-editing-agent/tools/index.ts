import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TimelineState, Track, TimelineItem, MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { createGetTimelineTool } from './getTimeline';
import { createListMaterialsTool } from './listMaterials';
import { createSearchMaterialsTool } from './searchMaterials';
import { createAddToTrackTool } from './addToTrack';
import { createTrimClipTool } from './trimClip';
import { createDeleteClipTool } from './deleteClip';
import { createMoveClipTool } from './moveClip';
import { createResizeClipTool } from './resizeClip';

// --- Shared helpers used by tools ---

export function findMaterial(materials: MaterialItem[], id: string): MaterialItem | undefined {
  return materials.find(m => m.id === id);
}

export function findTrack(timelineState: TimelineState, trackId: string): Track | undefined {
  return timelineState.tracks.find(t => t.id === trackId);
}

export function findClip(
  timelineState: TimelineState,
  clipId: string
): { item: TimelineItem; trackId: string } | null {
  for (const track of timelineState.tracks) {
    for (const item of track.items) {
      if (item.id === clipId) {
        return { item, trackId: track.id };
      }
    }
  }
  return null;
}

export function getDefaultTrackForType(
  timelineState: TimelineState,
  type: string
): string | null {
  // Image materials go on video tracks (Track type doesn't include 'image')
  const trackType = type === 'image' ? 'video' : type;
  const track = timelineState.tracks.find(t => t.type === trackType && !t.isLocked);
  return track?.id ?? null;
}

export function getTrackEndTime(track: Track): number {
  if (track.items.length === 0) return 0;
  let maxEnd = 0;
  for (const item of track.items) {
    const end = item.startTime + item.duration;
    if (end > maxEnd) maxEnd = end;
  }
  return maxEnd;
}

export function generateClipId(): string {
  return `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function serializeMaterial(m: MaterialItem) {
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    format: m.format,
    duration: m.duration,
    width: m.width,
    height: m.height,
    size: m.size,
    description: m.description,
    tags: m.tags,
    thumbnailUrl: m.thumbnailUrl,
    hasSentenceSegments: !!m.sentenceSegments,
    analysisStatus: m.analysisResult?.status,
    analysis: m.analysisResult?.analysis,
  };
}

// --- Tool registration ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildVideoEditingTools(context: ToolContext): AgentTool<any>[] {
  return [
    createGetTimelineTool(context),
    createListMaterialsTool(context),
    createSearchMaterialsTool(context),
    createAddToTrackTool(context),
    createTrimClipTool(context),
    createDeleteClipTool(context),
    createMoveClipTool(context),
    createResizeClipTool(context),
  ];
}
