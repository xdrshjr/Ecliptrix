import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TimelineState, Track, TimelineItem, MaterialItem } from '@/types';
import type { ToolContext } from '../types';
import { ToolRegistry, CATEGORY_IDS, createDefaultCategories } from '../registry';
import { createGetTimelineTool } from './getTimeline';
import { createListMaterialsTool } from './listMaterials';
import { createSearchMaterialsTool } from './searchMaterials';
import { createAddToTrackTool } from './addToTrack';
import { createTrimClipTool } from './trimClip';
import { createDeleteClipTool } from './deleteClip';
import { createMoveClipTool } from './moveClip';
import { createResizeClipTool } from './resizeClip';
import { createExploreToolsTool } from './exploreTools';
import { createSearchVideoTool } from './searchVideo';
import { createSearchImageTool } from './searchImage';
import { createSearchAudioTool } from './searchAudio';
import { createAddMaterialToLibraryTool } from './addMaterialToLibrary';
import { createRemoveMaterialTool } from './removeMaterial';
import { createGenerateTtsTool } from './generateTts';
import { createBatchGenerateTtsTool } from './batchGenerateTts';
import { createGenerateVideoScriptTool } from './generateVideoScript';
import { createExpandVideoScriptTool } from './expandVideoScript';
import { createUnderstandVideoScriptTool } from './understandVideoScript';
import { createGenerateAiImageTool } from './generateAiImage';
import { createGenerateAiVideoTool } from './generateAiVideo';
import { createImageToVideoTool } from './imageToVideo';
import { createGenerateStoryboardTool } from './generateStoryboard';
import { createDescribeStoryboardTool } from './describeStoryboard';
import { createBatchStoryboardVideoTool } from './batchStoryboardVideo';
import { createComposeStoryboardTool } from './composeStoryboard';
import { createCheckOverlapsTool, summarizeOverlapReport } from './checkOverlaps';
import { createAutoFixOverlapsTool } from './autoFixOverlaps';
import { ItemPlacementService, type OverlapReport } from '@/components/video/timeline/domain/services/ItemPlacementService';

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

export function getVideoTrackMaxDuration(state: TimelineState): number {
  return Math.max(
    ...state.tracks
      .filter(t => t.type === 'video')
      .map(t => getTrackEndTime(t)),
    0
  );
}

export function getNonVideoTrackMaxDuration(state: TimelineState): number {
  return Math.max(
    ...state.tracks
      .filter(t => t.type !== 'video')
      .map(t => getTrackEndTime(t)),
    0
  );
}

export function checkTrackDurationConstraint(state: TimelineState) {
  const videoDuration = getVideoTrackMaxDuration(state);
  const violatingTracks: Array<{ trackId: string; type: string; duration: number }> = [];

  for (const track of state.tracks) {
    if (track.type === 'video') continue;
    const duration = getTrackEndTime(track);
    if (duration > videoDuration && duration > 0) {
      violatingTracks.push({ trackId: track.id, type: track.type, duration });
    }
  }

  return {
    valid: violatingTracks.length === 0,
    videoDuration,
    maxOtherDuration: getNonVideoTrackMaxDuration(state),
    violatingTracks,
  };
}

/**
 * Run overlap detection across the current timeline and return the raw
 * report list. Pure: does not mutate state.
 */
export function runOverlapPostCheck(state: TimelineState): OverlapReport[] {
  return ItemPlacementService.findAllOverlaps(state.tracks);
}

/**
 * Format the overlap reports for inclusion in a tool result. Returns null
 * when no overlaps were detected so callers can spread the value
 * conditionally without producing an empty `overlapWarning` field.
 */
export function formatOverlapWarning(reports: OverlapReport[]): string | null {
  if (reports.length === 0) return null;
  const lines = reports.map(summarizeOverlapReport);
  return `⚠️ 时间线出现 ${reports.length} 处同轨重叠：\n${lines.join('\n')}\n请调用 auto_fix_overlaps 自动修复，或使用 move_clip / resize_clip / trim_clip 手动调整，然后再次调用 check_timeline_overlaps 直至 valid=true。`;
}

export function formatDurationWarning(check: ReturnType<typeof checkTrackDurationConstraint>): string | null {
  if (check.valid) return null;
  const tracks = check.violatingTracks
    .map(t => `${t.type}轨道(${t.duration.toFixed(1)}s)`)
    .join(', ');
  return `⚠️ 约束违规：${tracks} 超过了视频轨道时长(${check.videoDuration.toFixed(1)}s)。请缩短超出的轨道或补充视频素材，确保视频轨道是所有轨道中最长的。`;
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
    sentenceSegments: m.sentenceSegments ? {
      segment_id: m.sentenceSegments.segment_id,
      total_duration: m.sentenceSegments.total_duration,
      sentences: m.sentenceSegments.sentences.map(s => ({
        text: s.text,
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    } : undefined,
    analysisStatus: m.analysisResult?.status,
    analysis: m.analysisResult?.analysis,
  };
}

// --- Tool Registry setup ---

/**
 * Create and populate a ToolRegistry with all category definitions and
 * the currently available tools (query + editing).
 *
 * On-demand categories (search, ai_gen, tts, script, storyboard, material)
 * are registered with empty tools arrays. Phase 2+ agents populate them
 * via registry.registerToolsForCategory().
 */
export function createToolRegistry(context: ToolContext): ToolRegistry {
  const registry = new ToolRegistry();

  // Register all 8 categories (metadata only, tools arrays empty)
  for (const category of createDefaultCategories()) {
    registry.registerCategory(category);
  }

  // Populate query_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.QUERY_TOOLS, [
    createGetTimelineTool(context),
    createListMaterialsTool(context),
    createSearchMaterialsTool(context),
    createCheckOverlapsTool(context),
  ]);

  // Populate editing_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.EDITING_TOOLS, [
    createAddToTrackTool(context),
    createTrimClipTool(context),
    createDeleteClipTool(context),
    createMoveClipTool(context),
    createResizeClipTool(context),
    createAutoFixOverlapsTool(context),
  ]);

  // Populate search_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.SEARCH_TOOLS, [
    createSearchVideoTool(context),
    createSearchImageTool(context),
    createSearchAudioTool(context),
  ]);

  // Populate ai_gen_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.AI_GEN_TOOLS, [
    createGenerateAiImageTool(context),
    createGenerateAiVideoTool(context),
    createImageToVideoTool(context),
  ]);

  // Populate tts_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.TTS_TOOLS, [
    createGenerateTtsTool(context),
    createBatchGenerateTtsTool(context),
  ]);

  // Populate script_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.SCRIPT_TOOLS, [
    createGenerateVideoScriptTool(context),
    createExpandVideoScriptTool(context),
    createUnderstandVideoScriptTool(context),
  ]);

  // Populate storyboard_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.STORYBOARD_TOOLS, [
    createGenerateStoryboardTool(context),
    createDescribeStoryboardTool(context),
    createBatchStoryboardVideoTool(context),
    createComposeStoryboardTool(context),
  ]);

  // Populate material_tools category
  registry.registerToolsForCategory(CATEGORY_IDS.MATERIAL_TOOLS, [
    createAddMaterialToLibraryTool(context),
    createRemoveMaterialTool(context),
  ]);

  return registry;
}

/**
 * Build the complete tool array for the Agent.
 *
 * Method C: all tools from all categories are included, plus explore_tools.
 * The system prompt only shows category summaries (L0). The LLM calls
 * explore_tools to get detailed descriptions before using advanced tools.
 *
 * @param registry - A fully populated ToolRegistry
 * @returns Array of all tools to register with the Agent
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildAllAgentTools(registry: ToolRegistry): AgentTool<any>[] {
  const allTools = registry.getAllTools();
  const exploreTool = createExploreToolsTool(registry);
  return [...allTools, exploreTool];
}

// --- Legacy API (kept for backward compatibility) ---

/**
 * @deprecated Use createToolRegistry() + buildAllAgentTools() instead.
 * This function builds only the 8 core tools without registry support.
 * Retained during the transition period for any code that still calls it directly.
 */
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
