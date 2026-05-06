/**
 * Static prompt-part blobs shared between the L0 system prompt
 * (`buildSystemPrompt` in `systemPrompt.ts`) and the explore_tools meta tool
 * (`tools/exploreTools.ts`). Single source of truth so the two surfaces never
 * drift.
 *
 * Spec: docs/plans/video-agent-prompt-persistence/spec.md §3 row 2.
 */

import { CATEGORY_IDS } from './registry';

/**
 * Names of the tools that drive 95% of editing sessions. These are surfaced
 * inline in the L0 system prompt's "Core Workflow Toolkit" section
 * (Layer A) so the LLM never has to re-discover them on later turns.
 *
 * The list is the *names to expose* — descriptions and parameter schemas are
 * pulled live from `ToolRegistry` to avoid drift if a tool is renamed.
 */
export const CORE_TOOLKIT_TOOL_NAMES: readonly string[] = [
  // search_tools
  'search_video',
  'search_image',
  'search_audio',
  // ai_gen_tools
  'generate_ai_image',
  'generate_ai_video',
  'image_to_video',
  // tts_tools
  'generate_tts',
  'batch_generate_tts',
  // script_tools
  'generate_video_script',
  'expand_video_script',
  // storyboard_tools
  'generate_storyboard',
  'describe_storyboard',
  'batch_storyboard_video',
  'compose_storyboard',
  // material_tools (one entry — the most common manual op)
  'add_material_to_library',
];

/**
 * Voice-type table lifted from the TTS usage hints. Embedded directly in
 * Layer A so the agent can pick a voice without first calling explore_tools.
 */
export const TTS_VOICE_TABLE_MD = `常用音色（voice_type）：
  - zh_female_shuangkuaisisi_moon_bigtts  — 双快丝丝 (female, Chinese)
  - zh_male_chunhou_moon_bigtts            — 醇厚 (male, Chinese)
  - zh_female_tianmei_moon_bigtts           — 甜美 (female, Chinese)
  - zh_male_yangguang_moon_bigtts           — 阳光 (male, Chinese)
  - zh_female_wenrou_moon_bigtts            — 温柔 (female, Chinese)
  - en_female_arabellaexpressive             — Arabella (female, English)
  - en_male_caleb                            — Caleb (male, English)
  - en_female_sarahexpressive                — Sarah (female, English)
省略 voice_type 时默认使用 zh_female_shuangkuaisisi_moon_bigtts。`;

/**
 * Workflow recipes (Layer C). Promoted from the old "operation guide" hints
 * to a dedicated section so the LLM consults them on every turn.
 *
 * Recipes are written as "when X, prefer Y" not "you MUST always Y" — keeps
 * the model's judgement intact while still anchoring the canonical sequences.
 */
export const WORKFLOW_RECIPES_MD = `### 配方 1：脚本与解说视频
当用户要求"做一个解说/旁白视频"或"写一段脚本拍成视频"时：
1. \`generate_video_script({ topic, duration_target })\` — 生成结构化脚本，返回 segments 数组（每段含 narration_text）。
2. 单段：\`generate_tts({ text: segment.narration_text })\` 或多段：\`batch_generate_tts({ segments: [{ text: ... }, ...] })\`。
3. 根据 segment.content_preview / segment.title 调用 \`search_video\` / \`search_image\` 检索素材；亦可 \`generate_ai_image\` 补足画面。
4. 使用 \`add_to_track\` 把视频/图片放到视频轨、TTS 放到音频轨；按需 \`search_audio\` 取一段 BGM 放到独立音频轨（音量 10–20%）。

⚠️ 强制：TTS 的 text **必须**使用 generate_video_script 返回的 narration_text，不要自行编写或使用 scriptText（画面描述）。

### 配方 2：分镜短片（高质量、AI 生成）
当用户要求"分镜视频/卡点短片/AI 视频生成"时：
1. \`generate_video_script\` 起一份脚本草稿。
2. \`generate_storyboard({ script })\` — 必须传入上一步的脚本内容；返回 shots 数组。
3. \`describe_storyboard({ storyboardId })\` 为每个 shot 补镜头描述（如缺）。
4. \`batch_storyboard_video({ storyboardId })\` 批量为每个 shot 生成视频（异步任务）。
5. 任务全部完成后 \`compose_storyboard({ storyboardId })\` 把 shot 组合到时间线。

### 配方 3：搜索-组装（速度优先）
当用户只要求"用现有素材组装"或"找几段视频拼起来"时：
1. \`search_video\` / \`search_image\` 拉取候选素材到素材库。
2. 必要时 \`search_audio\` 取 BGM。
3. \`add_to_track\` 把素材依次入轨；\`resize_clip\` / \`trim_clip\` 调整时长；\`move_clip\` 调位置。
4. 操作完成后 \`check_timeline_overlaps\`；若 valid=false 则 \`auto_fix_overlaps\`。

### 配方 4：仅入库 vs 上轨
- 用户说"添加到时间线"/"放到视频里"/"用在视频中" → 生成/搜索后立即 \`add_to_track\`。
- 用户只说"找一些"/"生成一个"/"搜索一下" → 仅入库，不自动上轨。
- 不确定 → 只入库，让用户决定。`;

/**
 * Per-category usage-hint strings. Used both by `explore_tools` (when the LLM
 * actively explores a category) and by `formatExploredCategoriesAppendix`
 * (Layer B — replaying previously-explored categories on later turns).
 *
 * Keeping the strings here means the two surfaces never drift.
 */
export const CATEGORY_USAGE_HINTS: Record<string, string> = {
  [CATEGORY_IDS.SEARCH_TOOLS]:
    'Search tools query external APIs (Pexels, Unsplash, Freesound). ' +
    'Results are automatically added to the material library. ' +
    'Use add_to_track to place them directly on the timeline.\n' +
    'Tip: English keywords yield better results; Chinese queries are auto-translated.',
  [CATEGORY_IDS.AI_GEN_TOOLS]:
    'AI generation tools start async tasks. The tool returns a taskId and the generation runs in the background. ' +
    'Results are automatically added to the material library when complete. ' +
    'You can inform the user that generation has started and continue with other tasks.',
  [CATEGORY_IDS.TTS_TOOLS]:
    'TTS tools convert text to speech audio. Use generate_tts for a single piece of text (sync, ~2-5s), ' +
    'or batch_generate_tts for multiple sentences/paragraphs. Generated audio is auto-added to the material library.\n\n' +
    'When generating narration for a video script: use the narration_text from generate_video_script results as TTS input. ' +
    'Never fabricate or write your own narration text.\n\n' +
    TTS_VOICE_TABLE_MD,
  [CATEGORY_IDS.SCRIPT_TOOLS]:
    'Script tools help create and refine video scripts. Use generate_video_script to create a new script from a topic, ' +
    'expand_video_script to elaborate on an existing script, or understand_video_script to generate a script from video analysis.',
  [CATEGORY_IDS.STORYBOARD_TOOLS]:
    'Storyboard tools work with visual storyboards. generate_storyboard creates shot breakdowns from a script, ' +
    'describe_storyboard adds visual descriptions, batch_storyboard_video generates video for each shot, ' +
    'and compose_storyboard assembles shots into a timeline.',
  [CATEGORY_IDS.MATERIAL_TOOLS]:
    'Material management tools let you manually add external URLs or remove unwanted materials from the library. ' +
    'Note: search and AI generation results are auto-added, so this is mainly for manual management.',
};

/**
 * Default usage-hint string for any category not explicitly listed above.
 */
export const DEFAULT_USAGE_HINT = 'Call the tools in this category as needed for your task.';

/**
 * Lookup helper. Returns the registered hint for a category, or the default
 * fallback if no entry exists.
 */
export function getCategoryUsageHints(categoryId: string): string {
  return CATEGORY_USAGE_HINTS[categoryId] ?? DEFAULT_USAGE_HINT;
}
