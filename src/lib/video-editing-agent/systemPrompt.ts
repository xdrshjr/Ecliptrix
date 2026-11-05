import type { TimelineState, MaterialItem } from '@/types';
import type { CategorySummary, ToolInfo } from './registry/ToolRegistry';
import { ToolRegistry, type CategoryId } from './registry';
import { utf8Slice } from './modelContextBudget';
import type { AgentAutonomy, WebCapabilitySnapshot } from './types';
import type { HostCapabilitySnapshot } from '@/types/agentHost';
import type { AgentPlan } from '@/types/agentToolkit';
import type { SkillIndexEntry } from '@/types/agentSkills';
import {
  AGENT_TOOLKIT_GUIDANCE,
  GENERAL_AGENT_GUIDANCE,
  GENERAL_RESIDENT_CHAR_CEILING,
  GENERAL_RESIDENT_TOOL_NAMES,
  YOLO_DIRECTIVE,
  YOLO_TOOLKIT_GUIDANCE,
} from './promptParts';
import { formatSkillIndex, skillAvailability } from './skillContext';
import {
  CORE_TOOLKIT_TOOL_NAMES,
  WEB_RESEARCH_GUIDANCE,
  WORKFLOW_RECIPES_MD,
  getCategoryUsageHints,
} from './promptParts';

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
 *
 * 长度就是产品预算（agent-subtitles spec D-18）：满技能索引时 L0 只剩几十个
 * 字符的余量，所以新增一条工具行必须靠压缩旧的描述腾位，不能直接追加。
 */
const ALWAYS_AVAILABLE_TOOLS: { name: string; desc: string }[] = [
  { name: 'get_timeline', desc: '获取完整时间线（含 constraintCheck/overlapCheck）' },
  { name: 'list_materials', desc: '列出素材库全部素材' },
  { name: 'search_materials', desc: '按名称/描述/字幕搜索素材库' },
  { name: 'add_to_track', desc: '素材上轨（图片需先转成视频）' },
  { name: 'add_subtitles', desc: '加字幕（文本/SRT，不需素材）' },
  { name: 'trim_clip', desc: '修剪片段的源入出点' },
  { name: 'delete_clip', desc: '删除片段' },
  { name: 'move_clip', desc: '移动片段到新时间/轨道' },
  { name: 'resize_clip', desc: '调整片段显示时长' },
  { name: 'check_timeline_overlaps', desc: '列出所有同轨重叠（valid + overlaps[]）' },
  { name: 'auto_fix_overlaps', desc: '一键 pack-flush 视频/音频轨消除重叠（subtitle/locked 跳过）' },
];

// ---------------------------------------------------------------------------
// formatToolOverview — tree directory format
// ---------------------------------------------------------------------------

/**
 * Format the always-available tool directory.
 *
 * Note (spec v2 §3 row 1): the previous body also listed advanced categories
 * by ID + one-line description. Layer A (`formatCoreToolkit`) now covers the
 * tools the LLM actually calls every turn, so the redundant on-demand index
 * has been dropped to keep the prompt below the 3500-token ceiling. The
 * `categorySummaries` parameter is retained for binary compatibility with
 * existing tests and any external caller, but is no longer rendered.
 *
 * @param categorySummaries - Summaries from ToolRegistry.getCategorySummaries()
 *                            (currently unused by the body — see note above).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function formatToolOverview(
  categorySummaries: CategorySummary[],
  availability: Record<string, CategoryAvailability> = {},
): string {
  const lines: string[] = [];

  lines.push('## 始终可用的工具');
  for (const tool of ALWAYS_AVAILABLE_TOOLS) {
    lines.push(`- ${tool.name}: ${tool.desc}`);
  }

  lines.push('\n## 按需能力目录',
    'Use explore_tools(category, tool_names?) to load up to four tools. Loaded tools become callable in the next response.');
  lines.push(utf8Slice(categorySummaries.filter(category => !category.alwaysAvailable)
    .map(category => utf8Slice(`- ${category.id}: ${category.description}` +
      availabilitySuffix(availability[category.id]), 160))
    .join('\n'), 2400));

  return lines.join('\n');
}

/** `available` / `unavailable(reason)` so the model can predict a closed door. */
export interface CategoryAvailability {
  available: boolean;
  reason?: string;
}

function availabilitySuffix(state?: CategoryAvailability): string {
  if (!state) return '';
  if (state.available) return ' [available]';
  return ` [unavailable${state.reason ? `: ${state.reason}` : ''}]`;
}

/**
 * Maps the capability snapshots onto the categories that can be closed.
 *
 * @param snapshot - Network (`/capabilities`) snapshot; omitted means "do not
 *   claim anything", which is why the older single-argument call sites keep
 *   returning exactly what they returned before.
 * @param hostCapabilities - `/api/agent-host/capabilities` snapshot (§4.7). Only
 *   when it is present do the two general tiers speak: `host_tools` follows the
 *   shell switch (AC-G20) and `egress_tools` is always available, because
 *   tier-2 needs no research run — that difference is the point of the whole
 *   design (§1.2).
 */
export function categoryAvailability(
  snapshot?: WebCapabilitySnapshot | null,
  hostCapabilities?: HostCapabilitySnapshot | null,
): Record<string, CategoryAvailability> {
  const availability: Record<string, CategoryAvailability> = {};
  if (snapshot) {
    availability.web_tools = {
      available: snapshot.search.available && snapshot.downloads.available,
      reason: snapshot.search.error_code ?? snapshot.downloads.error_code,
    };
    availability.browser_tools = {
      available: snapshot.browser.available && snapshot.browser.enabled !== false,
      reason: snapshot.browser.error_code,
    };
    availability.research_tools = {
      available: snapshot.search.available,
      reason: snapshot.search.error_code,
    };
  }
  if (hostCapabilities) {
    const shellEnabled = hostCapabilities.shell?.enabled !== false;
    availability.host_tools = shellEnabled
      ? { available: true }
      : { available: false, reason: 'shell_disabled' };
    availability.egress_tools = { available: true };
  }
  return availability;
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
// Layer A — formatCoreToolkit
// ---------------------------------------------------------------------------

/**
 * Format one tool's parameter schema as a single "参数：" line, mirroring the
 * style used by `formatExploreToolsResult` so the appearance is consistent.
 */
function formatParamSignature(parametersSchema: unknown): string | null {
  if (!parametersSchema || typeof parametersSchema !== 'object') return null;
  const schema = parametersSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[]) ?? [];
  if (!properties) return null;

  const paramParts: string[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key);
    const desc = (prop.description as string) ?? '';
    const suffix = desc ? `, ${desc}` : '';
    paramParts.push(`${key}(${isRequired ? '必填' : '可选'}${suffix})`);
  }
  return `参数：${paramParts.join(', ')}`;
}

/**
 * Build the Layer A "Core Workflow Toolkit" section: every tool in
 * `CORE_TOOLKIT_TOOL_NAMES` rendered with its name, description, and
 * parameter signature pulled live from the registry.
 *
 * Drift handling (R3): if a name in `CORE_TOOLKIT_TOOL_NAMES` is missing
 * from the registry, emit a `console.warn` and write a single
 * "(currently unavailable)" stub line for that tool. We intentionally do
 * NOT throw — that would 500 the user request inside `createVideoEditingAgent`.
 *
 * `exclude` is the **planned exclusion** channel (agent-yolo-autonomous-mode
 * §4.4): names dropped on purpose by the current autonomy mode are skipped
 * whole — no stub and no warn, because a "currently unavailable" line would
 * invite the model to hunt for a tool it must not use. Optional so the older
 * single-argument call sites keep working unchanged.
 */
export function formatCoreToolkit(
  registry: ToolRegistry,
  exclude: readonly string[] = [],
): string {
  const excluded = new Set(exclude);
  const allTools = registry.getAllTools();
  const byName = new Map<string, (typeof allTools)[number]>();
  for (const t of allTools) byName.set(t.name, t);

  const lines: string[] = [];
  lines.push('## 核心工作流工具');
  lines.push('');
  lines.push(
    '以下工具已经默认注册在 Agent 工具集中。**任何一轮对话**你都可以直接调用，不需要先调用 explore_tools。'
  );

  for (const name of CORE_TOOLKIT_TOOL_NAMES) {
    if (excluded.has(name)) continue;
    const tool = byName.get(name);
    if (!tool) {
      console.warn(
        `[VideoEditingAgent] core toolkit name "${name}" not found in registry; falling back to one-line stub.`
      );
      lines.push('');
      lines.push(`### ${name}`);
      lines.push('(currently unavailable — call explore_tools if you need this tool)');
      continue;
    }
    lines.push('');
    lines.push(`### ${tool.name}`);
    lines.push(tool.description);
    const paramLine = formatParamSignature(tool.parameters);
    if (paramLine) lines.push(paramLine);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// General resident list — formatGeneralResident
// ---------------------------------------------------------------------------

/**
 * 每一行的一句话说明。参数名从注册表**实时**取，说明本身是静态的：常驻清单
 * 只有 400 字符预算，容不下 description，但不许因此与工具名漂移。
 */
const GENERAL_RESIDENT_SUMMARY: Record<string, string> = {
  bash: 'run a command (cmd.exe)',
  read_file: 'read a file page',
  write_file: 'write a text file',
  http_request: 'GET/HEAD a public URL',
  download_url: 'download into the library',
  diagnose_url: 'explain a refusal',
};

/** 每行最多列几个**必填**参数名；其余用 "…" 收尾，行才留得住 400 字符预算。 */
const GENERAL_RESIDENT_PARAM_LIMIT = 2;

/**
 * 一行参数提示：只列必填参数（顺序照 schema），有可选参数时以 "…" 收尾。
 *
 * 只列必填是预算与可读性的折中：常驻清单是索引，完整签名在 `explore_tools`
 * 的类别块里；模型真正需要知道的是"这个工具至少要我给什么"。
 */
function compactParamNames(parametersSchema: unknown): string {
  if (!parametersSchema || typeof parametersSchema !== 'object') return '';
  const schema = parametersSchema as {
    properties?: Record<string, unknown>; required?: string[];
  };
  const names = Object.keys(schema.properties ?? {});
  if (names.length === 0) return '';
  const required = (schema.required ?? []).filter(name => names.includes(name));
  const shown = required.slice(0, GENERAL_RESIDENT_PARAM_LIMIT);
  return shown.length < names.length
    ? [...shown, '…'].join(', ')
    : shown.join(', ');
}

/**
 * 常驻通用工具的紧凑清单（AC-G14a）：每个名字一行
 * `- name(args…) — 一句话`，**不展开** description 与参数块。
 *
 * 为什么另立一格：`formatCoreToolkit()` 的行格式会击穿 L0 的 18 500 断言
 * （REV-P0-1），所以这 6 个名字只走这条 ≤400 字符的单行通道；名字来源是
 * `GENERAL_RESIDENT_TOOL_NAMES`，注册表缺某个工具时仍保留一行（模型据此知道
 * 它本该存在，而不是去猜另一个工具）。
 *
 * @param registry - 已注册全部类别的工具注册表（只读取参数名）。
 * @returns 六行以内、总长 ≤ `GENERAL_RESIDENT_CHAR_CEILING` 的文本。
 */
export function formatGeneralResident(registry: ToolRegistry): string {
  const byName = new Map<string, { parameters?: unknown }>();
  for (const tool of registry.getAllTools()) byName.set(tool.name, tool);
  const lines = GENERAL_RESIDENT_TOOL_NAMES.map(name => {
    const args = compactParamNames(byName.get(name)?.parameters);
    const purpose = GENERAL_RESIDENT_SUMMARY[name] ?? 'resident general tool';
    return `- ${name}(${args}) — ${purpose}`;
  });
  const block = lines.join('\n');
  // 预算由单元测试钉死；这里只做兜底，宁可少一行也不越过 L0 的硬上限。
  return block.length <= GENERAL_RESIDENT_CHAR_CEILING
    ? block
    : lines.slice(0, -1).join('\n');
}

// ---------------------------------------------------------------------------
// Layer C — formatWorkflowRecipes
// ---------------------------------------------------------------------------

/**
 * Render the static workflow-recipes block (Layer C). The body lives in
 * `promptParts.WORKFLOW_RECIPES_MD` so it is shared with any future surface
 * that needs the same recipes.
 */
export function formatWorkflowRecipes(): string {
  return `## 工作流配方 (Workflow Recipes)\n\n${WORKFLOW_RECIPES_MD}`;
}

// ---------------------------------------------------------------------------
// Layer B — formatExploredCategoriesAppendix
// ---------------------------------------------------------------------------

/**
 * L0 system prompt 的**总**字符上限（含 web 研究引导与工具集引导）。
 *
 * 之前这个数只覆盖 `buildSystemPrompt` 的返回值，而 `agent.ts` 在它之后又
 * 拼了 `WEB_RESEARCH_GUIDANCE`（≈880 字符）与「已加载类别」回顾行（≤200），
 * 于是"上限"从未覆盖真正发给模型的那一段。实测最坏值（12 步满长计划 +
 * 800 字符记忆 + 两个已探索类别）≈ **17 400**，取 18 000 留出余量。
 *
 * agent-visual-review（§4.2）把常驻工具 `check_timeline` 的 `### check_timeline`
 * 段（≈330 字符）、`AGENT_TOOLKIT_GUIDANCE` 追加 5 行（≈400）、
 * `review_tools` 目录行（≈120）一起加进来，实测最坏值 ≈ **18 100**（AC-19 要求
 * ≤18 500），故上调到 18 900 保留约 650 字符余量。
 * 断言见 `__tests__/systemPrompt.test.ts`、`agent.systemPrompt.test.ts`、
 * `systemPrompt.toolkit.test.ts`（AC-19 / AC-28）。
 */
export const L0_PROMPT_CHAR_CEILING = 18_900;

/**
 * Per-category char ceiling for blocks rendered into the Layer B appendix.
 * ≈ 600 tokens worst-case for mixed CN/EN. Anything past this gets truncated
 * with a "see explore_tools" tail so the system prompt stays under its hard
 * `L0_PROMPT_CHAR_CEILING` even when many categories have been explored
 * (agent-general-toolkit spec §3.7 R-12).
 */
const APPENDIX_BLOCK_CHAR_CEILING = 2400;

/**
 * Total char ceiling across the entire Layer B appendix
 * (spec v2 §2.4 — "Section 9: variable, ≤ 800 tokens" → ≈ 3200 chars).
 */
const APPENDIX_TOTAL_CHAR_CEILING = 3200;

/**
 * Truncate a per-category block to `APPENDIX_BLOCK_CHAR_CEILING`. The tail
 * directs the LLM to call `explore_tools` for the full schema if it ever
 * needs more detail than the truncated form provides.
 */
function truncateAppendixBlock(block: string, categoryId: string): string {
  if (block.length <= APPENDIX_BLOCK_CHAR_CEILING) return block;
  const head = block.slice(0, APPENDIX_BLOCK_CHAR_CEILING);
  return (
    head +
    `\n…（内容已截断；如需完整参数说明，请调用 explore_tools({category: "${categoryId}"}) 重新加载）`
  );
}

/**
 * Render the "previously explored advanced categories" appendix (Layer B).
 * For each category the user has already loaded via `explore_tools` in an
 * earlier turn, include the same expanded block the explore_tools tool
 * itself would produce — so the LLM sees the detailed schemas in `system`
 * instead of having to dig them out of buried `toolResult` messages.
 *
 * Returns an empty string when `exploredCategories` is empty so the section
 * header doesn't appear at all in the cache-friendly common case.
 */
export function formatExploredCategoriesAppendix(
  registry: ToolRegistry,
  exploredCategories: CategoryId[]
): string {
  if (exploredCategories.length === 0) return '';

  const header = [
    '## 已加载的高级工具',
    '',
    '用户在更早的对话中已经通过 explore_tools 加载过下列工具类别。即便它们不在"核心工作流工具"列表中，你也可以**直接调用**——下面是它们的参数说明：',
  ];

  const blocks: string[] = [];
  let usedChars = 0;
  let truncatedCategories: string[] = [];

  for (const categoryId of exploredCategories) {
    const info = registry.getCategoryToolInfo(categoryId);
    if (!info) {
      console.warn(
        `[VideoEditingAgent] previously explored category "${categoryId}" not found in registry; skipping appendix entry.`
      );
      continue;
    }
    if (info.tools.length === 0) continue;

    const raw = formatExploreToolsResult(
      info.category.name,
      info.category.id,
      info.tools,
      getCategoryUsageHints(categoryId)
    );
    const block = truncateAppendixBlock(raw, categoryId);

    // Stop adding more blocks once we've used up the total appendix budget.
    if (usedChars + block.length > APPENDIX_TOTAL_CHAR_CEILING) {
      truncatedCategories = exploredCategories
        .slice(exploredCategories.indexOf(categoryId))
        .map(c => String(c));
      break;
    }

    blocks.push('');
    blocks.push(block);
    usedChars += block.length;
  }

  if (blocks.length === 0) return '';

  if (truncatedCategories.length > 0) {
    blocks.push('');
    blocks.push(
      `（其余已加载类别 [${truncatedCategories.join(', ')}] 因 token 预算超限未在系统提示中列出；如需查看，请调用 explore_tools 重新加载。）`
    );
  }

  return [...header, ...blocks].join('\n');
}

// ---------------------------------------------------------------------------
// buildSystemPrompt — L0 system prompt
// ---------------------------------------------------------------------------

/**
 * Input shape for `buildSystemPrompt` (spec v2 §4.1).
 *
 * Replaces the older positional signature
 * `(timelineState, materials, categorySummaries)`. There is exactly one
 * caller in the codebase (`agent.ts`) and it is updated alongside this
 * change.
 */
export interface BuildSystemPromptInput {
  timelineState: TimelineState;
  materials: MaterialItem[];
  /** Live registry — used to pull tool descriptions and parameter schemas. */
  registry: ToolRegistry;
  /** Categories the user has previously loaded via explore_tools. */
  exploredCategories: CategoryId[];
  /** Network capability snapshot; omitted means "do not claim anything". */
  capabilities?: WebCapabilitySnapshot | null;
  /**
   * 本机能力快照（`/api/agent-host/capabilities`）。缺席时 `host_tools` 与
   * `egress_tools` 不加任何可用性标注，旧调用点逐字节不变。
   */
  hostCapabilities?: HostCapabilitySnapshot | null;
  /** Latest effective plan (this turn or scanned from history). */
  plan?: AgentPlan | null;
  /** Long-term memory digest (<=5 entries, <=800 chars). */
  memoryDigest?: { text: string; count: number } | null;
  /** Enabled skills for the "可用技能" index; empty renders nothing at all. */
  skillIndex?: SkillIndexEntry[];
  /** `false` marks crew-dependent skills `[unavailable: crew]`. */
  crewEnabled?: boolean;
  /**
   * 本请求的自主模式。`'yolo'` 时不渲染 `ask_user` 段，改用 YOLO 指令与
   * YOLO 工具箱引导；缺省视为互动模式（默认路径逐字节不变，R-13）。
   */
  autonomy?: AgentAutonomy;
}

// ---------------------------------------------------------------------------
// Plan / memory digests (Layer D — agent toolkit injections)
// ---------------------------------------------------------------------------

/** `## 当前计划` 的字符上限（超出按步截断，active step 保留全文）。 */
export const PLAN_DIGEST_CHAR_CEILING = 600;
/** `## 长期记忆` 的字符上限。 */
export const MEMORY_DIGEST_CHAR_CEILING = 800;

/**
 * Render `## 当前计划`. Read-only: the plan card and this block are both
 * derived from the same tool record, so there is no second source of truth.
 * `in_progress` keeps its full title; other steps are trimmed first.
 */
export function formatPlanDigest(plan?: AgentPlan | null): string {
  if (!plan || plan.steps.length === 0) return '';
  const header = `## 当前计划 (${plan.doneCount}/${plan.total})`
    + (plan.note ? `\n${plan.note}` : '');
  const lines: string[] = [];
  for (const step of plan.steps) {
    const marker = step.status === 'completed' ? 'x'
      : step.status === 'in_progress' ? '>' : ' ';
    lines.push(`- [${marker}] ${step.title}`);
  }
  let body = lines.join('\n');
  if (header.length + body.length > PLAN_DIGEST_CHAR_CEILING) {
    // 先截断非 active 的步标题，再整体硬截断，保证 active step 仍可读。
    const trimmed = plan.steps.map(step => {
      if (step.index === plan.activeStep) return step;
      return { ...step, title: step.title.slice(0, 40) };
    });
    body = trimmed.map(step => {
      const marker = step.status === 'completed' ? 'x'
        : step.status === 'in_progress' ? '>' : ' ';
      return `- [${marker}] ${step.title}`;
    }).join('\n');
  }
  const rendered = `${header}\n${body}`;
  return rendered.length <= PLAN_DIGEST_CHAR_CEILING
    ? rendered : rendered.slice(0, PLAN_DIGEST_CHAR_CEILING);
}

/** Render `## 长期记忆`; empty digest renders nothing at all. */
export function formatMemoryDigest(
  digest?: { text: string; count: number } | null,
): string {
  if (!digest || !digest.text.trim()) return '';
  const header = '## 长期记忆（此前确认过的偏好与决定）';
  const budget = MEMORY_DIGEST_CHAR_CEILING - header.length - 1;
  const body = digest.text.length <= budget
    ? digest.text : digest.text.slice(0, budget);
  return `${header}\n${body}`;
}

/**
 * Build the L0 system prompt for the video editing agent.
 *
 * Structure (spec §2.4):
 *   1. Role and stance
 *   2. Hard rules (anti-fabrication, failure-stop, BGM volume)
 *   3. Always-available tools (10 baseline tools)
 *   4. **Core Workflow Toolkit** (Layer A — NEW)
 *   5. Project status
 *   6. **Workflow Recipes** (Layer C — NEW)
 *   7. Smart result handling
 *   8. Hard constraints (video-track-longest, no overlap)
 *   9. **Previously explored advanced categories** (Layer B — NEW)
 *
 * Token budget: ≤ 4700 tokens (≈ 18 900 chars worst-case for mixed CN/EN,
 * `L0_PROMPT_CHAR_CEILING`). The previous "< 600 tokens" budget no longer
 * applies — Layer A intentionally inlines the per-tool schemas that used to
 * live behind `explore_tools`.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const { timelineState, materials, registry, exploredCategories } = input;
  const isYolo = (input.autonomy ?? 'interactive') === 'yolo';
  const categorySummaries = registry.getCategorySummaries();

  const role = `你是一个全能视频编辑助手。分析用户需求，选择正确的工具，逐步执行编辑操作。`;

  const rules = `## 规则
- 你必须调用工具来执行任何操作。仅在文字中描述操作不会产生任何效果。
- 复合任务请自动拆解为多个步骤顺序执行。
- 媒体搜索/生成工具的结果会自动添加到素材库。web_search/web_research/extract_web_images 只产生资料或候选，下载成功才入库。AI生成任务为异步，启动后无需等待。
- 制作视频封面使用 cover_tools（可 explore_tools 查看），支持 HTML、AI、混合三种模式。默认 applyWhenReady=true，用户要求方案/候选/不要应用时设 false。queued 只能说“已开始制作，完成后会显示结果”；draft_ready 表示等待客户端准备，工具返回 completed 不代表已经写入视频。只有客户端实际状态 applied 才能称已应用。get_video_cover 返回本轮请求快照，不是实时编辑器。
- **严禁编造素材 ID**：add_to_track 的 materialId 必须来自前序 search_* / generate_* 工具返回的真实 id（如 "pexels-12345"、"unsplash-abcd"）。**绝不要**使用 "system-default-*"、"default-video-*"、"default-subtitle-*" 等占位 ID。如果素材库为空或没有合适素材，先调用 search_video / search_image / generate_ai_image 等工具获取。
- **图片先成片再上轨**：图片作为画面镜头时不要直接 add_to_track；先 explore_tools(still_tools)，用 image_to_video / batch_image_to_video 转成视频素材，再把返回的 materialId 交给 add_to_track。Logo、贴纸、水印等叠加图才用 add_to_track 的 as_still:true。**字幕不需要素材**：用 add_subtitles（cues 或 SRT），改时长用 resize_clip，加完 check_timeline 复验。
- **停止依赖失败结果的分支**：工具返回 "success: false" 时先报告限制，不得编造材料、引用或素材 ID；网络研究失败后可继续独立的既有编辑操作。连续 5 次工具失败后，Agent 将被自动中断。
- **音频音量约定**：主音频/解说轨道音量 100%；背景配乐（BGM）轨道默认音量 10%-20%，必须明显低于人声，不可盖过主音频。
- 对于罕见或本提示词未覆盖的高级工具，可调用 explore_tools 查看详情；常用工作流工具已在下方"核心工作流工具"中给出，无需先 explore。
- 历史中内容为 {"omitted": "..."} 的工具结果表示较早轮次的状态快照已省略；需要当前状态时重新调用 get_timeline / list_materials 等工具获取，不要依据旧快照操作。`;

  const overview = formatToolOverview(categorySummaries,
    categoryAvailability(input.capabilities, input.hostCapabilities));
  // YOLO 下 `ask_user` 不进工具集（§4.4），提示词也不许自曝它「currently
  // unavailable」——那是诱导模型去猜一个它拿不到的工具。
  const coreToolkit = formatCoreToolkit(registry, isYolo ? ['ask_user'] : []);
  const projectStatus = `## 项目状态\n${formatCompactSummary(timelineState, materials)}`;
  const workflowRecipes = formatWorkflowRecipes();
  const skillSection = formatSkillIndex(input.skillIndex,
    skillAvailability(input.capabilities, input.crewEnabled));

  const hardConstraints = `## ⚠️ 强制约束：视频轨道时长规则
以下规则为硬性约束，任何操作完成后都必须满足，没有例外：
- **[HARD CONSTRAINT] 视频轨道必须是最长的轨道**：最终时间线中，视频轨道上素材的总时长必须 >= 所有其他轨道（音频、字幕等）的总时长。任何其他轨道的长度都不能超过视频轨道。
- 如果某个操作导致非视频轨道超过视频轨道，工具会返回 warning 警告。**收到警告后你必须立即修正**：使用 resize_clip / trim_clip 缩短超出的轨道，或搜索更多视频素材填充视频轨道。
- 视频轨道应比音频轨道略长 1-2 秒，避免导出时出现黑屏或音频超出视频范围。
- 多个视频片段应首尾相连，中间不留空隙。
- 在完成所有轨道编辑后，调用 get_timeline 检查 constraintCheck 字段，确认约束是否满足。

## ⚠️ 强制约束：同轨不可重叠（反思-修复闭环）
- **[HARD CONSTRAINT] 同一轨道上任意两个片段的时间区间不得重叠**。
- add_to_track / move_clip / resize_clip / trim_clip / compose_storyboard 任意一次成功后，若返回 overlapWarning，**必须立即调用 auto_fix_overlaps 一次自动修复**；如希望保留刻意留白则用 move_clip 显式调整。
- 一组复合编辑结束、即将向用户报告完成之前：先调用 check_timeline_overlaps；若 valid=false，则调用 auto_fix_overlaps，再 check_timeline_overlaps，循环直至 valid=true。
- **死循环防护**：当 auto_fix_overlaps 连续 2 次返回 fixedCount=0（或 noop=true），立即停止修复循环。check_timeline_overlaps 中 autoFixable=false 的重叠（subtitle/locked 轨道）无法自动修复：除非用户要求，否则忽略它们，不要继续无意义的工具调用。
- check_timeline_overlaps / auto_fix_overlaps 仅用于编辑路径的自检；纯搜索 / 生成任务无需调用。`;

  const planDigest = formatPlanDigest(input.plan);
  const memoryDigest = formatMemoryDigest(input.memoryDigest);
  const exploredAppendix = formatExploredCategoriesAppendix(registry, exploredCategories);

  // Order matches §2.4. Section 9 (appendix) is appended LAST so the
  // deterministic prefix stays cache-stable for Anthropic prompt cache.
  const sections: string[] = [
    role,
    rules,
    // YOLO 指令紧跟规则：模式指令优先于类别提示（评审 P2-05），且它属于
    // 确定性前缀，不能挪到可变段之后（§4.5.3）。
    ...(isYolo ? [YOLO_DIRECTIVE.trim()] : []),
    overview,
    coreToolkit,
    projectStatus,
    workflowRecipes,
    ...(skillSection ? [skillSection] : []),
    hardConstraints,
    (isYolo ? YOLO_TOOLKIT_GUIDANCE : AGENT_TOOLKIT_GUIDANCE).trim(),
    // 通用层引导 + 常驻清单（§4.7）：确定性前缀的一部分，因此必须在
    // `buildSystemPrompt` 内渲染，才被 `L0_PROMPT_CHAR_CEILING` 真正约束。
    GENERAL_AGENT_GUIDANCE.trim(),
    `## 常驻通用工具\n${formatGeneralResident(registry)}`,
    // Web 研究引导与工具集引导同属**确定性**前缀：放在这里而不是由调用方
    // 事后拼接，才能被 `L0_PROMPT_CHAR_CEILING` 真正约束（D-04 的同一条理由）。
    WEB_RESEARCH_GUIDANCE.trim(),
  ];
  // Plan and memory sit after the deterministic blocks so the cache-stable
  // prefix of the prompt (role → rules → tools → status) never moves.
  if (planDigest) sections.push(planDigest);
  if (memoryDigest) sections.push(memoryDigest);
  if (exploredAppendix) sections.push(exploredAppendix);

  return sections.join('\n\n').trim();
}
