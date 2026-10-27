// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrewMember } from '../../crew/createCrewMember';
import type { MemberOutcome, VerifiedReport } from '../../crew/crewTypes';
import type { CrewDeps } from '../../crew/runCrew';
import { goodReport, jsonResponse, makeContext, scriptedModel, searchCall, searchPayload, stubFetch, submitCall }
  from '../../crew/__tests__/crewTestKit';
import { createDelegateResearchTools } from '../delegateResearch';

afterEach(() => vi.unstubAllGlobals());

const NEXT_STEP = 'Search sequentially with web_search / web_fetch.';
const usage = { model_calls: 2, tool_calls: 1, elapsed_ms: 10 };
const report: VerifiedReport = { summary: 'ok', candidates: [], sources: [], gaps: [], dropped_unverified: 0 };
const okTask = { id: 'shot-1', goal: 'vertical night city', deliverable: 'candidates' };

function counted(outcome: MemberOutcome = { status: 'done', report, usage }) {
  const created = vi.fn();
  const deps: CrewDeps = { createMember: (input): CrewMember => {
    created(input);
    return { run: async () => outcome };
  } };
  return { deps, created };
}

async function call(context: ReturnType<typeof makeContext>['context'], params: unknown, deps: CrewDeps = {}) {
  const [tool] = createDelegateResearchTools(context, deps);
  const result = await tool.execute('parent-call', params as never);
  return { details: result.details as Record<string, unknown>, text: (result.content[0] as { text: string }).text };
}

describe('delegate_research contract', () => {
  it('is named delegate_research, closed to extra properties, and warns about untrusted excerpts', () => {
    const [tool] = createDelegateResearchTools(makeContext().context);
    expect(tool.name).toBe('delegate_research');
    expect(tool.parameters).toMatchObject({ additionalProperties: false });
    const task = (tool.parameters.properties as Record<string, { items: { additionalProperties: boolean } }>).tasks.items;
    expect(task.additionalProperties).toBe(false);
    expect(tool.description).toMatch(/untrusted/i);
    expect(tool.description).toContain('acquire_web_materials');
  });

  it('returns the validated tasks with the model tier and a next step', async () => {
    stubFetch(path => path.includes('/resolve/fast') ? jsonResponse({ success: false }) : jsonResponse({ success: true }));
    const { context } = makeContext();
    const { deps } = counted();
    const { details } = await call(context, { tasks: [okTask] }, deps);
    expect(details).toMatchObject({ success: true, model_tier: 'main' });
    expect((details.tasks as unknown[])).toHaveLength(1);
    expect(details.next_step).toContain('acquire_web_materials');
  });

  it('runs a real member end to end and keeps the result under the 12 KiB tool cap', async () => {
    stubFetch(path => path.includes('/resolve/fast') ? jsonResponse({ success: false }) : jsonResponse(searchPayload()));
    const { context } = makeContext();
    const model = scriptedModel([{ calls: [searchCall()] }, { calls: [submitCall(goodReport())] }]);
    const { details, text } = await call(context, { tasks: [okTask] },
      { memberDeps: { streamModel: model.streamModel } });
    expect(details).toMatchObject({ success: true });
    expect((details.tasks as Array<{ candidates: unknown[] }>)[0].candidates).toHaveLength(1);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(12 * 1024);
  });
});

describe('delegate_research whole-call errors (AC-B8)', () => {
  function expectNoWork(fetcher: ReturnType<typeof stubFetch>, created: ReturnType<typeof vi.fn>) {
    expect(fetcher).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  }

  it('crew_disabled when the setting is off', async () => {
    const fetcher = stubFetch(() => jsonResponse({}));
    const { context } = makeContext({ settings: { enabled: false } });
    const { deps, created } = counted();
    const { details } = await call(context, { tasks: [okTask] }, deps);
    expect(details).toMatchObject({ success: false, error_code: 'crew_disabled', next_step: NEXT_STEP });
    expectNoWork(fetcher, created);
  });

  it.each([
    ['no research run', () => makeContext({ withRun: false })],
    ['a lost research run', () => { const ctx = makeContext(); ctx.run.markLost('run_closed'); return ctx; }],
  ])('crew_unavailable with %s', async (_name, build) => {
    const fetcher = stubFetch(() => jsonResponse({}));
    const { context } = build();
    const { deps, created } = counted();
    const { details } = await call(context, { tasks: [okTask] }, deps);
    expect(details).toMatchObject({ success: false, error_code: 'crew_unavailable', next_step: NEXT_STEP });
    expectNoWork(fetcher, created);
  });

  it('crew_unavailable when no model can be resolved', async () => {
    stubFetch(() => jsonResponse({ success: false }));
    const { context } = makeContext({ withMain: false });
    const { deps, created } = counted();
    const { details } = await call(context, { tasks: [okTask] }, deps);
    expect(details).toMatchObject({ error_code: 'crew_unavailable', next_step: NEXT_STEP });
    expect(created).not.toHaveBeenCalled();
  });

  it.each([
    ['no tasks', { tasks: [] }],
    ['five tasks', { tasks: ['a-1', 'b-2', 'c-3', 'd-4', 'e-5'].map(id => ({ ...okTask, id })) }],
    ['a missing tasks field', {}],
    ['an id with capitals', { tasks: [{ ...okTask, id: 'Shot-1' }] }],
    ['a one-letter id', { tasks: [{ ...okTask, id: 'a' }] }],
    ['a duplicate id', { tasks: [okTask, okTask] }],
    ['an empty goal', { tasks: [{ ...okTask, goal: '  ' }] }],
    ['an overlong goal', { tasks: [{ ...okTask, goal: 'g'.repeat(401) }] }],
    ['an unknown deliverable', { tasks: [{ ...okTask, deliverable: 'everything' }] }],
    ['an unknown kind', { tasks: [{ ...okTask, kind: 'document' }] }],
    ['max_candidates 7', { tasks: [{ ...okTask, max_candidates: 7 }] }],
    ['four hints', { tasks: [{ ...okTask, hints: ['a', 'b', 'c', 'd'] }] }],
    ['a non-object task', { tasks: ['find stuff'] }],
  ])('invalid_arguments for %s, with zero network and zero model calls', async (_name, params) => {
    const fetcher = stubFetch(() => jsonResponse({}));
    const { context } = makeContext();
    const { deps, created } = counted();
    const { details } = await call(context, params, deps);
    expect(details).toMatchObject({ success: false, error_code: 'invalid_arguments', next_step: NEXT_STEP });
    expectNoWork(fetcher, created);
  });

  it('accepts every optional field at its limit', async () => {
    stubFetch(() => jsonResponse({ success: false }));
    const { context } = makeContext();
    const { deps } = counted();
    const { details } = await call(context, { tasks: [{ ...okTask, kind: 'video', max_candidates: 6,
      hints: ['a'.repeat(80), 'b', 'c'] }] }, deps);
    expect(details.success).toBe(true);
  });

  it('crew_budget_exhausted on the fourth delegation of a turn, and fresh again on a re-run', async () => {
    stubFetch(() => jsonResponse({ success: false }));
    const { context } = makeContext();
    const { deps, created } = counted();
    for (let index = 0; index < 3; index++) {
      expect((await call(context, { tasks: [okTask] }, deps)).details.success).toBe(true);
    }
    const fourth = await call(context, { tasks: [okTask] }, deps);
    expect(fourth.details).toMatchObject({ success: false, error_code: 'crew_budget_exhausted', next_step: NEXT_STEP });
    expect(created).toHaveBeenCalledTimes(3);

    const rerun = makeContext();
    expect((await call(rerun.context, { tasks: [okTask] }, deps)).details.success).toBe(true);
  });
});
