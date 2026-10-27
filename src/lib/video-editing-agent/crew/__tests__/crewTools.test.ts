// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeWebTool } from '../../tools/webToolAdapter';
import { createToolRegistry } from '../../tools/index';
import {
  CREW_TOOL_ALLOWLIST, createMemberTools, createSubmitReportTool, deriveMemberContext,
  describeActivity,
} from '../crewTools';
import { jsonResponse, makeContext, SEEN_ID, stubFetch } from './crewTestKit';

afterEach(() => vi.unstubAllGlobals());

const READ_ONLY_TOOLS = ['web_search', 'web_fetch', 'extract_web_images', 'read_research_artifact'];

describe('CREW_TOOL_ALLOWLIST (AC-B1)', () => {
  it('is exactly the five read-only research tools plus submit_report', () => {
    expect([...CREW_TOOL_ALLOWLIST].sort()).toEqual([...READ_ONLY_TOOLS, 'submit_report'].sort());
  });

  it('shares no name with any editing, material, generation, browser, download, ask, memory or workspace tool', () => {
    const registry = createToolRegistry(makeContext().context);
    const names = new Set<string>();
    for (const category of registry.getCategoryIds()) {
      for (const tool of registry.getCategoryTools(category)) names.add(tool.name);
    }
    const forbidden = Array.from(names).filter(name => !READ_ONLY_TOOLS.includes(name));
    expect(forbidden.length).toBeGreaterThan(20);
    expect(forbidden.filter(name => CREW_TOOL_ALLOWLIST.includes(name))).toEqual([]);
    for (const name of ['delegate_research', 'web_research', 'fetch_web_image', 'download_web_media',
      'acquire_web_materials', 'browser_open', 'ask_user', 'memory_write']) {
      expect(CREW_TOOL_ALLOWLIST).not.toContain(name);
    }
    expect(names.has('submit_report')).toBe(false);
  });

  it('builds a member toolset that is exactly the allowlist', () => {
    const { context } = makeContext();
    const tools = createMemberTools(deriveMemberContext(context, new AbortController().signal), () => undefined);
    expect(tools.map(tool => tool.name).sort()).toEqual([...CREW_TOOL_ALLOWLIST].sort());
  });
});

describe('deriveMemberContext', () => {
  it('refuses side effects with crew_forbidden_side_effect (AC-B2)', async () => {
    const { context } = makeContext();
    const derived = deriveMemberContext(context, new AbortController().signal);
    expect(() => derived.recordOperation('id', { type: 'add_materials', materials: [] }))
      .toThrow('crew_forbidden_side_effect');
    expect(() => derived.updateTimeline('id', {} as never)).toThrow('crew_forbidden_side_effect');

    // Even a download tool smuggled into a member cannot publish: the import
    // fails inside the adapter and nothing reaches the parent.
    stubFetch(() => jsonResponse({ success: true, data: { status: 'ready', material: { id: 'm',
      name: 'n', type: 'image', format: 'png', size: 1, created_at: '2026-10-27',
      local_url: '/api/storage/files/cached_materials/web/a.png' } } }));
    const result = await executeWebTool(derived, 'call', { path: '/download', body: {}, importMaterial: 'record' });
    expect(result.details).toMatchObject({ success: false });
    expect(context.recordOperation).not.toHaveBeenCalled();
    expect(context.materials).toHaveLength(0);
  });

  it('shares callBudget and researchRun by reference but isolates turnState (AC-B13)', () => {
    const { context, run } = makeContext();
    context.turnState.crewModelTier = 'fast';
    const derived = deriveMemberContext(context, new AbortController().signal);
    expect(Object.is(derived.callBudget, context.callBudget)).toBe(true);
    expect(derived.researchRun).toBe(run);
    expect(derived.turnState).toEqual({});
    expect(Object.is(derived.turnState, context.turnState)).toBe(false);
    derived.turnState.crew = { crewCalls: 9, crewToolCalls: 9, crewModelCalls: 9 };
    expect(context.turnState.crew).toBeUndefined();
    expect(derived.operations).not.toBe(context.operations);
  });

  it('gives each member its own signal and strips what would allow delegation', () => {
    const { context, stop } = makeContext();
    const member = new AbortController();
    const derived = deriveMemberContext(context, member.signal);
    expect(derived.abortSignal).toBe(member.signal);
    expect(derived.abortSignal).not.toBe(stop.signal);
    expect(derived.emit).toBeUndefined();
    expect(derived.crewRuntime).toBeUndefined();
    expect(derived.loadTools).toBeUndefined();
  });

  it('adds every member call id to the parent budget (AC-B13)', async () => {
    const { context } = makeContext();
    stubFetch(() => jsonResponse({ success: true, data: { results: [] } }));
    const perMember = 4;
    await Promise.all([0, 1, 2].map(async member => {
      const tools = createMemberTools(deriveMemberContext(context, new AbortController().signal), () => undefined);
      const search = tools.find(tool => tool.name === 'web_search')!;
      for (let call = 0; call < perMember; call++) {
        await search.execute(`ignored-${member}-${call}`, { query: `q${member}-${call}` });
      }
    }));
    expect(context.callBudget.used).toBe(3 * perMember);
  });
});

describe('submit_report tool', () => {
  it('hands the raw report to the closure and acknowledges it', async () => {
    let received: unknown;
    const tool = createSubmitReportTool(report => { received = report; });
    const result = await tool.execute('id', { summary: 's', candidates: [{ candidate_id: SEEN_ID, url: 'https://a.example', kind: 'video' }] } as never);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'report received' });
    expect(received).toMatchObject({ summary: 's' });
  });
});

describe('describeActivity (AC-B11)', () => {
  it('never exposes a full url or page text', () => {
    const url = 'https://user.example/private/path?token=abc#secret';
    expect(describeActivity('web_fetch', { url })).toBe('read:user.example');
    expect(describeActivity('extract_web_images', { url })).toBe('images:user.example');
    expect(describeActivity('web_search', { query: 'q'.repeat(100) })).toBe(`search:${'q'.repeat(40)}`);
    expect(describeActivity('web_fetch', { artifact_id: SEEN_ID })).toBe('read:archive');
    expect(describeActivity('submit_report', {})).toBe('report');
    expect(describeActivity('mystery', null)).toBe('work');
  });
});
