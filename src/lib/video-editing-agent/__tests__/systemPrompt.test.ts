import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TimelineState } from '@/types';
import {
  buildSystemPrompt,
  formatCoreToolkit,
  formatExploredCategoriesAppendix,
  formatWorkflowRecipes,
  formatToolOverview,
} from '../systemPrompt';

it('makes web, browser and artifact categories discoverable without embedding their schemas', () => {
  const registry = new ToolRegistry();
  createDefaultCategories().forEach(category => registry.registerCategory(category));
  const overview = formatToolOverview(registry.getCategorySummaries());
  expect(overview).toContain('web_tools');
  expect(overview).toContain('browser_tools');
  expect(overview).toContain('research_tools');
  expect(overview).toContain('get_timeline');
  expect(overview).not.toContain('properties');
});
import { ToolRegistry, CATEGORY_IDS, createDefaultCategories, type CategoryId } from '../registry';
import { categoryAvailability } from '../systemPrompt';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { WEB_RESEARCH_GUIDANCE } from '../promptParts';

it('网络候选不自动入库且失败仅停止依赖分支', () => {
  const prompt = buildSystemPrompt({ timelineState: emptyTimeline(), materials: [],
    registry: buildFullStubRegistry(), exploredCategories: [] });
  expect(prompt).toContain('web_search/web_research/extract_web_images');
  expect(prompt).toContain('停止依赖失败结果的分支');
  expect(prompt).not.toContain('搜索/生成的结果会自动添加');
  expect(WEB_RESEARCH_GUIDANCE).toContain('search_snippet');
  expect(WEB_RESEARCH_GUIDANCE).toContain('quality');
});

it('目录行标注可用状态，模型可预知被关闭的能力（D-10）', () => {
  const registry = new ToolRegistry();
  createDefaultCategories().forEach(category => registry.registerCategory(category));
  const availability = categoryAvailability({
    search: { available: false, configured: false,
      error_code: 'provider_not_configured' },
    browser: { available: false, enabled: true, error_code: 'browser_unavailable' },
    downloads: { available: true },
  });
  const overview = formatToolOverview(registry.getCategorySummaries(), availability);
  expect(overview).toContain('web_tools');
  expect(overview).toContain('unavailable: provider_not_configured');
  expect(overview).toContain('unavailable: browser_unavailable');
  // 每行仍受 160 字节上限约束。
  for (const line of overview.split('\n')) {
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(160);
  }
  // 没有网络依赖的类别不加噪声后缀。
  expect(categoryAvailability(null)).toEqual({});
});

function emptyTimeline(): TimelineState {
  return {
    currentTime: 0,
    totalDuration: 0,
    zoomLevel: 1,
    selectedItems: [],
    tracks: [],
    playbackRate: 1,
    isPlaying: false,
    snapToGrid: false,
    gridSize: 1,
    scrollLeft: 0,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeStubTool(name: string, description = `${name} description`): AgentTool<any> {
  return {
    name,
    label: name,
    description,
    parameters: {
      type: 'object',
      properties: {
        foo: { type: 'string', description: 'foo param' },
      },
      required: ['foo'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: {} }),
  };
}

/**
 * Build a registry that contains every tool listed in CORE_TOOLKIT_TOOL_NAMES,
 * grouped under sensible categories. Returns the registry plus the list of
 * names registered (for assertions).
 */
function buildFullStubRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const cat of createDefaultCategories()) registry.registerCategory(cat);

  registry.registerToolsForCategory(CATEGORY_IDS.SEARCH_TOOLS, [
    makeStubTool('search_video'),
    makeStubTool('search_image'),
    makeStubTool('search_audio'),
  ]);
  registry.registerToolsForCategory(CATEGORY_IDS.AI_GEN_TOOLS, [
    makeStubTool('generate_ai_image'),
    makeStubTool('generate_ai_video'),
  ]);
  registry.registerToolsForCategory(CATEGORY_IDS.STILL_TOOLS, [
    makeStubTool('image_to_video'),
    makeStubTool('batch_image_to_video'),
  ]);
  registry.registerToolsForCategory(CATEGORY_IDS.TTS_TOOLS, [
    makeStubTool('generate_tts'),
    makeStubTool('batch_generate_tts'),
  ]);
  registry.registerToolsForCategory(CATEGORY_IDS.SCRIPT_TOOLS, [
    makeStubTool('generate_video_script'),
    makeStubTool('expand_video_script'),
  ]);
  registry.registerToolsForCategory(CATEGORY_IDS.STORYBOARD_TOOLS, [
    makeStubTool('generate_storyboard'),
    makeStubTool('describe_storyboard'),
    makeStubTool('batch_storyboard_video'),
    makeStubTool('compose_storyboard'),
  ]);
  registry.registerToolsForCategory(CATEGORY_IDS.MATERIAL_TOOLS, [
    // Real registry registers this as `add_material_to_library` (see
    // tools/addMaterialToLibrary.ts). Using the same name here keeps the
    // snapshot tests warn-free; the registry-drift case is tested separately.
    makeStubTool('add_material_to_library'),
  ]);
  return registry;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSystemPrompt — Snapshot 1: fresh project, no explored categories', () => {
  it('contains all required sections and excludes the explored-categories appendix', () => {
    const registry = buildFullStubRegistry();
    const prompt = buildSystemPrompt({
      timelineState: emptyTimeline(),
      materials: [],
      registry,
      exploredCategories: [],
    });

    expect(prompt).toContain('## 始终可用的工具');
    expect(prompt).toContain('## 核心工作流工具');
    expect(prompt).toContain('## 工作流配方');
    expect(prompt).toContain('## ⚠️ 强制约束：视频轨道时长规则');
    expect(prompt).toContain('## ⚠️ 强制约束：同轨不可重叠');
    expect(prompt).not.toContain('## 已加载的高级工具');
  });

  it('keeps the prompt under the 18900-char ceiling (≈ 4250 tokens worst case)', () => {
    const registry = buildFullStubRegistry();
    const prompt = buildSystemPrompt({
      timelineState: emptyTimeline(),
      materials: [],
      registry,
      exploredCategories: [],
    });
    expect(prompt.length).toBeLessThanOrEqual(18_900);
  });
});

describe('buildSystemPrompt — Snapshot 2: explored categories appendix', () => {
  it('includes the appendix with the explored categories\' parameter signatures', () => {
    const registry = buildFullStubRegistry();
    const prompt = buildSystemPrompt({
      timelineState: emptyTimeline(),
      materials: [],
      registry,
      exploredCategories: [
        CATEGORY_IDS.STORYBOARD_TOOLS,
        CATEGORY_IDS.TTS_TOOLS,
      ] as CategoryId[],
    });

    expect(prompt).toContain('## 已加载的高级工具');
    expect(prompt).toContain('generate_storyboard');
    expect(prompt).toContain('generate_tts');
    expect(prompt).toContain('storyboard_tools');
    expect(prompt).toContain('tts_tools');
  });

  it('still respects the 18900-char ceiling with two categories appended', () => {
    const registry = buildFullStubRegistry();
    const prompt = buildSystemPrompt({
      timelineState: emptyTimeline(),
      materials: [],
      registry,
      exploredCategories: [
        CATEGORY_IDS.STORYBOARD_TOOLS,
        CATEGORY_IDS.TTS_TOOLS,
      ] as CategoryId[],
    });
    expect(prompt.length).toBeLessThanOrEqual(18_900);
  });
});

describe('formatCoreToolkit — registry drift', () => {
  it('warns and emits a stub line when a CORE_TOOLKIT name is missing from the registry; does NOT throw', () => {
    // Registry that's missing many of the CORE_TOOLKIT names — only register one.
    const registry = new ToolRegistry();
    for (const cat of createDefaultCategories()) registry.registerCategory(cat);
    registry.registerToolsForCategory(CATEGORY_IDS.SEARCH_TOOLS, [makeStubTool('search_video')]);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const text = formatCoreToolkit(registry);

    // At least one warning must have fired (one per missing tool).
    expect(warnSpy).toHaveBeenCalled();
    // The "(currently unavailable)" stub line must appear for missing tools.
    expect(text).toContain('(currently unavailable');
    // The one tool that IS registered should still render normally.
    expect(text).toContain('search_video');
  });
});

describe('formatExploredCategoriesAppendix', () => {
  it('returns empty string when the explored list is empty', () => {
    const registry = buildFullStubRegistry();
    expect(formatExploredCategoriesAppendix(registry, [])).toBe('');
  });

  it('emits the section header and per-category blocks for known categories', () => {
    const registry = buildFullStubRegistry();
    const out = formatExploredCategoriesAppendix(registry, [CATEGORY_IDS.SCRIPT_TOOLS] as CategoryId[]);
    expect(out).toContain('## 已加载的高级工具');
    expect(out).toContain('generate_video_script');
    expect(out).toContain('expand_video_script');
  });
});

describe('formatWorkflowRecipes', () => {
  it('returns a non-empty block under the 工作流配方 header', () => {
    const out = formatWorkflowRecipes();
    expect(out).toContain('## 工作流配方');
    // Recipes 1-3 became built-in skills; the every-turn rule stays inline.
    expect(out).toContain('仅入库 vs 上轨');
    expect(out).not.toContain('配方 1');
    expect(out.length).toBeGreaterThan(100);
  });
});
