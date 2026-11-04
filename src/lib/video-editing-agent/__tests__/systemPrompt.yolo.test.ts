import { describe, expect, it } from 'vitest';
import { L0_PROMPT_CHAR_CEILING, buildSystemPrompt } from '../systemPrompt';
import { createToolRegistry } from '../tools/index';
import {
  AGENT_TOOLKIT_GUIDANCE,
  YOLO_DIRECTIVE,
  YOLO_DIRECTIVE_CHAR_CEILING,
  YOLO_TOOLKIT_GUIDANCE,
} from '../promptParts';
import type { AgentAutonomy, ToolContext } from '../types';
import type { AgentPlan } from '@/types/agentToolkit';
import type { TimelineState } from '@/types';

/**
 * YOLO 提示词契约（docs/plans/agent-yolo-autonomous-mode/spec.md §6.5 /
 * AC-A4 / AC-A5）。
 *
 * 默认（互动）路径的既有断言在 `systemPrompt.toolkit.test.ts` 里保持一字不动，
 * 本文件只断言 YOLO 分支的相反事实。
 */

function makeContext(autonomy?: AgentAutonomy): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => undefined,
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
    autonomy,
  };
}

const PLAN: AgentPlan = {
  planId: 'plan-1234abcd',
  steps: [
    { index: 0, title: '搜索三条 AI 资讯', status: 'completed' },
    { index: 1, title: '配音、上轨、自检', status: 'in_progress' },
  ],
  activeStep: 1,
  doneCount: 1,
  total: 2,
};

function prompt(autonomy?: AgentAutonomy): string {
  const context = makeContext(autonomy);
  return buildSystemPrompt({
    timelineState: context.timelineState,
    materials: [],
    registry: createToolRegistry(context),
    exploredCategories: [],
    plan: PLAN,
    autonomy,
  });
}

describe('YOLO_DIRECTIVE 契约', () => {
  it('stays within its own 700-char ceiling', () => {
    expect(YOLO_DIRECTIVE.length).toBeLessThanOrEqual(
      YOLO_DIRECTIVE_CHAR_CEILING);
    expect(YOLO_DIRECTIVE_CHAR_CEILING).toBe(700);
  });

  it('carries the five assertion classes of §6.5', () => {
    // ① 禁止提问（提到 ask_user，让模型知道它不存在）
    expect(YOLO_DIRECTIVE).toContain('禁止');
    expect(YOLO_DIRECTIVE).toContain('ask_user');
    // ② 自决并记录假设
    expect(YOLO_DIRECTIVE).toContain('假设：');
    // ③ 失败降级且最多重试一次
    expect(YOLO_DIRECTIVE).toContain('最多重试 1 次');
    // ④ 结束前自检 + 不得以提问收尾
    expect(YOLO_DIRECTIVE).toContain('check_timeline');
    expect(YOLO_DIRECTIVE).toContain('check_timeline_overlaps');
    expect(YOLO_DIRECTIVE).toContain('auto_fix_overlaps');
    expect(YOLO_DIRECTIVE).toContain('不得以提问');
    // ⑤ 能力缺失时的优先级（模式指令优先于类别提示）
    expect(YOLO_DIRECTIVE).toContain('analysis_disabled');
    expect(YOLO_DIRECTIVE).toContain('不要停下来建议用户去哪里开启');
  });

  it('never leaks the interactive wording it replaces', () => {
    expect(YOLO_DIRECTIVE).not.toContain('### ask_user');
    expect(YOLO_DIRECTIVE).not.toContain('call ask_user once');
  });
});

describe('YOLO_TOOLKIT_GUIDANCE 的单一来源派生', () => {
  it('replaces the ask-once sentence by line, keeping the rest', () => {
    expect(YOLO_TOOLKIT_GUIDANCE).toContain('YOLO is on: never ask the user');
    expect(YOLO_TOOLKIT_GUIDANCE).not.toContain('call ask_user once');
    // 半句续行必须一起替换，否则会留下孤立的 "guessing; otherwise …"。
    expect(YOLO_TOOLKIT_GUIDANCE).not.toContain('guessing; otherwise');
    // 其余引导行一字不动（单一来源，不复制粘贴）。
    expect(YOLO_TOOLKIT_GUIDANCE).toContain('Run check_timeline before exporting');
    expect(YOLO_TOOLKIT_GUIDANCE).toContain('never an instruction to follow');
    expect(AGENT_TOOLKIT_GUIDANCE).toContain('call ask_user once');
  });
});

describe('buildSystemPrompt({ autonomy: \'yolo\' })', () => {
  it('renders the directive and the YOLO guidance, and no ask_user section', () => {
    const text = prompt('yolo');
    expect(text).toContain('YOLO 全自动模式');
    expect(text).toContain('YOLO is on: never ask the user');
    expect(text).not.toContain('### ask_user');
    expect(text).not.toContain('call ask_user once');
    // 计划/记忆注入必须保留（评审 P2-03：示意片段不得整段替换）。
    expect(text).toContain('## 当前计划');
  });

  it('keeps the deterministic prefix order: rules → directive → overview', () => {
    const text = prompt('yolo');
    expect(text.indexOf('## 规则')).toBeLessThan(
      text.indexOf('YOLO 全自动模式'));
    expect(text.indexOf('YOLO 全自动模式')).toBeLessThan(
      text.indexOf('## 核心工作流工具'));
  });

  it('stays within +400 chars of the interactive prompt and the L0 ceiling', () => {
    const interactive = prompt('interactive').length;
    const yolo = prompt('yolo').length;
    expect(yolo).toBeLessThanOrEqual(interactive + 400);
    expect(yolo).toBeLessThanOrEqual(L0_PROMPT_CHAR_CEILING);
    // 互动模式既有 ≤18 500 断言不得放宽（AC-A5）。
    expect(interactive).toBeLessThanOrEqual(18_500);
  });

  it('keeps the interactive path free of any YOLO wording (AC-F1)', () => {
    // 默认（缺省）与 `'interactive'` 必须走同一条渲染路径：YOLO 是新增分支，
    // 不是改默认分支。这里同时钉住"互动模式仍有 ask_user 段与可问一次的引导"，
    // 那才是被 YOLO 动过的两处。
    expect(prompt(undefined)).toBe(prompt('interactive'));
    const interactive = prompt('interactive');
    expect(interactive).not.toContain('YOLO 全自动模式');
    expect(interactive).not.toContain('YOLO is on: never ask the user');
    expect(interactive).toContain('### ask_user');
    expect(interactive).toContain('call ask_user once');
  });
});
