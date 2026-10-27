import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../types';
import { createToolRegistry } from '../tools/index';
import { createSkillTool } from '../tools/skillTools';
import { RESULT_BYTE_CAP } from '../tools/webToolAdapter';

function context(extra: Partial<ToolContext> = {}): ToolContext {
  return {
    timelineState: {
      currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks: [],
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 0.1, scrollLeft: 0,
    },
    materials: [], apiBaseUrl: 'http://127.0.0.1:3000', operations: new Map(),
    updateTimeline: () => undefined, recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 },
    ...extra,
  };
}

function skillReply(skill: Record<string, unknown>) {
  return vi.fn(async () => new Response(JSON.stringify({
    success: true,
    data: {
      id: 'demo-skill', name: 'Demo', version: 1, tools: [], requires: [], body: 'steps',
      enabled: true, valid: true, markdown: 'IGNORED '.repeat(2000), ...skill,
    },
  }), { status: 200 }));
}

function tool(extra: Partial<ToolContext> = {}) {
  const ctx = context(extra);
  return createSkillTool(ctx, createToolRegistry(ctx));
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

afterEach(() => vi.unstubAllGlobals());

describe('use_skill', () => {
  it('returns the body and drops the redundant markdown field', async () => {
    vi.stubGlobal('fetch', skillReply({}));
    const result = await tool().execute('call-1', { id: 'demo-skill' });
    const details = result.details as Record<string, unknown>;
    expect(details).toMatchObject({ success: true, id: 'demo-skill', body: 'steps' });
    expect(details).not.toHaveProperty('markdown');
  });

  it('preloads tools by category and records the ones it could not load', async () => {
    vi.stubGlobal('fetch', skillReply({ tools: ['view_image', 'search_video', 'no_such_tool'] }));
    const loadTools = vi.fn((_category: string, names: string[]) => ({ loaded: names }));
    const result = await tool({ loadTools }).execute('call-1', { id: 'demo-skill' });
    const details = result.details as { loaded_tools: string[]; unavailable: unknown[]; note: string };
    // search_video is a resident core tool: nothing to load for it.
    expect(loadTools).toHaveBeenCalledWith('review_tools', ['view_image']);
    expect(details.loaded_tools).toEqual(expect.arrayContaining(['view_image', 'search_video']));
    expect(details.unavailable).toEqual([{ tool: 'no_such_tool', reason: 'unknown_tool' }]);
    expect(details.note).toContain('NEXT response');
  });

  it('keeps the skill usable when a preload throws (tool_schema_budget)', async () => {
    vi.stubGlobal('fetch', skillReply({ tools: ['view_image'] }));
    const loadTools = vi.fn(() => { throw new Error('tool_schema_budget'); });
    const result = await tool({ loadTools }).execute('call-1', { id: 'demo-skill' });
    const details = result.details as { success: boolean; unavailable: Array<{ reason: string }> };
    expect(details.success).toBe(true);
    expect(details.unavailable[0].reason).toBe('tool_schema_budget');
  });

  it('tells the model when a required capability is unavailable but still returns the body', async () => {
    vi.stubGlobal('fetch', skillReply({ requires: ['web'] }));
    const result = await tool({ skillAvailability: { web: false } })
      .execute('call-1', { id: 'demo-skill' });
    const details = result.details as { body: string; note: string };
    expect(details.body).toBe('steps');
    expect(details.note).toContain('web capability is currently unavailable');
  });

  it.each([
    ['disabled', { enabled: false }, 'skill_disabled'],
    ['invalid', { valid: false }, 'invalid_skill'],
  ])('refuses a %s skill', async (_label, patch, code) => {
    vi.stubGlobal('fetch', skillReply(patch));
    const result = await tool().execute('call-1', { id: 'demo-skill' });
    expect(result.details).toMatchObject({ success: false, error_code: code });
  });

  it('passes a backend 404 through as a failure with a next step', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(
      { success: false, error_code: 'skill_not_found', message: 'x' }), { status: 404 })));
    const result = await tool().execute('call-1', { id: 'demo-skill' });
    expect(result.details).toMatchObject({ success: false, error_code: 'skill_not_found' });
    expect((result.details as { next_step: string }).next_step).toContain('可用技能');
  });

  it('returns a cancelled failure without any request when the turn was aborted', async () => {
    const fetchMock = skillReply({});
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();
    const result = await tool({ abortSignal: controller.signal })
      .execute('call-1', { id: 'demo-skill' });
    expect(result.details).toMatchObject({ success: false, error_code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['3500 Chinese characters', '中'.repeat(3500)],
    ['4-byte characters filling the byte limit', '😀'.repeat(2560)],
    ['newline-heavy text that expands under JSON escaping', '行\n'.repeat(3400)],
  ])('keeps the whole result under 12 KiB for %s (AC-B6)', async (_label, body) => {
    vi.stubGlobal('fetch', skillReply({ body }));
    const result = await tool().execute('call-1', { id: 'demo-skill' });
    const details = result.details as { body: string; truncated?: boolean };
    expect(bytes(details)).toBeLessThanOrEqual(RESULT_BYTE_CAP);
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(RESULT_BYTE_CAP);
    expect(details.truncated).toBeUndefined();
    // Body is delivered whole unless JSON escaping alone pushes it over the cap.
    if (!body.includes('\n')) expect(details.body).toBe(body);
  });
});
