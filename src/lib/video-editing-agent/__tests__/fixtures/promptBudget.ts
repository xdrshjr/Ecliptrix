/**
 * L0 提示词预算的**唯一数字来源**。
 *
 * 为什么放在 `fixtures/` 而不是 `helpers/`：`vitest.config.ts` 的 `include` 覆盖
 * `src/**\/*.test.ts`，本文件不匹配该模式，因此不会被当成「空测试套件」
 * （"No test suite found in file"）判失败；`__tests__/` 下的非 `.test.ts` 辅助
 * 文件必须放在这里才安全。
 *
 * 设计依据：`docs/plans/agent-browser-workspace-r3/spec.md` §2.1.3 / §3.1 / §5.1。
 * 规则：**任何基线数字都必须由本函数的实测输出写入**，禁止手填、禁止二次手算
 * （评审 P0-3 的教训：手算出来的分段数字与实测差 2 506 字符）。
 */

import { buildSystemPrompt, L0_NO_INDEX_CHAR_MAX } from '../../systemPrompt';
import { formatSkillIndex, SKILL_INDEX_TOTAL_MAX_CHARS } from '../../skillContext';
import { createToolRegistry } from '../../tools/index';
import type { AgentPlan } from '@/types/agentToolkit';
import type { TimelineState } from '@/types';
import type { SkillIndexEntry } from '@/types/agentSkills';
import type { ToolContext } from '../../types';

/** 12 个分段键名固定（棘轮基线 JSON 的键名即这 12 个，不得增删）。 */
export type PromptSegmentName =
  | 'rules'
  | 'residentTools'
  | 'onDemandCatalog'
  | 'coreWorkflowTools'
  | 'projectState'
  | 'recipes'
  | 'skillIndex'
  | 'trackDuration'
  | 'noOverlap'
  | 'generalResident'
  | 'plan'
  | 'memory';

export interface PromptMeasurement {
  /** 满索引最坏总长。 */
  total: number;
  /** 无索引最坏总长（`L0_NO_INDEX_CHAR_MAX` 守的就是它）。 */
  noIndexTotal: number;
  /** 「## 可用技能」整段长度，权威口径 = `formatSkillIndex` 的返回值。 */
  indexSection: number;
  /** 12 段长度，键名 == `PromptSegmentName`。 */
  segments: Record<PromptSegmentName, number>;
}

/**
 * 12 段在提示词正文里的**起止锚点**，顺序即文档顺序（不得乱序）。
 *
 * 注意 `generalResident` 这个桶的边界：它自工具箱引导（`AGENT_TOOLKIT_GUIDANCE`）
 * 起、到 `## 当前计划` 止，因此同时包含工具箱引导、通用层引导、常驻通用工具清单
 * 与 Web 研究引导——这四段都是「确定性前缀里的常驻文本」。桶口径一旦变化，
 * 棘轮基线必须随之重测，不得手调。
 */
const SEGMENT_ANCHORS: ReadonlyArray<{
  name: PromptSegmentName; start: string; end: string | null;
}> = [
  { name: 'rules', start: '## 规则', end: '## 始终可用的工具' },
  { name: 'residentTools', start: '## 始终可用的工具', end: '## 按需能力目录' },
  { name: 'onDemandCatalog', start: '## 按需能力目录', end: '## 核心工作流工具' },
  { name: 'coreWorkflowTools', start: '## 核心工作流工具', end: '## 项目状态' },
  { name: 'projectState', start: '## 项目状态', end: '## 工作流配方' },
  { name: 'recipes', start: '## 工作流配方', end: '## 可用技能' },
  { name: 'skillIndex', start: '## 可用技能', end: '## ⚠️ 强制约束：视频轨道时长规则' },
  {
    name: 'trackDuration',
    start: '## ⚠️ 强制约束：视频轨道时长规则',
    end: '## ⚠️ 强制约束：同轨不可重叠',
  },
  { name: 'noOverlap', start: '## ⚠️ 强制约束：同轨不可重叠', end: 'For a task with 3+ steps' },
  { name: 'generalResident', start: 'For a task with 3+ steps', end: '## 当前计划' },
  { name: 'plan', start: '## 当前计划', end: '## 长期记忆' },
  { name: 'memory', start: '## 长期记忆', end: null },
];

const TIMELINE_STATE: TimelineState = {
  currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
  tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
  gridSize: 0.1, scrollLeft: 0,
};

/** 最坏计划：3 步 + 备注（与生产路径 `formatPlanDigest` 的上限同量级）。 */
export const WORST_CASE_PLAN: AgentPlan = {
  planId: 'plan-1234abcd',
  steps: [
    { index: 0, title: '搜索三条 AI 资讯', status: 'completed' },
    { index: 1, title: '写 60 秒口播稿并落到工作区', status: 'in_progress' },
    { index: 2, title: '配音、上轨、导出', status: 'pending' },
  ],
  activeStep: 1,
  doneCount: 1,
  total: 3,
  note: '资讯视频默认 16:9',
};

/** 最坏记忆：80 字符级摘要 + 条数。 */
export const WORST_CASE_MEMORY = {
  text: '- [preference] 资讯视频默认 16:9 男声解说\n- [decision] 不使用 AI 合成人脸',
  count: 2,
};

/**
 * 满长索引夹具：10 条，id 顶到 40 字符、描述 60 个 CJK 字符。
 * 这是「索引段能有多长」的构造性上界，也是 `formatSkillIndex` 截断逻辑的边界。
 */
export const MAX_INDEX: SkillIndexEntry[] = Array.from(
  { length: 10 },
  (_, index): SkillIndexEntry => ({
    id: `skill-${index}-${'x'.repeat(30)}`.slice(0, 40),
    name: 'n',
    description: '描'.repeat(60),
    requires: ['web'],
    builtin: index < 6,
  }),
);

function makeContext(): ToolContext {
  return {
    timelineState: TIMELINE_STATE, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => ({ applied: true as const }),
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
  };
}

/** 按生产路径渲染最坏提示词（满长计划 + 满长记忆 + 可选技能索引）。 */
export function renderWorstCasePrompt(skillIndex?: SkillIndexEntry[]): string {
  const context = makeContext();
  return buildSystemPrompt({
    skillIndex,
    timelineState: context.timelineState,
    materials: [],
    registry: createToolRegistry(context),
    exploredCategories: [],
    plan: WORST_CASE_PLAN,
    memoryDigest: WORST_CASE_MEMORY,
  });
}

/**
 * 按起止锚点切段。锚点缺失即长度 0（例如无索引时 `skillIndex` 为 0），
 * 这样棘轮断言在「某段被整段删除」时也会红，而不是静默跳过。
 */
function sliceSegments(text: string): Record<PromptSegmentName, number> {
  const segments = {} as Record<PromptSegmentName, number>;
  for (const { name, start, end } of SEGMENT_ANCHORS) {
    const at = text.indexOf(start);
    if (at < 0) {
      segments[name] = 0;
      continue;
    }
    const stop = end === null ? text.length : text.indexOf(end, at + start.length);
    if (end !== null && stop < 0) {
      // 尾锚点缺失时退化为「到正文末尾」，但棘轮会因段长暴涨而红——
      // 这正是我们想要的信号（比静默算 0 安全）。
      segments[name] = text.slice(at).trimEnd().length;
      continue;
    }
    segments[name] = text.slice(at, stop).trimEnd().length;
  }
  return segments;
}

/**
 * 实测最坏提示词的全部分段。**唯一权威口径**：文档与断言都引用这里的返回值，
 * 不再二次手算（评审 P0-3）。
 */
export function measurePrompt(): PromptMeasurement {
  const withIndex = renderWorstCasePrompt(MAX_INDEX);
  const withoutIndex = renderWorstCasePrompt();
  return {
    total: withIndex.length,
    noIndexTotal: withoutIndex.length,
    indexSection: formatSkillIndex(MAX_INDEX, {}).length,
    segments: sliceSegments(withIndex),
  };
}

/**
 * 由既有两条预算推导出的提示词硬上限（= 无索引上限 + 索引预算）。
 *
 * 必须等于生产常量 `L0_PROMPT_CHAR_CEILING`：这条等式就是「上限可推导、
 * 不是手填」的机器证据（spec §2.1.2 / AC-R3-1）。
 */
export const DERIVED_PROMPT_CEILING = L0_NO_INDEX_CHAR_MAX + SKILL_INDEX_TOTAL_MAX_CHARS;

/** 基线 JSON 的形状（`__tests__/fixtures/prompt-budget-baseline.json`）。 */
export interface PromptBudgetBaseline {
  version: number;
  measuredAt: string;
  noIndexTotal: number;
  fullIndexTotal: number;
  indexSection: number;
  segments: Record<PromptSegmentName, number>;
}
