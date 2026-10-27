// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeWebTool } from '../../tools/webToolAdapter';
import type { ToolSideEvent } from '../../types';
import type { CrewMember, CrewMemberInput } from '../createCrewMember';
import type { CrewTaskInput, MemberOutcome, VerifiedReport } from '../crewTypes';
import {
  CrewError, MAX_CREW_CALLS, runCrew, type CrewDeps,
} from '../runCrew';
import { TASK_BYTE_LIMIT, RESULT_BYTE_LIMIT } from '../verifyReport';
import {
  goodReport, hangUntilAborted, jsonResponse, makeContext, scriptedModel, searchCall, searchPayload,
  SEEN_ID, stubFetch, submitCall, type ModelStep,
} from './crewTestKit';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const task = (id: string, extra: Partial<CrewTaskInput> = {}): CrewTaskInput =>
  ({ id, goal: `goal of ${id}`, deliverable: 'candidates', ...extra });
const usage = { model_calls: 2, tool_calls: 1, elapsed_ms: 10 };
const emptyReport: VerifiedReport = { summary: 'ok', candidates: [], sources: [], gaps: [], dropped_unverified: 0 };
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

/** A member seam that records its input and answers with a canned outcome. */
function fakeMembers(outcomeFor: (input: CrewMemberInput) => MemberOutcome | Promise<MemberOutcome> = () =>
  ({ status: 'done', report: emptyReport, usage })) {
  const inputs: CrewMemberInput[] = [];
  let active = 0;
  let peak = 0;
  const createMember = (input: CrewMemberInput): CrewMember => ({
    run: async () => {
      inputs.push(input);
      active += 1;
      peak = Math.max(peak, active);
      try { await tick(); return await outcomeFor(input); } finally { active -= 1; }
    },
  });
  return { createMember, inputs, peak: () => peak };
}

const fastModelBody = { success: true, api_url: 'https://fast.example/v1', api_key: 'fast-key',
  model_name: 'fast-model', provider_type: 'openai', api_type: 'openai' };
const resolveRoute = (path: string) => path.startsWith('/api/model-settings/resolve/fast');

function stubModels(body: unknown = fastModelBody, status = 200) {
  return stubFetch(path => resolveRoute(path) ? jsonResponse(body, status) : jsonResponse({ success: true, data: {} }));
}

const kinds = (events: ToolSideEvent[]) => events.map(event => event.type);

describe('runCrew orchestration', () => {
  it('runs three tasks in parallel with ordered events and throttled progress (AC-B3)', async () => {
    const ctx = makeContext();
    stubFetch(path => resolveRoute(path) ? jsonResponse({ success: false }) : jsonResponse(searchPayload()));
    const script: Record<string, ModelStep[]> = Object.fromEntries(['a-1', 'b-2', 'c-3'].map(id =>
      [id, [{ calls: [searchCall(id)] }, { calls: [submitCall(goodReport())] }]]));
    const model = scriptedModel(script);

    const payload = await runCrew(ctx.context, 'parent-call', [task('a-1'), task('b-2'), task('c-3')],
      { memberDeps: { streamModel: model.streamModel } });

    expect(payload.tasks.map(item => item.status)).toEqual(['done', 'done', 'done']);
    expect(payload.model_tier).toBe('main');
    const order = kinds(ctx.events);
    expect(order[0]).toBe('crew_start');
    expect(order[order.length - 1]).toBe('crew_end');
    expect(order.lastIndexOf('crew_start')).toBe(0);
    for (const id of ['a-1', 'b-2', 'c-3']) {
      const mine = ctx.events.filter(event => event.type === 'crew_member' && event.memberId === id);
      expect(mine.filter(event => event.type === 'crew_member' && event.state === 'running').length)
        .toBeLessThanOrEqual(2);
      expect(mine.map(event => event.type === 'crew_member' ? event.state : '')[0]).toBe('queued');
      expect(mine[mine.length - 1]).toMatchObject({ state: 'done' });
    }
    expect(ctx.events[ctx.events.length - 1]).toMatchObject({ type: 'crew_end', ready: 3, failed: 0, candidates: 3 });
  });

  it('lets only one running update through per interval, and every state change', async () => {
    const ctx = makeContext();
    stubModels();
    let clock = 0;
    const members = fakeMembers(input => {
      for (const at of [0, 100, 499, 600]) { clock = at; input.onProgress?.({ activity: `step ${at}`,
        toolCalls: 1, modelCalls: 1, elapsedMs: at }); }
      return { status: 'done', report: emptyReport, usage };
    });
    await runCrew(ctx.context, 'p', [task('only-one')], { createMember: members.createMember, now: () => clock });
    const running = ctx.events.filter(event => event.type === 'crew_member' && event.state === 'running');
    expect(running.map(event => event.type === 'crew_member' ? event.activity : '')).toEqual(['step 0', 'step 600']);
    expect(ctx.events.filter(event => event.type === 'crew_member' && event.state === 'done')).toHaveLength(1);
  });

  it.each([
    ['default', undefined, 3, 3],
    ['maxParallel 2', { maxParallel: 2 }, 3, 2],
    ['global concurrency 1', undefined, 1, 1],
  ])('bounds member concurrency: %s', async (_name, settings, globalConcurrency, expectedPeak) => {
    const ctx = makeContext({ settings, globalConcurrency });
    stubModels();
    const members = fakeMembers();
    await runCrew(ctx.context, 'p', ['a-1', 'b-2', 'c-3', 'd-4'].map(id => task(id)),
      { createMember: members.createMember });
    expect(members.peak()).toBe(expectedPeak);
    expect(members.inputs).toHaveLength(4);
  });

  it('isolates a failing member from the others (AC-B5)', async () => {
    const ctx = makeContext();
    stubModels();
    const members = fakeMembers(input => {
      if (input.task.id === 'bad-one') throw new Error('kaboom');
      if (input.task.id === 'late-one') return { status: 'failed', error_code: 'provider_auth', usage };
      return { status: 'done', report: emptyReport, usage };
    });
    const payload = await runCrew(ctx.context, 'p', [task('good-one'), task('bad-one'), task('late-one')],
      { createMember: members.createMember });
    expect(payload.tasks.map(item => item.status)).toEqual(['done', 'failed', 'failed']);
    expect(payload.tasks[1].error_code).toBe('member_error');
    expect(payload.tasks[2].error_code).toBe('provider_auth');
    expect(ctx.events[ctx.events.length - 1]).toMatchObject({ type: 'crew_end', ready: 1, failed: 2 });
  });

  it('shares the parent research run and its candidates stay downloadable (AC-B12)', async () => {
    const ctx = makeContext();
    const issued = new Set<string>();
    stubFetch((path, init) => {
      const run = new Headers(init?.headers).get('X-Test-Run');
      if (resolveRoute(path)) return jsonResponse({ success: false });
      if (path.startsWith('/api/web-research/search')) {
        issued.add(`${run}:${SEEN_ID}`);
        return jsonResponse(searchPayload());
      }
      const body = JSON.parse(String(init?.body));
      return issued.has(`${run}:${body.candidate_id}`)
        ? jsonResponse({ success: true, data: { status: 'ready', material: { id: 'm1', name: 'Night', type: 'image',
          format: 'png', size: 1, created_at: '2026-10-27',
          local_url: '/api/storage/files/cached_materials/web/night.png' } } })
        : jsonResponse({ success: false, error_code: 'candidate_not_found' }, 404);
    });
    const model = scriptedModel([{ calls: [searchCall()] }, { calls: [submitCall(goodReport())] }]);

    const payload = await runCrew(ctx.context, 'p', [task('shot-1')], { memberDeps: { streamModel: model.streamModel } });
    const candidateId = payload.tasks[0].candidates[0].candidate_id;
    const download = await executeWebTool(ctx.context, 'parent-download', { path: '/download',
      body: { candidate_id: candidateId, kind: 'image' }, importMaterial: 'record' });

    expect(candidateId).toBe(SEEN_ID);
    expect(download.details).toMatchObject({ success: true });
    expect(ctx.context.materials).toHaveLength(1);
    // One client served both: member and parent call ids went through the same run.
    expect(ctx.run.headerCalls.some(id => id.startsWith('crew-'))).toBe(true);
    expect(ctx.run.headerCalls).toContain('parent-download');
  });
});

describe('runCrew stop and timeout', () => {
  it('cancels a hanging member within a second and keeps a submitted report (AC-B6)', async () => {
    const ctx = makeContext();
    stubFetch(path => resolveRoute(path) ? jsonResponse({ success: false }) : jsonResponse(searchPayload()));
    const model = scriptedModel({
      'fast-one': [{ calls: [searchCall()] }, { calls: [submitCall(goodReport())] }],
      'slow-one': ['hang'],
    });
    const begun = Date.now();
    const running = runCrew(ctx.context, 'p', [task('fast-one'), task('slow-one')],
      { memberDeps: { streamModel: model.streamModel } });
    setTimeout(() => ctx.stop.abort(), 80);

    const payload = await running;

    expect(Date.now() - begun).toBeLessThan(1000);
    expect(payload.tasks.map(item => item.status)).toEqual(['done', 'cancelled']);
    expect(payload.tasks[0].candidates).toHaveLength(1);
    expect(ctx.events[ctx.events.length - 1]).toMatchObject({ type: 'crew_end', ready: 1, failed: 1 });
  });

  it('never starts a queued member once the parent has stopped', async () => {
    const ctx = makeContext({ settings: { maxParallel: 1 } });
    stubModels({ success: false });
    const model = scriptedModel({ 'slow-one': ['hang'], 'queued-one': ['hang'] });
    const running = runCrew(ctx.context, 'p', [task('slow-one'), task('queued-one')],
      { memberDeps: { streamModel: model.streamModel } });
    setTimeout(() => ctx.stop.abort(), 30);

    const payload = await running;

    expect(payload.tasks.map(item => item.status)).toEqual(['cancelled', 'cancelled']);
    expect(model.calls['queued-one']).toBeUndefined();
  });

  it('times out one slow member without touching the others or the run (AC-B14)', async () => {
    vi.useFakeTimers();
    const ctx = makeContext();
    stubFetch((path, init) => {
      if (resolveRoute(path)) return jsonResponse({ success: false });
      return String(init?.body).includes('slow') ? hangUntilAborted(init) : jsonResponse(searchPayload());
    });
    const model = scriptedModel({
      'slow-one': [{ calls: [searchCall('slow query')] }],
      'quick-one': [{ calls: [searchCall('quick query')] }, { calls: [submitCall(goodReport())] }],
    });
    const running = runCrew(ctx.context, 'p', [task('slow-one'), task('quick-one')],
      { memberDeps: { streamModel: model.streamModel } });

    await vi.advanceTimersByTimeAsync(90_000);
    const payload = await running;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(payload.tasks.map(item => item.status)).toEqual(['timeout', 'done']);
    expect(ctx.run.cancelCall).toHaveBeenCalledTimes(1);
    expect(ctx.run.cancelCall.mock.calls[0][0]).toMatch(/^crew-.{8}-0-1$/);
    expect(ctx.run.controller.signal.aborted).toBe(false);
    expect(ctx.stop.signal.aborted).toBe(false);
  });

  it('uses the configured per-member timeout', async () => {
    const ctx = makeContext({ settings: { memberTimeoutSeconds: 45 } });
    stubModels();
    const members = fakeMembers();
    await runCrew(ctx.context, 'p', [task('one-task')], { createMember: members.createMember });
    expect(members.inputs[0].timeoutMs).toBe(45_000);
  });
});

describe('runCrew budgets (AC-B7)', () => {
  it('accumulates the turn counters and refuses after three delegations', async () => {
    const ctx = makeContext();
    stubModels();
    const members = fakeMembers();
    const deps: CrewDeps = { createMember: members.createMember };
    for (let call = 0; call < MAX_CREW_CALLS; call++) await runCrew(ctx.context, 'p', [task('one-task')], deps);

    expect(ctx.context.turnState.crew).toEqual({ crewCalls: 3, crewToolCalls: 3, crewModelCalls: 6 });
    await expect(runCrew(ctx.context, 'p', [task('one-task')], deps)).rejects.toMatchObject(
      { name: 'CrewError', code: 'crew_budget_exhausted' });

    // A re-run of the turn builds fresh state, so the budget starts over.
    const rerun = makeContext();
    await expect(runCrew(rerun.context, 'p', [task('one-task')], deps)).resolves.toBeDefined();
  });

  it.each([
    ['tool calls', { crewCalls: 1, crewToolCalls: 36, crewModelCalls: 0 }],
    ['model calls', { crewCalls: 1, crewToolCalls: 0, crewModelCalls: 60 }],
  ])('refuses once the turn-wide %s are spent', async (_name, crew) => {
    const ctx = makeContext();
    ctx.context.turnState.crew = crew;
    const members = fakeMembers();
    await expect(runCrew(ctx.context, 'p', [task('one-task')], { createMember: members.createMember }))
      .rejects.toBeInstanceOf(CrewError);
    expect(members.inputs).toHaveLength(0);
  });

  it('runs fewer tasks when the research run is short of call ids, and says so', async () => {
    const ctx = makeContext();
    ctx.context.callBudget.used = 45;
    stubModels();
    const members = fakeMembers();
    const payload = await runCrew(ctx.context, 'p', ['a-1', 'b-2', 'c-3', 'd-4'].map(id => task(id)),
      { createMember: members.createMember });
    expect(members.inputs.map(input => input.task.id)).toEqual(['a-1', 'b-2']);
    expect(payload.tasks.map(item => item.status)).toEqual(['done', 'done', 'failed', 'failed']);
    expect(payload.tasks[3].error_code).toBe('research_budget_exhausted');
    expect(payload.next_step).toContain('Only 2 of 4 tasks ran');
  });

  it('refuses outright when fewer than ten call ids remain', async () => {
    const ctx = makeContext();
    ctx.context.callBudget.used = 61;
    const members = fakeMembers();
    await expect(runCrew(ctx.context, 'p', [task('one-task')], { createMember: members.createMember }))
      .rejects.toMatchObject({ code: 'crew_budget_exhausted' });
    expect(members.inputs).toHaveLength(0);
  });
});

describe('runCrew model resolution (AC-B9)', () => {
  const resolveCalls = (fetcher: ReturnType<typeof stubFetch>) =>
    fetcher.mock.calls.filter(call => String(call[0]).includes('/resolve/fast')).length;

  it('uses the fast tier when resolve/fast answers, and resolves once per turn', async () => {
    const ctx = makeContext();
    const fetcher = stubModels();
    const members = fakeMembers();
    const first = await runCrew(ctx.context, 'p', [task('one-task')], { createMember: members.createMember });
    const second = await runCrew(ctx.context, 'p', [task('two-task')], { createMember: members.createMember });

    expect(first.model_tier).toBe('fast');
    expect(second.model_tier).toBe('fast');
    expect(resolveCalls(fetcher)).toBe(1);
    expect(members.inputs[0].model).toMatchObject({ model: 'fast-model', apiKey: 'fast-key', apiType: 'openai' });
    expect(ctx.context.turnState.crewModelTier).toBe('fast');
    expect(ctx.events.find(event => event.type === 'crew_start')).toMatchObject({ modelTier: 'fast' });
  });

  it.each([
    ['success false', () => stubModels({ success: false })],
    ['http 500', () => stubModels({ success: false }, 500)],
    ['missing key', () => stubModels({ ...fastModelBody, api_key: '' })],
    ['network failure', () => stubFetch(() => { throw new TypeError('offline'); })],
  ])('falls back to the main model: %s', async (_name, arrange) => {
    const ctx = makeContext();
    const fetcher = arrange();
    const members = fakeMembers();
    const payload = await runCrew(ctx.context, 'p', [task('one-task')], { createMember: members.createMember });
    expect(payload.model_tier).toBe('main');
    expect(members.inputs[0].model.model).toBe('main-model');
    await runCrew(ctx.context, 'p', [task('two-task')], { createMember: members.createMember });
    expect(resolveCalls(fetcher)).toBe(1);
  });

  it('is unavailable when neither the fast nor the main model can be resolved', async () => {
    const ctx = makeContext({ withMain: false });
    stubModels({ success: false });
    const members = fakeMembers();
    await expect(runCrew(ctx.context, 'p', [task('one-task')], { createMember: members.createMember }))
      .rejects.toMatchObject({ code: 'crew_unavailable' });
    expect(members.inputs).toHaveLength(0);
  });
});

describe('runCrew result size (AC-B10)', () => {
  it('bounds four six-candidate tasks of 4-byte text to 2.6 KiB each and 11 KiB total', async () => {
    const ctx = makeContext();
    stubModels();
    const wide = String.fromCodePoint(0x1f600);
    const report: VerifiedReport = { summary: `概要${wide}`.repeat(150), gaps: ['gap'], sources: [],
      dropped_unverified: 0, candidates: Array.from({ length: 6 }, (_, i) => ({ url: `https://s.example/${i}`,
        kind: 'video' as const, title: `标题${wide}`.repeat(13), why: `理由${wide}`.repeat(25),
        candidate_id: SEEN_ID })) };
    const members = fakeMembers(() => ({ status: 'done', report, usage }));
    const payload = await runCrew(ctx.context, 'p', ['a-1', 'b-2', 'c-3', 'd-4'].map(id => task(id)),
      { createMember: members.createMember });

    expect(payload.truncated).toBe(true);
    for (const item of payload.tasks) expect(bytes(item)).toBeLessThanOrEqual(TASK_BYTE_LIMIT);
    expect(bytes(payload)).toBeLessThanOrEqual(RESULT_BYTE_LIMIT);
    expect(payload.tasks[0].candidates[0].url).toBe('https://s.example/0');
  });
});

describe('runCrew events', () => {
  it('survives a broken event sink and keeps goals bounded', async () => {
    const ctx = makeContext();
    ctx.context.emit = () => { throw new Error('sink down'); };
    stubModels();
    const members = fakeMembers();
    const payload = await runCrew(ctx.context, 'p', [task('one-task', { goal: 'g'.repeat(400) })],
      { createMember: members.createMember });
    expect(payload.tasks[0].status).toBe('done');
  });

  it('announces every member, including ones that will not run', async () => {
    const ctx = makeContext();
    ctx.context.callBudget.used = 55;
    stubModels();
    const members = fakeMembers();
    await runCrew(ctx.context, 'call-9', [task('a-1'), task('b-2')], { createMember: members.createMember });
    expect(ctx.events[0]).toMatchObject({ type: 'crew_start', toolCallId: 'call-9',
      members: [{ id: 'a-1' }, { id: 'b-2' }] });
    expect(members.inputs.map(input => input.task.id)).toEqual(['a-1']);
  });
});
