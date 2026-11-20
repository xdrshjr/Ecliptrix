import { describe, expect, it } from 'vitest';
import { buildAllAgentTools, createToolRegistry } from '../tools';
import { ToolActivationState } from '../registry/ToolActivationState';
import { ON_DEMAND_CATEGORY_IDS } from '../registry';
import { getCategoryUsageHints } from '../promptParts';
import { formatToolOverview } from '../systemPrompt';
import type { ToolContext } from '../types';

/**
 * 特效能力的渐进式披露（评审 R-6）：L0 只多两行目录，工具 schema 要 explore 之后
 * 才进上下文，用法流程随 explore 当轮返回。
 */

const bytes = (text: string) => new TextEncoder().encode(text).length;
const registryOf = () => createToolRegistry({} as ToolContext);
const summaryOf = (id: string) => registryOf().getCategorySummaries().find(c => c.id === id)!;

describe('L0 目录', () => {
  it('特效两行：任务导向且在预算内，clip_effects 紧邻 effects_tools', () => {
    const effects = summaryOf('effects_tools');
    const clip = summaryOf('clip_effects');
    expect(bytes(effects.description)).toBeLessThanOrEqual(100);
    expect(bytes(clip.description)).toBeLessThanOrEqual(90);
    // 防止再被缩成 "Remotion FX." 这样的一句话：模型要靠这一行知道何时去 explore。
    expect(effects.description).toMatch(/render/i);
    expect(effects.description).toMatch(/apply/i);
    expect(clip.description).toMatch(/camera/i);
    expect(clip.description).toMatch(/fade|dissolve/i);
    expect(clip.description).toMatch(/no render/i);
    const ids = ON_DEMAND_CATEGORY_IDS as string[];
    expect(ids.indexOf('clip_effects')).toBe(ids.indexOf('effects_tools') + 1);
  });

  it('每个按需类别都出现在渲染后的目录里（整体 2400B 截断不得挤掉末尾类别）', () => {
    const text = formatToolOverview(registryOf().getCategorySummaries());
    for (const id of ON_DEMAND_CATEGORY_IDS) {
      expect(text, `${id} 被目录截断`).toContain(`- ${id}:`);
    }
    // 目录最后一行必须是完整的一行，而不是被切在半行。
    const lines = text.split('\n');
    const lastLine = lines[lines.length - 1];
    const onDemand = registryOf().getCategorySummaries().filter(c => !c.alwaysAvailable);
    const lastCategory = onDemand[onDemand.length - 1];
    expect(lastLine.startsWith(`- ${lastCategory.id}:`)).toBe(true);
  });
});

describe('按需加载', () => {
  it('首轮看不到 clip_effects 工具；explore 后仅下一轮可执行', () => {
    const registry = registryOf();
    const state = new ToolActivationState(registry, ['explore_tools']);
    expect(state.offer().some(tool => tool.name === 'set_camera_motion')).toBe(false);
    const loaded = state.load('clip_effects');
    expect(loaded.loaded).toEqual(['set_camera_motion', 'set_clip_transition']);
    expect(state.canExecute('set_camera_motion')).toBe(false);
    state.offer();
    expect(state.canExecute('set_camera_motion')).toBe(true);
    expect(state.canExecute('set_clip_transition')).toBe(true);
  });

  it('两个工具的 schema 合计 < 2.5 KiB', () => {
    const info = registryOf().getCategoryToolInfo('clip_effects')!;
    expect(info.tools).toHaveLength(2);
    const size = bytes(JSON.stringify(info.tools.map(tool => tool.parametersSchema)));
    expect(size).toBeLessThan(2560);
  });

  it('explore_tools 激活分支当轮返回 usage_hints（特效流程与成本）', async () => {
    const registry = registryOf();
    const state = new ToolActivationState(registry, ['explore_tools']);
    state.offer();
    const explore = buildAllAgentTools(registry, state).find(tool => tool.name === 'explore_tools')!;
    const effects = (await explore.execute('e1', { category: 'effects_tools' })).details as
      { usage_hints: string; loaded: string[] };
    expect(bytes(effects.usage_hints)).toBeLessThanOrEqual(800);
    expect(effects.usage_hints).toContain('render_effect');
    expect(effects.usage_hints).toContain('apply_effect');
    expect(effects.usage_hints).toContain('tool_names');
    const clip = (await explore.execute('e2', { category: 'clip_effects' })).details as
      { usage_hints: string; loaded: string[] };
    expect(clip.loaded).toEqual(['set_camera_motion', 'set_clip_transition']);
    expect(clip.usage_hints).toContain('set_camera_motion');
    expect(clip.usage_hints).toContain('no render');
  });

  it('用法提示写明先 apply_effect、再设运镜/转场（指纹会随片段变化）', () => {
    expect(getCategoryUsageHints('effects_tools')).toMatch(/AFTER apply_effect/);
    expect(bytes(getCategoryUsageHints('effects_tools'))).toBeLessThanOrEqual(800);
    expect(bytes(getCategoryUsageHints('clip_effects'))).toBeLessThanOrEqual(800);
  });
});
