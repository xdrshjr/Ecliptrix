import type { ToolCategory } from './ToolRegistry';

/**
 * Every tool category definition for the video editing agent (19 today:
 * 3 always-available + 16 on-demand).
 *
 * Categories are split into two groups:
 * - Always available: workflow_tools, query_tools and editing_tools — their
 *   tools are populated by createToolRegistry() in tools/index.ts at agent
 *   creation time.
 * - On-demand: the other 16 categories start with an empty tools array and are
 *   populated via registry.registerToolsForCategory().
 *
 * The category IDs here are the canonical identifiers used by explore_tools
 * and the system prompt.
 */

// --- Category IDs (exported as constants for type safety) ---

export const CATEGORY_IDS = {
  /** Always-available workflow category: update_plan + ask_user + check_timeline + use_skill. */
  WORKFLOW_TOOLS: 'workflow_tools',
  WORKSPACE_TOOLS: 'workspace_tools',
  DOCUMENT_TOOLS: 'document_tools',
  ANALYSIS_TOOLS: 'analysis_tools',
  MEMORY_TOOLS: 'memory_tools',
  WEB_TOOLS: 'web_tools',
  BROWSER_TOOLS: 'browser_tools',
  RESEARCH_TOOLS: 'research_tools',
  /** 按需：视觉审阅（view_image / review_frames / inspect_export）。 */
  REVIEW_TOOLS: 'review_tools',
  QUERY_TOOLS: 'query_tools',
  EDITING_TOOLS: 'editing_tools',
  SEARCH_TOOLS: 'search_tools',
  AI_GEN_TOOLS: 'ai_gen_tools',
  /** 按需：静图成片（image_to_video / batch_image_to_video），上轨前把图片变成视频镜头。 */
  STILL_TOOLS: 'still_tools',
  TTS_TOOLS: 'tts_tools',
  SCRIPT_TOOLS: 'script_tools',
  STORYBOARD_TOOLS: 'storyboard_tools',
  MATERIAL_TOOLS: 'material_tools',
  COVER_TOOLS: 'cover_tools',
} as const;

export type CategoryId = (typeof CATEGORY_IDS)[keyof typeof CATEGORY_IDS];

/**
 * IDs of categories whose tools are on-demand (exposed via explore_tools).
 * These are the valid enum values for explore_tools' `category` parameter.
 */
export const ON_DEMAND_CATEGORY_IDS: CategoryId[] = [
  CATEGORY_IDS.WORKSPACE_TOOLS,
  CATEGORY_IDS.DOCUMENT_TOOLS,
  CATEGORY_IDS.ANALYSIS_TOOLS,
  CATEGORY_IDS.MEMORY_TOOLS,
  CATEGORY_IDS.WEB_TOOLS,
  CATEGORY_IDS.BROWSER_TOOLS,
  CATEGORY_IDS.RESEARCH_TOOLS,
  CATEGORY_IDS.REVIEW_TOOLS,
  CATEGORY_IDS.SEARCH_TOOLS,
  CATEGORY_IDS.AI_GEN_TOOLS,
  CATEGORY_IDS.STILL_TOOLS,
  CATEGORY_IDS.TTS_TOOLS,
  CATEGORY_IDS.SCRIPT_TOOLS,
  CATEGORY_IDS.STORYBOARD_TOOLS,
  CATEGORY_IDS.MATERIAL_TOOLS,
  CATEGORY_IDS.COVER_TOOLS,
];

// --- Named category constants (one concept, one name across the repo) ---

export const WORKFLOW_TOOLS = CATEGORY_IDS.WORKFLOW_TOOLS;
export const WORKSPACE_TOOLS = CATEGORY_IDS.WORKSPACE_TOOLS;
export const DOCUMENT_TOOLS = CATEGORY_IDS.DOCUMENT_TOOLS;
export const ANALYSIS_TOOLS = CATEGORY_IDS.ANALYSIS_TOOLS;
export const MEMORY_TOOLS = CATEGORY_IDS.MEMORY_TOOLS;
export const REVIEW_TOOLS = CATEGORY_IDS.REVIEW_TOOLS;

// --- Category definitions (metadata only; tools[] populated later) ---

/**
 * Returns all 19 category definitions with empty tools arrays.
 * Call this to seed the ToolRegistry, then populate tools via
 * registry.registerToolsForCategory() or by passing tools directly.
 */
export function createDefaultCategories(): ToolCategory[] {
  return [
    {
      id: CATEGORY_IDS.WORKFLOW_TOOLS,
      name: '执行计划',
      // 描述 ≤160 字节（风格约束，§3.2）：一行即可读，便于 L0 目录扫描。
      description: 'Publish a plan, ask one clarifying question, run the free timeline self-check.',
      alwaysAvailable: true,
      tools: [], // Populated by tools/index.ts
    },
    {
      id: CATEGORY_IDS.WORKSPACE_TOOLS,
      name: '工作区',
      description: 'Save/read project files; import local media into the material library.',
      alwaysAvailable: false,
      tools: [],
    },
    {
      id: CATEGORY_IDS.DOCUMENT_TOOLS,
      name: '文档',
      description: 'Read uploaded PDF/DOCX/text/CSV/subtitle documents page by page.',
      alwaysAvailable: false,
      tools: [],
    },
    {
      id: CATEGORY_IDS.ANALYSIS_TOOLS,
      name: '计算分析',
      description: 'Run offline Python for arithmetic, tables and generated files. Requires opt-in.',
      alwaysAvailable: false,
      tools: [],
    },
    {
      id: CATEGORY_IDS.MEMORY_TOOLS,
      name: '长期记忆',
      description: 'Store and retrieve durable notes for this project.',
      alwaysAvailable: false,
      tools: [],
    },
    { id: CATEGORY_IDS.WEB_TOOLS, name: '网络检索',
      description: 'Search, read, research public sources; download local media. Requires Network & Research settings.',
      alwaysAvailable: false, tools: [] },
    { id: CATEGORY_IDS.BROWSER_TOOLS, name: '网页浏览',
      description: 'Browse public dynamic pages, read, click, search, scroll and capture. Requires bundled Chromium.',
      alwaysAvailable: false, tools: [] },
    { id: CATEGORY_IDS.RESEARCH_TOOLS, name: '研究资料',
      description: 'Read research artifacts by ID and byte offset; delegate_research: parallel read-only crew. No editor changes.',
      alwaysAvailable: false, tools: [] },
    {
      id: CATEGORY_IDS.REVIEW_TOOLS,
      name: '视觉审阅',
      // 描述 ≤160 字节（§4.2）：一行即可读，便于 L0 目录扫描。
      description: 'Look at images, sampled frames and exported results; report visual or quality issues.',
      alwaysAvailable: false,
      tools: [], // tools/index.ts: view_image, review_frames, inspect_export
    },
    {
      id: CATEGORY_IDS.COVER_TOOLS,
      name: '封面工具',
      description: 'Create HTML, AI and mixed video covers: get_video_cover, create_video_cover, update_video_cover, apply_video_cover',
      alwaysAvailable: false,
      tools: [],
    },
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
      description: 'AI image generation (Seedream) and AI video generation (ARK Seedance): generate_ai_image, generate_ai_video',
      alwaysAvailable: false,
      tools: [], // Populated by tools/index.ts (Task 04: generate_ai_image, generate_ai_video)
    },
    {
      id: CATEGORY_IDS.STILL_TOOLS,
      name: '静图成片',
      // 描述 ≤160 字节（风格约束，§3.2）：图片要作为镜头上轨前，先经此类别变成视频。
      description: 'Turn still images into video clips (Ken Burns/pan/static): image_to_video, batch_image_to_video. Local, free. Use before add_to_track.',
      alwaysAvailable: false,
      tools: [], // Populated by tools/index.ts: image_to_video, batch_image_to_video
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
      description: 'Add or remove materials from the library; build the web-material source & licence list.',
      alwaysAvailable: false,
      tools: [], // Populated by Phase 2 (Task 08)
    },
  ];
}
