import { describe, expect, it } from 'vitest';
import {
  MEMORY_DIGEST_CHAR_CEILING,
  PLAN_DIGEST_CHAR_CEILING,
  buildSystemPrompt,
  formatMemoryDigest,
  formatPlanDigest,
} from '../systemPrompt';
import { createToolRegistry } from '../tools/index';
import {
  CORE_TOOLKIT_TOOL_NAMES,
  AGENT_TOOLKIT_GUIDANCE,
  WEB_RESEARCH_GUIDANCE,
} from '../promptParts';
import type { ToolContext } from '../types';
import type { AgentPlan } from '@/types/agentToolkit';
import type { TimelineState } from '@/types';

/**
 * L0 预算实测 + 计划/记忆注入上限 + 常驻工具恰好一次（AC-24 / AC-28）。
 */

function makeContext(): ToolContext {
  const timelineState: TimelineState = {
    currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false,
    gridSize: 0.1, scrollLeft: 0,
  };
  return {
    timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => undefined,
    recordOperation: () => undefined, turnState: {},
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

function prompt() {
  const context = makeContext();
  const registry = createToolRegistry(context);
  return buildSystemPrompt({
    timelineState: context.timelineState,
    materials: [],
    registry,
    exploredCategories: [],
    plan: PLAN,
    memoryDigest: MEMORY,
  });
}

describe('L0 prompt budget', () => {
  it('stays under the 18000-char ceiling with plan and memory injected', () => {
    const text = prompt();
    expect(text.length).toBeLessThanOrEqual(18_000);
  });

  it('renders update_plan and ask_user exactly once each as core sections', () => {
    const text = prompt();
    for (const name of ['update_plan', 'ask_user']) {
      const occurrences = text.split(`### ${name}`).length - 1;
      expect(occurrences).toBe(1);
    }
    expect(CORE_TOOLKIT_TOOL_NAMES).toContain('update_plan');
    expect(CORE_TOOLKIT_TOOL_NAMES).toContain('ask_user');
  });

  it('keeps the guidance block in the prompt', () => {
    expect(prompt()).toContain(AGENT_TOOLKIT_GUIDANCE.trim().slice(0, 40));
  });

  it('covers the web-research guidance inside the same ceiling', () => {
    // 这段引导以前由 `agent.ts` 在 `buildSystemPrompt` 之后拼接，于是"上限"
    // 从未覆盖真正发给模型的提示词。现在它在函数内部，必须一起被量到。
    const text = prompt();
    expect(text).toContain(WEB_RESEARCH_GUIDANCE.trim().slice(0, 40));
    expect(text.length).toBeLessThanOrEqual(18_000);
  });
});

describe('formatPlanDigest', () => {
  it('summarises status with markers and the done count', () => {
    const digest = formatPlanDigest(PLAN);
    expect(digest).toContain('当前计划 (1/3)');
    expect(digest).toContain('- [x] 搜索三条 AI 资讯');
    expect(digest).toContain('- [>] 写 60 秒口播稿并落到工作区');
    expect(digest).toContain('- [ ] 配音、上轨、导出');
  });

  it('renders nothing without a plan', () => {
    expect(formatPlanDigest(null)).toBe('');
    expect(formatPlanDigest(undefined)).toBe('');
  });

  it('truncates to the documented ceiling and keeps the active step', () => {
    const long: AgentPlan = {
      ...PLAN,
      steps: Array.from({ length: 12 }, (_, index) => ({
        index,
        title: `步骤 ${index} ` + 'x'.repeat(90),
        status: index === 5 ? 'in_progress' as const : 'pending' as const,
      })),
      activeStep: 5,
    };
    const digest = formatPlanDigest(long);
    expect(digest.length).toBeLessThanOrEqual(PLAN_DIGEST_CHAR_CEILING);
    expect(digest).toContain('- [>] 步骤 5 ');
  });
});

describe('formatMemoryDigest', () => {
  it('renders the digest with a header', () => {
    const digest = formatMemoryDigest(MEMORY);
    expect(digest).toContain('长期记忆');
    expect(digest).toContain('男声解说');
  });

  it('renders nothing when empty', () => {
    expect(formatMemoryDigest({ text: '', count: 0 })).toBe('');
    expect(formatMemoryDigest(null)).toBe('');
  });

  it('honours the 800-char ceiling', () => {
    const huge = { text: 'y'.repeat(5000), count: 5 };
    expect(formatMemoryDigest(huge).length)
      .toBeLessThanOrEqual(MEMORY_DIGEST_CHAR_CEILING);
  });
});

describe('discovery', () => {
  it('keeps all four new on-demand categories in the L0 catalog', () => {
    const text = prompt();
    for (const id of ['workspace_tools', 'document_tools', 'analysis_tools',
      'memory_tools']) {
      expect(text).toContain(id);
    }
  });
});
