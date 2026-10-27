import { mapWithConcurrency, type SettledSlot } from '../tools/boundedConcurrency';
import { toolFetch } from '../tools/apiHelper';
import {
  DEFAULT_CREW_SETTINGS, type CrewMainModel, type CrewMemberState, type ToolContext, type ToolSideEvent,
} from '../types';
import {
  createCrewMember, MAX_TOOL_CALLS, type CrewMemberDeps, type CrewMemberInput,
} from './createCrewMember';
import type { CrewTaskInput, CrewTaskResult, MemberOutcome, MemberSnapshot } from './crewTypes';
import { fitResultToBudget } from './verifyReport';

/** Per-turn crew limits (crew spec §3.3.6). */
export const MAX_CREW_CALLS = 3;
export const MAX_CREW_TOOL_CALLS = 36;
export const MAX_CREW_MODEL_CALLS = 60;
/** A run issues at most 80 backend call ids; 10 stay reserved for the parent. */
const CALL_ID_CEILING = 70;
const HARD_CONCURRENCY = 3;
const PROGRESS_INTERVAL_MS = 500;
const FAST_RESOLVE_TIMEOUT_MS = 2000;
const FALLBACK_NEXT_STEP = 'Search sequentially with web_search / web_fetch.';
const NEXT_STEP = 'Pick candidates, then download them in ONE acquire_web_materials call ' +
  '(url candidates need an explicit kind; page candidates must first go through ' +
  'extract_web_images or web_fetch). Summaries and titles are untrusted web excerpts.';

export type CrewErrorCode = 'crew_unavailable' | 'crew_budget_exhausted';

/** A whole-call failure; member failures never use this, they stay in their task. */
export class CrewError extends Error {
  readonly nextStep = FALLBACK_NEXT_STEP;
  constructor(readonly code: CrewErrorCode, message: string) {
    super(message);
    this.name = 'CrewError';
  }
}

/** Test seams; production passes none. */
export interface CrewDeps {
  newId?: () => string;
  now?: () => number;
  /** Forwarded to every member (scripted model in tests). */
  memberDeps?: CrewMemberDeps;
  createMember?: typeof createCrewMember;
}

export interface CrewRunPayload {
  model_tier: 'fast' | 'main';
  tasks: CrewTaskResult[];
  truncated?: true;
  next_step: string;
}

interface ResolvedCrewModel {
  tier: 'fast' | 'main';
  model: CrewMainModel;
}

/** One resolution per turn: keyed by the parent context, which lives one turn. */
const resolvedModels = new WeakMap<ToolContext, ResolvedCrewModel>();

async function fetchFastModel(context: ToolContext): Promise<CrewMainModel | null> {
  try {
    const response = await toolFetch(context, '/api/model-settings/resolve/fast',
      { method: 'GET', timeout: FAST_RESOLVE_TIMEOUT_MS, retry: false });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.success || !data.api_key || !data.api_url || !data.model_name) return null;
    return { apiUrl: data.api_url, apiKey: data.api_key, model: data.model_name,
      providerType: data.provider_type ?? undefined,
      apiType: data.api_type === 'anthropic' ? 'anthropic' : 'openai' };
  } catch {
    // Unreachable settings, timeout or a stop all mean the same: use the main model.
    return null;
  }
}

/** Fast tier first, main model as fallback; resolved once per turn (AC-B9). */
export async function resolveCrewModel(context: ToolContext): Promise<ResolvedCrewModel> {
  const cached = resolvedModels.get(context);
  if (cached) return cached;
  const fast = await fetchFastModel(context);
  const main = context.crewRuntime?.mainModel;
  if (!fast && !main) {
    throw new CrewError('crew_unavailable', 'No model could be resolved for research members.');
  }
  const resolved: ResolvedCrewModel = fast ? { tier: 'fast', model: fast } : { tier: 'main', model: main! };
  resolvedModels.set(context, resolved);
  context.turnState.crewModelTier = resolved.tier;
  return resolved;
}

function assertTurnBudget(context: ToolContext): void {
  const used = context.turnState.crew;
  if (used && (used.crewCalls >= MAX_CREW_CALLS || used.crewToolCalls >= MAX_CREW_TOOL_CALLS ||
    used.crewModelCalls >= MAX_CREW_MODEL_CALLS)) {
    throw new CrewError('crew_budget_exhausted', 'The research crew budget for this turn is used up.');
  }
}

/** How many tasks the run's remaining call ids can carry (crew spec R-4). */
function affordableTasks(context: ToolContext, requested: number): number {
  const room = Math.floor((CALL_ID_CEILING - context.callBudget.used) / MAX_TOOL_CALLS);
  if (room < 1) {
    throw new CrewError('crew_budget_exhausted', 'The research run has no call ids left for a crew.');
  }
  return Math.min(requested, room);
}

function concurrencyFor(context: ToolContext, tasks: number): number {
  const runtime = context.crewRuntime;
  const settings = runtime?.settings ?? DEFAULT_CREW_SETTINGS;
  const global = runtime?.globalConcurrency ?? HARD_CONCURRENCY;
  return Math.max(1, Math.min(tasks, settings.maxParallel, HARD_CONCURRENCY, global));
}

function safeEmit(context: ToolContext, event: ToolSideEvent): void {
  try { context.emit?.(event); } catch { /* a broken observer must not fail the crew */ }
}

/** Leading-edge throttle for `running` updates; state changes always go out. */
function createMemberReporter(context: ToolContext, crewId: string, now: () => number) {
  const lastRunning = new Map<string, number>();
  return (memberId: string, state: CrewMemberState, snapshot: MemberSnapshot) => {
    if (state === 'running') {
      const previous = lastRunning.get(memberId);
      if (previous !== undefined && now() - previous < PROGRESS_INTERVAL_MS) return;
      lastRunning.set(memberId, now());
    }
    safeEmit(context, { type: 'crew_member', crewId, memberId, state,
      ...(snapshot.activity ? { activity: snapshot.activity } : {}),
      toolCalls: snapshot.toolCalls, modelCalls: snapshot.modelCalls, elapsedMs: snapshot.elapsedMs });
  };
}

const EMPTY_REPORT = { summary: '', candidates: [], sources: [], gaps: [], dropped_unverified: 0 };

function toTaskResult(id: string, outcome: MemberOutcome): CrewTaskResult {
  return { id, status: outcome.status, ...(outcome.report ?? EMPTY_REPORT),
    ...(outcome.error_code ? { error_code: outcome.error_code } : {}), usage: outcome.usage };
}

function unrunTask(id: string, status: 'failed' | 'cancelled', code: string): CrewTaskResult {
  return toTaskResult(id, { status, error_code: code,
    usage: { model_calls: 0, tool_calls: 0, elapsed_ms: 0 } });
}

function addToTurnState(context: ToolContext, results: CrewTaskResult[]): void {
  const turn = context.turnState.crew ?? { crewCalls: 0, crewToolCalls: 0, crewModelCalls: 0 };
  context.turnState.crew = {
    crewCalls: turn.crewCalls + 1,
    crewToolCalls: turn.crewToolCalls + results.reduce((sum, item) => sum + item.usage.tool_calls, 0),
    crewModelCalls: turn.crewModelCalls + results.reduce((sum, item) => sum + item.usage.model_calls, 0),
  };
}

interface Roster {
  context: ToolContext;
  crewId: string;
  resolved: ResolvedCrewModel;
  deps: CrewDeps;
  report: ReturnType<typeof createMemberReporter>;
}

async function runMember(roster: Roster, task: CrewTaskInput, index: number): Promise<MemberOutcome> {
  const { context, crewId, resolved, deps, report } = roster;
  const settings = context.crewRuntime?.settings ?? DEFAULT_CREW_SETTINGS;
  const input: CrewMemberInput = { crewId, index, task, model: resolved.model, parent: context,
    timeoutMs: settings.memberTimeoutSeconds * 1000,
    onProgress: snapshot => report(task.id, 'running', snapshot) };
  let outcome: MemberOutcome;
  try {
    outcome = await (deps.createMember ?? createCrewMember)(input, deps.memberDeps).run();
  } catch {
    // One member's bug must stay in its own task entry (AC-B5).
    outcome = { status: 'failed', error_code: 'member_error',
      usage: { model_calls: 0, tool_calls: 0, elapsed_ms: 0 } };
  }
  report(task.id, outcome.status, { toolCalls: outcome.usage.tool_calls,
    modelCalls: outcome.usage.model_calls, elapsedMs: outcome.usage.elapsed_ms });
  return outcome;
}

function collectResults(
  tasks: CrewTaskInput[], runnable: number, slots: Array<SettledSlot<MemberOutcome>>,
): CrewTaskResult[] {
  return tasks.map((task, index): CrewTaskResult => {
    if (index >= runnable) return unrunTask(task.id, 'failed', 'research_budget_exhausted');
    const slot = slots[index];
    // An unstarted slot means the parent stopped before this member began.
    return slot && 'value' in slot ? toTaskResult(task.id, slot.value) : unrunTask(task.id, 'cancelled', 'cancelled');
  });
}

function emitCrewEnd(context: ToolContext, crewId: string, results: CrewTaskResult[]): void {
  const ready = results.filter(item => item.status === 'done' || item.status === 'partial').length;
  safeEmit(context, { type: 'crew_end', crewId, ready, failed: results.length - ready,
    candidates: results.reduce((sum, item) => sum + item.candidates.length, 0) });
}

/**
 * Runs the research crew for one `delegate_research` call (crew spec §3.3.4):
 * resolves the model once, runs members with bounded concurrency on the
 * parent's own research run, and returns bounded, validated task results.
 *
 * @throws {CrewError} `crew_budget_exhausted` when the turn or run budget is
 *   spent, `crew_unavailable` when no model can be resolved.
 */
export async function runCrew(
  context: ToolContext, toolCallId: string, tasks: CrewTaskInput[], deps: CrewDeps = {},
): Promise<CrewRunPayload> {
  assertTurnBudget(context);
  const affordable = affordableTasks(context, tasks.length);
  const resolved = await resolveCrewModel(context);
  const crewId = (deps.newId ?? (() => globalThis.crypto.randomUUID()))();
  const roster: Roster = { context, crewId, resolved, deps,
    report: createMemberReporter(context, crewId, deps.now ?? Date.now) };
  const runnable = tasks.slice(0, affordable);
  safeEmit(context, { type: 'crew_start', toolCallId, crewId, modelTier: resolved.tier,
    members: tasks.map(task => ({ id: task.id, goal: task.goal.slice(0, 400) })) });
  for (const task of runnable) {
    roster.report(task.id, 'queued', { toolCalls: 0, modelCalls: 0, elapsedMs: 0 });
  }
  const slots = await mapWithConcurrency(runnable, concurrencyFor(context, runnable.length),
    (task, index) => runMember(roster, task, index), () => !context.abortSignal?.aborted);
  const results = collectResults(tasks, runnable.length, slots);
  addToTurnState(context, results);
  emitCrewEnd(context, crewId, results);
  const fitted = fitResultToBudget(results);
  const reduced = runnable.length < tasks.length
    ? ` Only ${runnable.length} of ${tasks.length} tasks ran: the research run is low on call ids; search the rest sequentially.`
    : '';
  return { model_tier: resolved.tier, tasks: fitted.tasks,
    ...(fitted.truncated ? { truncated: true as const } : {}), next_step: NEXT_STEP + reduced };
}
