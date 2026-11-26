import { describe, expect, it } from 'vitest';
import type { TimelineState } from '@/types';
import type { ToolContext } from '../types';
import type { AgentPlan } from '@/types/agentToolkit';
import type { SkillIndexEntry } from '@/types/agentSkills';
import {
  L0_NO_INDEX_CHAR_MAX,
  L0_PROMPT_CHAR_CEILING,
  buildSystemPrompt,
} from '../systemPrompt';
import { createToolRegistry } from '../tools/index';
import { createAddSubtitlesTool } from '../tools/addSubtitles';
import { LINT_ASPECT_RATIOS } from '../tools/qualityLint';
import { CATEGORY_IDS, createDefaultCategories } from '../registry/categories';

/**
 * 披露与预算（agent-subtitles spec §3 / D-18 / P1-6 / P2-2 / §9.1）。
 *
 * 字幕工具必须被模型**在常驻层**看见（否则用户报障会在同一个点上重演），而
 * L0 常驻文本是产品预算：满技能索引时只剩几十字符余量，所以这里同时钉住
 * 「工具行在」与「无索引 ≤18 500、满索引 ≤19 800」。
 */

function makeContext(): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => ({ applied: true }),
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
  };
}

const PLAN: AgentPlan = {
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

const MEMORY = {
  text: '- [preference] 资讯视频默认 16:9 男声解说\n- [decision] 不使用 AI 合成人脸',
  count: 2,
};

/** 与 `systemPrompt.toolkit.test.ts` 的满索引用例同构（最坏情形）。 */
const MAX_INDEX = Array.from({ length: 10 }, (_, index): SkillIndexEntry => ({
  id: `skill-${index}-${'x'.repeat(30)}`.slice(0, 40),
  name: 'n',
  description: '描'.repeat(60),
  requires: ['web'],
  builtin: index < 6,
}));

function prompt(skillIndex?: SkillIndexEntry[]) {
  const context = makeContext();
  const registry = createToolRegistry(context);
  return buildSystemPrompt({
    skillIndex,
    timelineState: context.timelineState,
    materials: [],
    registry,
    exploredCategories: [],
    plan: PLAN,
    memoryDigest: MEMORY,
  });
}

describe('subtitle disclosure', () => {
  it('lists add_subtitles as an always-available tool', () => {
    const text = prompt();
    expect(text).toContain('add_subtitles');
    // 常驻工具目录是「- 名称: 一行说明」的清单
    expect(text).toMatch(/- add_subtitles: .+/);
  });

  it('states the subtitle rules in L0 (no material, SRT sources, resize/verify)', () => {
    const text = prompt();
    expect(text).toContain('字幕不需要素材');
    expect(text).toContain('add_subtitles（cues 或 SRT）');
    expect(text).toContain('check_timeline 复验');
  });

  it('adds the subtitle workflow recipe', () => {
    const text = prompt();
    expect(text).toContain('要字幕');
    expect(text).toContain('仅入库 vs 上轨');
  });

  it('keeps add_subtitles inside editing_tools so no explore_tools round is wasted', () => {
    const registry = createToolRegistry(makeContext());
    const names = registry.getCategoryTools(CATEGORY_IDS.EDITING_TOOLS)
      .map(tool => tool.name);
    expect(names).toContain('add_subtitles');
    expect(registry.getAlwaysAvailableTools().map(tool => tool.name))
      .toContain('add_subtitles');
  });

  it('names add_subtitles in the editing_tools category description (P2-2)', () => {
    const editing = createDefaultCategories().find(
      category => category.id === CATEGORY_IDS.EDITING_TOOLS,
    );
    expect(editing?.description).toContain('add_subtitles');
  });

  it('stays within the derived L0 budget in the worst case (D-18)', () => {
    expect(prompt(MAX_INDEX).length).toBeLessThanOrEqual(L0_PROMPT_CHAR_CEILING);
    expect(prompt().length).toBeLessThanOrEqual(L0_NO_INDEX_CHAR_MAX);
  });

  it('keeps the resident schema well under the 48 KiB disclosure cap', () => {
    const registry = createToolRegistry(makeContext());
    const resident = [
      ...registry.getAlwaysAvailableTools(),
      ...registry.getCategoryTools(CATEGORY_IDS.QUERY_TOOLS),
    ];
    const bytes = Buffer.byteLength(JSON.stringify(
      resident.map(tool => ({ name: tool.name, parameters: tool.parameters })),
    ), 'utf8');
    expect(bytes).toBeLessThan(48 * 1024);
  });
});

describe('aspect ratio contract', () => {
  /** `addSubtitles.ts` 刻意复制了 `LINT_ASPECT_RATIOS`（ESM 循环下 `const` 有 TDZ
   *  风险），一致性由这里钉住：闭集里每个值都必须被工具接受。 */
  it('accepts every aspect ratio check_timeline accepts', async () => {
    for (const ratio of LINT_ASPECT_RATIOS) {
      const context = makeContext();
      const result = await createAddSubtitlesTool(context).execute(
        `call-${ratio}`,
        {
          cues: [{ text: '一句字幕', startTime: 0, duration: 1 }],
          aspect_ratio: ratio,
        } as never,
        undefined as never,
        undefined as never,
      );
      expect(result.details).toMatchObject({ success: true, assumedFrame: ratio });
    }
  });

  it('computes the same per-line budget check_timeline does', async () => {
    const context = makeContext();
    const result = await createAddSubtitlesTool(context).execute(
      'call-budget',
      {
        cues: [{ text: '一句字幕', startTime: 0, duration: 1 }],
        aspect_ratio: '9:16',
        style: { fontSize: 60 },
      } as never,
      undefined as never,
      undefined as never,
    );
    // maxSubtitleChars(1080, 60) = floor((1080 - 100) / 60) = 16
    expect(result.details).toMatchObject({ lineBudget: 16 });
  });
});
