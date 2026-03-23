import type { ToolCategory } from './ToolRegistry';

/**
 * All 8 tool category definitions for the video editing agent.
 *
 * Categories are split into two groups:
 * - Always available: query_tools and editing_tools — their tools are populated
 *   by buildVideoEditingTools() in tools/index.ts at agent creation time.
 * - On-demand: the remaining 6 categories start with empty tools arrays.
 *   Other agents (Phase 2+) populate them via registry.registerToolsForCategory().
 *
 * The category IDs here are the canonical identifiers used by explore_tools
 * and the system prompt.
 */

// --- Category IDs (exported as constants for type safety) ---

export const CATEGORY_IDS = {
  QUERY_TOOLS: 'query_tools',
  EDITING_TOOLS: 'editing_tools',
  SEARCH_TOOLS: 'search_tools',
  AI_GEN_TOOLS: 'ai_gen_tools',
  TTS_TOOLS: 'tts_tools',
  SCRIPT_TOOLS: 'script_tools',
  STORYBOARD_TOOLS: 'storyboard_tools',
  MATERIAL_TOOLS: 'material_tools',
} as const;

export type CategoryId = (typeof CATEGORY_IDS)[keyof typeof CATEGORY_IDS];

/**
 * IDs of categories whose tools are on-demand (exposed via explore_tools).
 * These are the valid enum values for explore_tools' `category` parameter.
 */
export const ON_DEMAND_CATEGORY_IDS: CategoryId[] = [
  CATEGORY_IDS.SEARCH_TOOLS,
  CATEGORY_IDS.AI_GEN_TOOLS,
  CATEGORY_IDS.TTS_TOOLS,
  CATEGORY_IDS.SCRIPT_TOOLS,
  CATEGORY_IDS.STORYBOARD_TOOLS,
  CATEGORY_IDS.MATERIAL_TOOLS,
];

// --- Category definitions (metadata only; tools[] populated later) ---

/**
 * Returns all 8 category definitions with empty tools arrays.
 * Call this to seed the ToolRegistry, then populate tools via
 * registry.registerToolsForCategory() or by passing tools directly.
 */
export function createDefaultCategories(): ToolCategory[] {
  return [
    {
      id: CATEGORY_IDS.QUERY_TOOLS,
      name: '查询工具',
      description: 'Query timeline state and search the material library (get_timeline, list_materials, search_materials)',
      alwaysAvailable: true,
      tools: [], // Populated by tools/index.ts with existing query tools
    },
    {
      id: CATEGORY_IDS.EDITING_TOOLS,
      name: '编辑工具',
      description: 'Timeline editing operations: add, trim, delete, move, resize clips (add_to_track, trim_clip, delete_clip, move_clip, resize_clip)',
      alwaysAvailable: true,
      tools: [], // Populated by tools/index.ts with existing editing tools
    },
    {
      id: CATEGORY_IDS.SEARCH_TOOLS,
      name: '搜索获取',
      description: 'Search external video/image/audio resources from Pexels, Unsplash, Freesound',
      alwaysAvailable: false,
      tools: [], // Populated by tools/index.ts (Task 03: search_video, search_image, search_audio)
    },
    {
      id: CATEGORY_IDS.AI_GEN_TOOLS,
      name: 'AI 生成',
      description: 'AI image generation (Seedream), AI video generation (ARK Seedance), image-to-video conversion (generate_ai_image, generate_ai_video, image_to_video)',
      alwaysAvailable: false,
      tools: [], // Populated by tools/index.ts (Task 04: generate_ai_image, generate_ai_video, image_to_video)
    },
    {
      id: CATEGORY_IDS.TTS_TOOLS,
      name: '语音合成',
      description: 'Text-to-speech synthesis: generate_tts (single text, sync) and batch_generate_tts (multiple segments). 100+ voice types.',
      alwaysAvailable: false,
      tools: [], // Populated by Phase 2 (Task 05)
    },
    {
      id: CATEGORY_IDS.SCRIPT_TOOLS,
      name: '脚本工具',
      description: 'AI video script generation, expansion, and video-understanding-based script creation',
      alwaysAvailable: false,
      tools: [], // Populated by Phase 2 (Task 06)
    },
    {
      id: CATEGORY_IDS.STORYBOARD_TOOLS,
      name: '分镜工具',
      description: 'Storyboard generation, description, batch video generation, and composition (generate_storyboard, describe_storyboard, batch_storyboard_video, compose_storyboard)',
      alwaysAvailable: false,
      tools: [], // Populated by tools/index.ts (Task 07: generate_storyboard, describe_storyboard, batch_storyboard_video, compose_storyboard)
    },
    {
      id: CATEGORY_IDS.MATERIAL_TOOLS,
      name: '素材管理',
      description: 'Add or remove materials from the material library',
      alwaysAvailable: false,
      tools: [], // Populated by Phase 2 (Task 08)
    },
  ];
}
