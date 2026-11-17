import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAllAgentTools, createToolRegistry } from '../tools';
import { ToolActivationState } from '../registry/ToolActivationState';
import { formatToolOverview } from '../systemPrompt';
import type { ToolContext } from '../types';

afterEach(() => vi.unstubAllGlobals());

describe('特效真实按需披露', () => {
  it('首轮无特效工具，explore后仅下一轮可执行前四项', () => {
    const registry = createToolRegistry({} as ToolContext);
    const state = new ToolActivationState(registry, ['explore_tools']);
    expect(state.offer().some(tool => tool.name === 'render_effect')).toBe(false);
    const loaded = state.load('effects_tools');
    expect(loaded.loaded).toEqual(['list_effect_templates', 'get_effect_template',
      'create_effect_draft', 'update_effect_draft']);
    expect(state.canExecute('create_effect_draft')).toBe(false);
    state.offer(); expect(state.canExecute('create_effect_draft')).toBe(true);
    expect(state.canExecute('render_effect')).toBe(false);
    const summary = registry.getCategorySummaries().find(c => c.id === 'effects_tools')!;
    expect(summary.alwaysAvailable).toBe(false);
    expect(new TextEncoder().encode(summary.description).length).toBeLessThanOrEqual(160);
    expect(formatToolOverview(registry.getCategorySummaries())).toContain('effects_tools');
  });
  it('真实工具执行在下一次offer前被拒绝，加载时不顺带执行渲染', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true,
      data: { items: [], next_cursor: null } })); vi.stubGlobal('fetch', fetch);
    const registry = createToolRegistry({ apiBaseUrl: 'http://agent.test' } as ToolContext);
    const state = new ToolActivationState(registry, ['explore_tools']); state.offer();
    const tools = buildAllAgentTools(registry, state);
    const list = tools.find(tool => tool.name === 'list_effect_templates')!;
    const explore = tools.find(tool => tool.name === 'explore_tools')!;
    expect((await list.execute('before', {})).details).toMatchObject({ error_code: 'tool_not_loaded' });
    expect((await explore.execute('load', { category: 'effects_tools' })).details)
      .toMatchObject({ loaded: ['list_effect_templates', 'get_effect_template',
        'create_effect_draft', 'update_effect_draft'] });
    expect((await list.execute('same-response', {})).details)
      .toMatchObject({ error_code: 'tool_not_loaded' });
    expect(fetch).not.toHaveBeenCalled(); state.offer();
    expect((await list.execute('next-response', {})).details).toMatchObject({ success: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.offer().map(tool => tool.name)).not.toContain('render_effect');
  });
});
