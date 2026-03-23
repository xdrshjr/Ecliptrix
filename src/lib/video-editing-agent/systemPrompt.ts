import type { TimelineState, MaterialItem } from '@/types';
import type { CategorySummary, ToolInfo } from './registry/ToolRegistry';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Map from internal track type to human-readable label.
 */
const TRACK_TYPE_LABELS: Record<string, string> = {
  video: 'video',
  audio: 'audio',
  subtitle: 'subtitle',
};

/**
 * Always-available tools: one-line descriptions shown in L0 system prompt.
 * These are the 8 baseline tools that the agent can call without explore_tools.
 */
const ALWAYS_AVAILABLE_TOOLS: { name: string; desc: string }[] = [
  { name: 'get_timeline', desc: '获取完整时间线状态' },
  { name: 'list_materials', desc: '列出素材库中的所有素材' },
  { name: 'search_materials', desc: '搜索素材库中的素材（名称/描述/字幕匹配）' },
  { name: 'add_to_track', desc: '将素材添加到时间线轨道' },
  { name: 'trim_clip', desc: '修剪片段的源入出点' },
  { name: 'delete_clip', desc: '删除时间线上的片段' },
  { name: 'move_clip', desc: '移动片段到新位置或不同轨道' },
  { name: 'resize_clip', desc: '调整片段在时间线上的显示时长' },
];

// ---------------------------------------------------------------------------
// formatToolOverview — tree directory format
// ---------------------------------------------------------------------------

/**
 * Format the tool directory as a two-section tree: always-available tools
 * and advanced tool categories (requiring explore_tools to see details).
 *
 * @param categorySummaries - Summaries from ToolRegistry.getCategorySummaries()
 */
export function formatToolOverview(categorySummaries: CategorySummary[]): string {
  const lines: string[] = [];

  // Section 1: Always-available tools
  lines.push('## 始终可用的工具');
  for (const tool of ALWAYS_AVAILABLE_TOOLS) {
    lines.push(`- ${tool.name}: ${tool.desc}`);
  }

  // Section 2: Advanced categories (on-demand, not alwaysAvailable)
  const advancedCategories = categorySummaries.filter(c => !c.alwaysAvailable);
  if (advancedCategories.length > 0) {
    lines.push('');
    lines.push('## 高级工具类别（调用 explore_tools 查看详情后可用）');
    for (const cat of advancedCategories) {
      lines.push(`- ${cat.id}: ${cat.description}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatExploreToolsResult — detailed tool info from explore_tools
// ---------------------------------------------------------------------------

/**
 * Format the detailed tool information returned by explore_tools for a
 * specific category. This is injected into the conversation as a tool result
 * so the LLM knows exactly how to call each tool.
 *
 * @param categoryName - Human-readable category name (e.g. "搜索获取")
 * @param categoryId - Category ID (e.g. "search_tools")
 * @param tools - Detailed tool info array from the registry
 * @param usageHints - Category-specific usage guidance string
 */
export function formatExploreToolsResult(
  categoryName: string,
  categoryId: string,
  tools: ToolInfo[],
  usageHints: string
): string {
  const lines: string[] = [];

  lines.push(`## ${categoryId} — ${categoryName}`);
  lines.push('');
  lines.push('以下工具现在可用，你可以直接调用：');

  for (const tool of tools) {
    lines.push('');
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);

    // Format parameter schema as a concise one-liner
    if (tool.parametersSchema && typeof tool.parametersSchema === 'object') {
      const schema = tool.parametersSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (schema.required as string[]) ?? [];

      if (properties) {
        const paramParts: string[] = [];
        for (const [key, prop] of Object.entries(properties)) {
          const isRequired = required.includes(key);
          const desc = (prop.description as string) ?? '';
          const suffix = desc ? `, ${desc}` : '';
          paramParts.push(`${key}(${isRequired ? '必填' : '可选'}${suffix})`);
        }
        lines.push(`参数：${paramParts.join(', ')}`);
      }
    }
  }

  if (usageHints) {
    lines.push('');
    lines.push('提示：');
    lines.push(usageHints);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatCompactSummary — project state summary
// ---------------------------------------------------------------------------

/**
 * Format a compact project summary containing only aggregate statistics.
 *
 * Design constraints:
 * - Output must stay under ~100 tokens regardless of project scale
 * - Contains enough information for the Agent to decide whether to call get_timeline/search_materials
 * - Includes track annotations (locked/muted) since they affect which operations are possible
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

    const typeOrder = ['video', 'audio', 'image', 'subtitle'];
    const orderedParts: string[] = [];
    const seen = new Set<string>();

    for (const t of typeOrder) {
      orderedParts.push(`${counts[t] ?? 0} ${t}`);
      seen.add(t);
    }

    for (const t of Object.keys(counts)) {
      if (!seen.has(t)) {
        orderedParts.push(`${counts[t]} ${t}`);
      }
    }

    lines.push(`Materials: ${orderedParts.join(', ')}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// buildSystemPrompt — L0 system prompt
// ---------------------------------------------------------------------------

/**
 * Build the L0 system prompt for the video editing agent.
 *
 * Structure:
 *   1. Role (2 sentences)
 *   2. Rules (mandatory behavioral constraints)
 *   3. Tool directory (always-available + advanced categories)
 *   4. Project summary (aggregate stats)
 *   5. Workflow guide (decision tree for tool selection)
 *   6. Smart result handling (when to auto-add to timeline vs library only)
 *
 * Token budget: < 600 tokens under any project size.
 *
 * @param timelineState - Current timeline state
 * @param materials - All materials in the library
 * @param categorySummaries - Category summaries from ToolRegistry
 */
export function buildSystemPrompt(
  timelineState: TimelineState,
  materials: MaterialItem[],
  categorySummaries: CategorySummary[]
): string {
  return `你是一个全能视频编辑助手。分析用户需求，选择正确的工具，逐步执行编辑操作。

## 规则
- 你必须调用工具来执行任何操作。仅在文字中描述操作不会产生任何效果。
- 对于高级功能，先调用 explore_tools 加载对应工具类别，然后使用。
- 复合任务请自动拆解为多个步骤顺序执行。
- 搜索/生成的结果会自动添加到素材库。AI生成任务为异步，启动后无需等待。

${formatToolOverview(categorySummaries)}

## 项目状态
${formatCompactSummary(timelineState, materials)}

## 操作指南
- 需要外部素材？→ explore_tools("search_tools") → search_video/search_image/search_audio
- 需要 AI 创作内容？→ explore_tools("ai_gen_tools") → generate_ai_image/generate_ai_video
- 需要语音旁白？→ explore_tools("tts_tools") → generate_tts
- 需要写脚本？→ explore_tools("script_tools") → generate_video_script
- 需要分镜？→ explore_tools("storyboard_tools") → generate_storyboard
- 对于复合需求（如"帮我做一个30秒视频"），自动规划并按顺序执行多个步骤。

## 智能结果处理
- 用户明确要求"添加到时间线"/"放到视频里"/"用在视频中" → 生成后自动调用 add_to_track
- 用户只说"找一些"/"生成一个"/"搜索" → 仅添加到素材库，不自动上轨
- 不确定时 → 只入库，让用户自行决定`.trim();
}
