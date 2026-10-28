/**
 * Progressive disclosure of "images become video before they go on the track"
 * (docs/plans/agent-still-to-clip, §3 / AC-12..14): the rule is one line in L0,
 * the converters live in an on-demand category, and nothing about them is
 * resident except that line and one catalog row.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt';
import { createToolRegistry } from '../tools/index';
import { ToolActivationState } from '../registry/ToolActivationState';
import { CATEGORY_IDS, ON_DEMAND_CATEGORY_IDS } from '../registry/categories';
import {
  CATEGORY_USAGE_HINTS, CORE_TOOLKIT_TOOL_NAMES, getCategoryUsageHints,
} from '../promptParts';
import type { ToolContext } from '../types';

function makeContext(): ToolContext {
  return {
    timelineState: {
      currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [], tracks: [],
      playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 0.1, scrollLeft: 0,
    },
    materials: [], apiBaseUrl: 'http://127.0.0.1:3000', operations: new Map(),
    updateTimeline: () => undefined, recordOperation: () => undefined,
    turnState: {}, callBudget: { used: 0 },
  };
}

const context = makeContext();
const registry = createToolRegistry(context);
const prompt = buildSystemPrompt({
  timelineState: context.timelineState, materials: [], registry, exploredCategories: [],
});

describe('still_tools category', () => {
  it('is on demand and holds exactly the two converters', () => {
    expect(ON_DEMAND_CATEGORY_IDS).toContain(CATEGORY_IDS.STILL_TOOLS);
    expect(registry.getCategory(CATEGORY_IDS.STILL_TOOLS)?.alwaysAvailable).toBe(false);
    expect(registry.getCategoryTools(CATEGORY_IDS.STILL_TOOLS).map(tool => tool.name))
      .toEqual(['image_to_video', 'batch_image_to_video']);
  });

  it('leaves ai_gen_tools with the two generators only', () => {
    expect(registry.getCategoryTools(CATEGORY_IDS.AI_GEN_TOOLS).map(tool => tool.name))
      .toEqual(['generate_ai_image', 'generate_ai_video']);
  });

  it('keeps its catalog description on one short line', () => {
    const { description } = registry.getCategory(CATEGORY_IDS.STILL_TOOLS)!;
    expect(new TextEncoder().encode(`- still_tools: ${description}`).length).toBeLessThanOrEqual(160);
  });

  it('has a usage hint that says synchronous, idempotent and where the id goes', () => {
    const hint = getCategoryUsageHints(CATEGORY_IDS.STILL_TOOLS);
    expect(hint).not.toBe(getCategoryUsageHints('nonexistent'));
    expect(hint).toMatch(/synchronous/i);
    expect(hint).toContain('add_to_track');
    expect(hint).toContain('as_still:true');
  });

  it('no longer teaches that search results can go straight on the timeline', () => {
    const search = CATEGORY_USAGE_HINTS[CATEGORY_IDS.SEARCH_TOOLS];
    expect(search).not.toMatch(/place them directly on the timeline/);
    expect(search).toContain('image_to_video');
  });
});

describe('L0 cost', () => {
  it('moves image_to_video out of the resident toolkit', () => {
    expect(CORE_TOOLKIT_TOOL_NAMES).toHaveLength(18);
    expect(CORE_TOOLKIT_TOOL_NAMES).not.toContain('image_to_video');
    expect(CORE_TOOLKIT_TOOL_NAMES).not.toContain('batch_image_to_video');
    expect(prompt).not.toContain('### image_to_video');
    expect(prompt).not.toContain('### batch_image_to_video');
  });

  it('states the rule once, right after the fabricated-id rule', () => {
    expect(prompt.split('图片先成片再上轨').length - 1).toBe(1);
    expect(prompt.indexOf('图片先成片再上轨')).toBeGreaterThan(prompt.indexOf('严禁编造素材 ID'));
    expect(prompt).toContain('as_still:true');
  });

  it('lists still_tools in the on-demand catalog', () => {
    expect(prompt).toContain('- still_tools:');
  });

  it('keeps every catalog row alive under the catalog byte cap', () => {
    for (const id of ON_DEMAND_CATEGORY_IDS) expect(prompt).toContain(`- ${id}:`);
  });
});

describe('activation (AC-13)', () => {
  const tools = () => new ToolActivationState(registry, []);

  it('refuses the converters before explore_tools loads them', () => {
    const state = tools();
    expect(state.canExecute('image_to_video')).toBe(false);
    expect(state.canExecute('batch_image_to_video')).toBe(false);
  });

  it('offers both on the next request after loading the category', () => {
    const state = tools();
    state.load(CATEGORY_IDS.STILL_TOOLS, ['image_to_video', 'batch_image_to_video']);
    expect(state.offer().map(tool => tool.name))
      .toEqual(expect.arrayContaining(['image_to_video', 'batch_image_to_video']));
    expect(state.canExecute('image_to_video')).toBe(true);
    expect(state.canExecute('batch_image_to_video')).toBe(true);
  });

  it('rejects an unknown tool name in the category', () => {
    expect(() => tools().load(CATEGORY_IDS.STILL_TOOLS, ['image_to_audio'])).toThrow();
  });
});
