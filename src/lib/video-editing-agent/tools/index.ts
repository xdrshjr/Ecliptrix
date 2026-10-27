import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TimelineState, Track, TimelineItem, MaterialItem, AgentMaterialData } from '@/types';
import { isInlineMediaUrl } from '@/lib/inlineUrl';
import type { ToolContext } from '../types';
import type { ToolActivationState } from '../registry/ToolActivationState';
import { createWebTools } from './webTools';
import { createAcquireWebMaterialsTool } from './acquireWebMaterials';
import { createDelegateResearchTools } from './delegateResearch';
import { createBrowserTools } from './browserTools';
import { createResearchArtifactTool } from './researchArtifactTool';
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
import {
  createGetVideoCoverTool, createCreateVideoCoverTool,
  createUpdateVideoCoverTool, createApplyVideoCoverTool,
} from './coverTools';
import { createGenerateAiVideoTool } from './generateAiVideo';
import { createImageToVideoTool } from './imageToVideo';
import { createGenerateStoryboardTool } from './generateStoryboard';
import { createDescribeStoryboardTool } from './describeStoryboard';
import { createBatchStoryboardVideoTool } from './batchStoryboardVideo';
import { createComposeStoryboardTool } from './composeStoryboard';
import { createCheckOverlapsTool, summarizeOverlapReport } from './checkOverlaps';
import { createPlanTool } from './planTool';
import { createAskUserTool } from './askUserTool';
import { createCheckTimelineTool } from './qualityTool';
import { createSkillTool } from './skillTools';
import { createBuildCreditsTool } from './creditsTool';
import { createViewImageTool, createReviewFramesTool } from './visionTools';
import { createInspectExportTool } from './exportInspectTool';
import { createWorkspaceTools } from './workspaceTools';
import { createDocumentTools } from './documentTool';
import { createAnalysisTools } from './analysisTool';
import { createMemoryTools } from './memoryTools';
import { createAutoFixOverlapsTool } from './autoFixOverlaps';
import { ItemPlacementService, type OverlapReport } from '@/components/video/timeline/domain/services/ItemPlacementService';
import { TrackTypeUtils } from '@/components/video/timeline/domain/value-objects/TrackType';
import { isReorganisable } from '../reconcile';

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

/** Still image clip: tagged by `originalMaterialType`, or backed by an image material. */
export function isStillClip(item: TimelineItem, materials: MaterialItem[]): boolean {
  if (item.originalMaterialType === 'image') return true;
  return item.materialId ? findMaterial(materials, item.materialId)?.type === 'image' : false;
}

export function getDefaultTrackForType(
  timelineState: TimelineState,
  type: string
): string | null {
  // First unlocked track that accepts this material type: images go on any
  // video track, videos skip image-tracks (which refuse them).
  const track = timelineState.tracks.find(
    t => !t.isLocked && TrackTypeUtils.canAcceptMaterial(t.type, type, t.id)
  );
  return track?.id ?? null;
}

/** Structured failure returned by an editing tool. */
export interface ToolErrorResult {
  success: false;
  error: string;
}

/** Wrap a tool failure in the AgentTool result envelope. */
export function toolErrorResponse(error: ToolErrorResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(error) }],
    details: error,
  };
}

/** Why a track cannot be edited (missing or locked); null when it can. */
export function trackEditError(state: TimelineState, trackId: string): ToolErrorResult | null {
  const track = findTrack(state, trackId);
  if (!track) return { success: false, error: `Track not found: ${trackId}` };
  if (track.isLocked) {
    return { success: false, error: `Track is locked: ${trackId}. Ask the user to unlock it first.` };
  }
  return null;
}

/** Error when a `materialType` clip cannot sit on `track`; null when it can. */
export function materialTrackMismatchError(
  track: Track,
  materialType: string,
): ToolErrorResult | null {
  if (TrackTypeUtils.canAcceptMaterial(track.type, materialType, track.id)) return null;
  // The model reads this text, so keep it grammatical ("an audio clip").
  const article = /^[aeiou]/i.test(materialType) ? 'An' : 'A';
  return {
    success: false,
    error: `${article} ${materialType} clip cannot be placed on ${track.id} (${track.type} track).`,
  };
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
 * Overlaps an edit should warn about: only on the tracks it touched
 * (`trackIds`, all tracks when omitted) and only where auto_fix_overlaps can
 * repair them. An unrelated subtitle or locked-track overlap used to ride
 * along on every edit and sent the model into an auto_fix loop it could not
 * finish. Pure: does not mutate state.
 */
export function runOverlapPostCheck(
  state: TimelineState,
  trackIds?: readonly string[],
): OverlapReport[] {
  const tracks = state.tracks.filter(
    track => isReorganisable(track) && (!trackIds || trackIds.includes(track.id)),
  );
  return ItemPlacementService.findAllOverlaps(tracks);
}

/** Whether auto_fix_overlaps can repair the overlap (video / audio, unlocked). */
export function isOverlapAutoFixable(state: TimelineState, report: OverlapReport): boolean {
  const track = findTrack(state, report.trackId);
  return track ? isReorganisable(track) : false;
}

/** Every same-track overlap, as get_timeline and check_timeline_overlaps list it. */
export function describeOverlaps(state: TimelineState, reports: readonly OverlapReport[]) {
  return reports.map(report => ({
    trackId: report.trackId,
    trackType: report.trackType,
    clipAId: report.a.clipId,
    clipBId: report.b.clipId,
    overlapStart: report.overlapStart,
    overlapEnd: report.overlapEnd,
    autoFixable: isOverlapAutoFixable(state, report),
  }));
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

/** Where a clip sits, keyed by clip id in `collectClipStarts`. */
export interface ClipPosition {
  trackId: string;
  startTime: number;
}

export interface ShiftedClip {
  clipId: string;
  from: number;
  to: number;
}

/**
 * Positions closer than this are the same place: float noise, neither a
 * shifted clip nor a repositioned one.
 */
export const POSITION_EPSILON = 1e-6;

/** Start time of every clip on the given tracks. */
export function collectClipStarts(
  state: TimelineState,
  trackIds: readonly string[],
): Map<string, ClipPosition> {
  const positions = new Map<string, ClipPosition>();
  for (const track of state.tracks) {
    if (!trackIds.includes(track.id)) continue;
    for (const item of track.items) {
      positions.set(item.id, { trackId: track.id, startTime: item.startTime });
    }
  }
  return positions;
}

/**
 * Clips (other than the one the tool operated on) whose start time changed,
 * so the model learns what the reconcile pass moved on its behalf.
 */
export function diffClipStarts(
  before: ReadonlyMap<string, ClipPosition>,
  after: ReadonlyMap<string, ClipPosition>,
  excludeClipId: string,
): ShiftedClip[] {
  const shifted: ShiftedClip[] = [];
  after.forEach((position, clipId) => {
    if (clipId === excludeClipId) return;
    const previous = before.get(clipId);
    if (!previous) return;
    if (Math.abs(previous.startTime - position.startTime) <= POSITION_EPSILON) return;
    shifted.push({ clipId, from: previous.startTime, to: position.startTime });
  });
  return shifted;
}

/**
 * Material snapshot for an agent `add_clip`: the same playback fields a
 * manual drop copies onto a clip (`toMaterialData`), without inline media.
 */
export function toAgentClipMaterial(material: MaterialItem): AgentMaterialData {
  const metadata = material.metadata;
  const storageMetadata: AgentMaterialData['metadata'] = {
    ...(metadata?.storageKind ? { storageKind: metadata.storageKind } : {}),
    ...(metadata?.storageKey ? { storageKey: metadata.storageKey } : {}),
    ...(metadata?.localResolvedUrl ? { localResolvedUrl: metadata.localResolvedUrl } : {}),
  };
  return {
    id: material.id,
    name: material.name,
    type: material.type,
    ...(material.thumbnailUrl && !isInlineMediaUrl(material.thumbnailUrl)
      ? { thumbnailUrl: material.thumbnailUrl }
      : {}),
    ...(material.url ? { url: material.url } : {}),
    ...(material.serverUrl ? { serverUrl: material.serverUrl } : {}),
    ...(material.cacheUrl ? { cacheUrl: material.cacheUrl } : {}),
    ...(material.storageKey ? { storageKey: material.storageKey } : {}),
    ...(Object.keys(storageMetadata).length > 0 ? { metadata: storageMetadata } : {}),
  };
}

/**
 * Material as the model sees it. Inline `data:` / `blob:` thumbnails are left
 * out: one would bloat every tool result and every replayed turn.
 */
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
    ...(isInlineMediaUrl(m.thumbnailUrl) ? {} : { thumbnailUrl: m.thumbnailUrl }),
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

  // Register every category first (metadata only, tools arrays empty)
  for (const category of createDefaultCategories()) {
    registry.registerCategory(category);
  }

  registry.registerToolsForCategory(CATEGORY_IDS.WEB_TOOLS,
    [...createWebTools(context), createAcquireWebMaterialsTool(context)]);
  registry.registerToolsForCategory(CATEGORY_IDS.BROWSER_TOOLS, createBrowserTools(context));
  registry.registerToolsForCategory(CATEGORY_IDS.RESEARCH_TOOLS,
    [createResearchArtifactTool(context), ...createDelegateResearchTools(context)]);

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
  registry.registerToolsForCategory(CATEGORY_IDS.COVER_TOOLS, [
    createGetVideoCoverTool(context), createCreateVideoCoverTool(context),
    createUpdateVideoCoverTool(context), createApplyVideoCoverTool(context),
  ]);

  registry.registerToolsForCategory(CATEGORY_IDS.MATERIAL_TOOLS, [
    createAddMaterialToLibraryTool(context),
    createRemoveMaterialTool(context),
    createBuildCreditsTool(context),
  ]);

  // Agent general toolkit (docs/plans/agent-general-toolkit/spec.md §3.2):
  // 1 always-available category + 4 on-demand categories, 12 tools total.
  // workflow_tools is alwaysAvailable, so its three tools reach the model without
  // explore_tools; they are also listed in CORE_TOOLKIT_TOOL_NAMES so
  // formatCoreToolkit renders their parameters in the L0 prompt.
  registry.registerToolsForCategory(CATEGORY_IDS.WORKFLOW_TOOLS, [
    createPlanTool(context),
    createAskUserTool(context),
    createCheckTimelineTool(context),
    // use_skill reads the registry lazily (at call time) to map a skill's tools to categories.
    createSkillTool(context, registry),
  ]);
  registry.registerToolsForCategory(
    CATEGORY_IDS.WORKSPACE_TOOLS, createWorkspaceTools(context));
  registry.registerToolsForCategory(
    CATEGORY_IDS.DOCUMENT_TOOLS, createDocumentTools(context));
  registry.registerToolsForCategory(
    CATEGORY_IDS.ANALYSIS_TOOLS, createAnalysisTools(context));
  registry.registerToolsForCategory(
    CATEGORY_IDS.MEMORY_TOOLS, createMemoryTools(context));

  // Visual review (agent-visual-review §4.2): one on-demand category with the
  // three tools that need explore_tools first — view_image, review_frames and
  // inspect_export.
  registry.registerToolsForCategory(CATEGORY_IDS.REVIEW_TOOLS, [
    createViewImageTool(context),
    createReviewFramesTool(context),
    createInspectExportTool(context),
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
export function buildAllAgentTools(registry: ToolRegistry, activation?: ToolActivationState): AgentTool<any>[] {
  const allTools = registry.getAllTools();
  const exploreTool = createExploreToolsTool(registry, activation);
  let calls = 0;
  return [...allTools, exploreTool].map(tool => ({ ...tool,
    execute: async (...args: Parameters<typeof tool.execute>) => {
      if (activation && !activation.canExecute(tool.name)) {
        return toolErrorResponse({ success: false,
          error: 'tool_not_loaded: load with explore_tools, then call on the next response.' });
      }
      if (++calls > 80) return toolErrorResponse({ success: false, error: 'tool_call_limit' });
      return tool.execute(args[0], args[1], args[2], args[3]);
    },
  }));
}
