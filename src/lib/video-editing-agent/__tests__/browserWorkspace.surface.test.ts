// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillIndexEntry } from '@/types/agentSkills';
import { buildSystemPrompt, categoryAvailability, formatToolOverview } from '../systemPrompt';
import { buildAllAgentTools, createToolRegistry } from '../tools';
import { ToolActivationState } from '../registry/ToolActivationState';
import { createDefaultCategories } from '../registry/categories';
import { BROWSER_RULE, BROWSER_RULE_YOLO, BROWSER_WORKSPACE_GUIDANCE,
  getCategoryUsageHints } from '../promptParts';
import { deriveMemberContext } from '../crew/crewTools';
import { isResearchTool, sanitizeResearchValue } from '../researchEventSanitizer';
import type { ToolContext, WebCapabilitySnapshot } from '../types';

const toolFetch = vi.hoisted(() => vi.fn());
vi.mock('../tools/apiHelper', () => ({ toolFetch }));

/**
 * agent-browser-workspace spec §8.2: prompt budget (AC-E1..E5), tool timeouts
 * (AC-A13, frontend half), routing headers (AC-A8) and YOLO removal (AC-A6).
 */
const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
const SID = '123e4567-e89b-42d3-a456-426614174000';

function makeContext(extra: Partial<ToolContext> = {}): ToolContext {
  const timelineState = { currentTime: 0, totalDuration: 0, zoomLevel: 1, selectedItems: [],
    tracks: [], playbackRate: 1, isPlaying: false, snapToGrid: false, gridSize: 0.1, scrollLeft: 0 };
  return { timelineState, materials: [], apiBaseUrl: 'http://127.0.0.1:3000',
    operations: new Map(), updateTimeline: () => ({ applied: true as const }),
    recordOperation: () => undefined, turnState: {}, callBudget: { used: 0 }, ...extra } as ToolContext;
}

function promptOf(autonomy?: 'yolo', skillIndex?: SkillIndexEntry[]) {
  const context = makeContext({ autonomy });
  return buildSystemPrompt({ skillIndex, timelineState: context.timelineState, materials: [],
    registry: createToolRegistry(context), exploredCategories: [], autonomy });
}

const MAX_INDEX = Array.from({ length: 10 }, (_, index): SkillIndexEntry => ({
  id: `skill-${index}-${'x'.repeat(30)}`.slice(0, 40), name: 'n', description: '描'.repeat(60),
  requires: ['web'], builtin: index < 6 }));

describe('L0 browser rule and budget (AC-E1/E2)', () => {
  it('keeps the rule at or under 132 chars and names the required semantics', () => {
    expect(BROWSER_RULE.length).toBeLessThanOrEqual(132);
    expect(BROWSER_RULE_YOLO.length).toBeLessThanOrEqual(132);
    for (const word of ['实时', '真实图片', '浏览器', '来源与抓取时间', '禁用 AI 图冒充', '不索取口令']) {
      expect(BROWSER_RULE).toContain(word);
    }
    expect(promptOf()).toContain(BROWSER_RULE);
  });

  it('does not grow the worst-case prompt beyond the pre-change measurement', () => {
    // Measured on HEAD 0c4744be BEFORE this change: 18 593 without a skill index,
    // 19 690 with 10 full-length entries (already over the older 18 500 pins in
    // AC-B8 / D-18 because of the effects work). The rule is paid for by
    // compressing existing L0 text in the same change (spec R1-2), so both shrink.
    expect(promptOf().length).toBeLessThanOrEqual(18_500);
    expect(promptOf(undefined, MAX_INDEX).length).toBeLessThanOrEqual(19_690 - 100);
  });
});

describe('YOLO (AC-A6 / AC-E5)', () => {
  it('never mentions browser_request_user in the YOLO L0 prompt', () => {
    expect(promptOf('yolo')).not.toContain('browser_request_user');
    expect(promptOf('yolo')).toContain(BROWSER_RULE_YOLO);
    expect(promptOf()).toContain('browser_request_user');
  });

  it('does not register the tool in YOLO, so explore_tools cannot list it', () => {
    const registry = createToolRegistry(makeContext({ autonomy: 'yolo' }));
    expect(registry.getCategoryTools('browser_tools').map(tool => tool.name))
      .not.toContain('browser_request_user');
  });
});

describe('catalog and usage hints (AC-E3/E4)', () => {
  it('keeps the browser_tools description within 100 bytes and its catalog line within 160', () => {
    const category = createDefaultCategories().find(item => item.id === 'browser_tools')!;
    expect(bytes(category.description)).toBeLessThanOrEqual(100);
    const summary = createToolRegistry(makeContext()).getCategorySummaries()
      .filter(item => item.id === 'browser_tools');
    const line = formatToolOverview(summary, { browser_tools: { available: true, mode: 'workspace' } })
      .split('\n').find(row => row.includes('browser_tools'))!;
    expect(bytes(line)).toBeLessThanOrEqual(160);
    expect(line).toContain('[workspace]');
  });

  it('keeps BROWSER_WORKSPACE_GUIDANCE within 1200 bytes', () => {
    expect(bytes(BROWSER_WORKSPACE_GUIDANCE)).toBeLessThanOrEqual(1200);
    expect(getCategoryUsageHints('browser_tools')).toBe(BROWSER_WORKSPACE_GUIDANCE);
  });

  it('returns the whole guidance from explore_tools(browser_tools)', async () => {
    const registry = createToolRegistry(makeContext());
    const state = new ToolActivationState(registry, ['explore_tools']);
    state.offer();
    const explore = buildAllAgentTools(registry, state).find(tool => tool.name === 'explore_tools')!;
    const details = (await explore.execute('e1', { category: 'browser_tools' })).details as
      { usage_hints: string; loaded: string[] };
    expect(details.usage_hints).toBe(BROWSER_WORKSPACE_GUIDANCE);
    // explore_tools loads at most 4 tools per call; browser_save_image (5th)
    // and browser_request_user (6th) are therefore named in the hint instead.
    expect(details.loaded).toHaveLength(4);
    expect(details.usage_hints)
      .toContain('tool_names:[browser_save_image,browser_request_user]');
    const second = (await explore.execute('e2', { category: 'browser_tools',
      tool_names: ['browser_request_user'] })).details as { loaded: string[] };
    expect(second.loaded).toContain('browser_request_user');
  });

  it('tags the catalog with the real mode only when the workspace segment is reported', () => {
    const base = { search: { available: true }, downloads: { available: true },
      browser: { available: true } } as WebCapabilitySnapshot;
    expect(categoryAvailability(base).browser_tools?.mode).toBeUndefined();
    const workspace = { ...base, workspace_browser: { available: true, enabled: true, mode: 'workspace' as const } };
    expect(categoryAvailability(workspace).browser_tools?.mode).toBe('workspace');
    const isolated = { ...base, workspace_browser: { available: false } };
    expect(categoryAvailability(isolated).browser_tools?.mode).toBe('isolated');
    const off = { ...base, browser: { available: false }, workspace_browser: { available: false } };
    expect(categoryAvailability(off).browser_tools?.available).toBe(false);
  });
});

describe('call timeouts and routing headers (AC-A13 frontend half, AC-A8)', () => {
  beforeEach(() => {
    toolFetch.mockReset();
    toolFetch.mockImplementation(async () => Response.json({ success: true, data: { ok: 1 } }));
  });
  const withRun = (extra: Partial<ToolContext> = {}) => makeContext({ researchRun: {
    lostReason: null, markLost: vi.fn(), headers: async () => ({ 'x-research-run': 'r' }),
    cancelCall: vi.fn(), controller: new AbortController() } as never, ...extra });
  const call = async (context: ToolContext, name: string, params: Record<string, unknown>) => {
    await createToolRegistry(context).getTool(name)!.execute(`c-${name}`, params as never);
    return toolFetch.mock.calls[toolFetch.mock.calls.length - 1]![2] as { timeout: number; headers: Record<string, string> };
  };

  it('waits 140 s for calls that can block on a human, 15 s / 5 s for read / close', async () => {
    const context = withRun();
    expect((await call(context, 'browser_open', { url: 'https://a.com' })).timeout).toBe(140_000);
    expect((await call(context, 'browser_act', { session_id: SID, snapshot_version: 1,
      action: 'click', element_ref: 'e1' })).timeout).toBe(140_000);
    expect((await call(context, 'browser_request_user', { reason: 'login', kind: 'login' })).timeout)
      .toBe(140_000);
    expect((await call(context, 'browser_read', { session_id: SID })).timeout).toBe(15_000);
    expect((await call(context, 'browser_close', { session_id: SID })).timeout).toBe(5_000);
  });

  it('sends x-browser-mode / x-agent-autonomy on browser calls only', async () => {
    const context = withRun({ browserMode: 'isolated', autonomy: 'yolo' });
    const open = await call(context, 'browser_open', { url: 'https://a.com' });
    expect(open.headers).toMatchObject({ 'x-research-run': 'r', 'x-browser-mode': 'isolated',
      'x-agent-autonomy': 'yolo' });
    const fetched = await call(context, 'web_fetch', { url: 'https://a.com' });
    expect(fetched.headers).not.toHaveProperty('x-browser-mode');
  });

  it('defaults to interactive and omits the mode header when unset', async () => {
    const { headers } = await call(withRun(), 'browser_open', { url: 'https://a.com' });
    expect(headers['x-agent-autonomy']).toBe('interactive');
    expect(headers).not.toHaveProperty('x-browser-mode');
  });

  it('forces research-crew members onto the isolated browser (AC-A8)', () => {
    const derived = deriveMemberContext(makeContext(), new AbortController().signal);
    expect(derived.browserMode).toBe('isolated');
  });
});

describe('result sanitising', () => {
  it('treats browser_request_user as a research tool and strips signed URLs from it', () => {
    expect(isResearchTool('browser_request_user')).toBe(true);
    const cleaned = sanitizeResearchValue({ status: 'completed',
      url: 'https://a.com/x?token=SECRET_TOK&q=1', run_token: 'RUN' });
    expect(JSON.stringify(cleaned)).not.toMatch(/SECRET_TOK|"RUN"/);
    expect(JSON.stringify(cleaned)).toContain('q=1');
  });
});
