import { z } from 'zod';
import { fromWireEffectJob } from '@/lib/api/effects';
import { assertEffectSourceMatches } from '@/lib/effects/provenance';
import { createEffectMaterial } from '@/components/video/effects/effectsTimeline';
import type { EffectRenderRecovery, ToolContext } from '../types';
import { EffectError } from '@/types/effects';
import type { EffectRenderJob } from '@/types/effects';
import { EffectRequestError, effectId, effectProjectPath, effectRequest,
  effectUuid, makeEffectTool, strictObject, EffectRecoveryError,
  effectRenderRecovery, effectIdentity,
  assertEffectDraftSettled,
  EffectRecoveryUnavailableError } from './effectsCatalogTools';
import { getEffectsTargets } from './effectsDraftTools';

const renderSchema = strictObject({ draftId: effectId,
  expectedVersion: z.number().int().positive(), requestId: effectUuid,
  profile: z.enum(['mp4-1080p', 'mp4-720p']).optional() });
const JOB_STATUSES = ['queued', 'running', 'cancelling', 'succeeded',
  'failed', 'cancelled', 'interrupted'];

function assertSubmittedJob(context: ToolContext,
  recovery: EffectRenderRecovery, wire: Record<string, unknown>) {
  const job = fromWireEffectJob(wire);
  if (job.projectId !== context.projectId || job.requestId !== recovery.requestId
    || job.draftId !== recovery.draftId
    || job.draftVersion !== recovery.expectedVersion
    || !effectId.safeParse(job.id).success
    || !JOB_STATUSES.includes(job.status)) {
    throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
  }
  return wire;
}

async function postSubmission(context: ToolContext,
  recovery: EffectRenderRecovery) {
  const wire = await effectRequest(context, effectProjectPath(context, '/jobs'), {
    body: { draft_id: recovery.draftId, expected_version: recovery.expectedVersion,
      request_id: recovery.requestId, output: { profile: recovery.profile } },
  });
  context.abortSignal?.throwIfAborted();
  return assertSubmittedJob(context, recovery, wire);
}

async function recoverSubmission(context: ToolContext,
  recovery: EffectRenderRecovery) {
  let wire: Record<string, unknown>;
  try {
    wire = await effectRequest(context, effectProjectPath(context,
      `/jobs/by-request/${encodeURIComponent(recovery.requestId)}`));
  } catch (error) {
    if (error instanceof EffectRequestError && error.status === 404) {
      return postSubmission(context, recovery);
    }
    throw error;
  }
  context.abortSignal?.throwIfAborted();
  return assertSubmittedJob(context, recovery, wire);
}

/** Stop has one five-second budget and only cancels a verified server job. */
async function cleanupStoppedSubmission(context: ToolContext,
  recovery: EffectRenderRecovery): Promise<void> {
  const cleanup = { ...context, abortSignal: AbortSignal.timeout(5000) };
  try {
    const wire = await effectRequest(cleanup, effectProjectPath(cleanup,
      `/jobs/by-request/${encodeURIComponent(recovery.requestId)}`));
    assertSubmittedJob(cleanup, recovery, wire);
    const job = fromWireEffectJob(wire);
    await effectRequest(cleanup, effectProjectPath(cleanup,
      `/jobs/${encodeURIComponent(job.id)}/cancel`), { body: {} });
  } catch { /* Stop preserves recovery when bounded cleanup cannot confirm. */ }
}

async function submit(context: ToolContext, toolCallId: string,
  recovery: EffectRenderRecovery) {
  const pending = context.effectsPendingRenders ??= new Map();
  const previous = pending.get(recovery.requestId);
  const other = Array.from(pending.values()).find(item =>
    item.recovery.draftId === recovery.draftId);
  const blocker = previous ?? other;
  if (blocker && effectIdentity(blocker.recovery) !== effectIdentity(recovery)) {
    throw new EffectRecoveryError(toolCallId, blocker.recovery);
  }
  pending.set(recovery.requestId, { toolCallId, recovery });
  try {
    return await (previous ? recoverSubmission(context, recovery)
      : postSubmission(context, recovery));
  } catch (error) {
    if (!previous && error instanceof EffectRequestError
      && error.status >= 400 && error.status < 500 && error.status !== 409) {
      pending.delete(recovery.requestId);
      throw error;
    }
    if (context.abortSignal?.aborted) {
      await cleanupStoppedSubmission(context, recovery);
    } else if (!previous) {
      try { return await recoverSubmission(context, recovery); }
      catch { /* The next recovery call must retain this original request. */ }
    }
    throw new EffectRecoveryError(toolCallId, recovery);
  }
}

function settleSubmission(context: ToolContext, job: EffectRenderJob) {
  const pending = context.effectsPendingRenders?.get(job.requestId);
  if (!pending) return undefined;
  assertSubmittedJob(context, pending.recovery, {
    job_id: job.id, status: job.status,
    project_id: job.projectId, request_id: job.requestId,
    draft_id: job.draftId, draft_version: job.draftVersion,
  });
  context.effectsPendingRenders?.delete(job.requestId);
  return pending.recovery;
}

function registerOutput(context: ToolContext, identifier: string,
  job: EffectRenderJob): void {
  if (job.status !== 'succeeded' || !job.outputAsset) return;
  const material = createEffectMaterial(job.outputAsset);
  if (!context.materials.some(item => item.id === material.id)) {
    context.materials = [...context.materials, material];
    context.recordOperation(identifier, { type: 'add_materials', materials: [material] });
  }
  const target = getEffectsTargets(context).drafts.get(job.draftId);
  if (!target) return;
  try {
    assertEffectSourceMatches(job.outputAsset, target);
    getEffectsTargets(context).outputs.set(`${job.outputAsset.id}:${target.clipId}`, target);
  } catch (error) {
    if (!(error instanceof EffectError) || error.code !== 'EFFECT_SOURCE_MISMATCH') throw error;
  }
}

function jobResult(context: ToolContext, identifier: string,
  wire: Record<string, unknown>, register: boolean, settle = true) {
  const job = fromWireEffectJob(wire);
  if (job.projectId !== context.projectId) throw new EffectError('EFFECT_NOT_FOUND');
  const recovery = settle ? settleSubmission(context, job) : undefined;
  if (register) registerOutput(context, identifier, job);
  return { success: true, schemaVersion: 1, projectId: context.projectId,
    toolCallId: identifier, requestId: job.requestId, recovery,
    jobId: job.id, draftId: job.draftId,
    draftVersion: job.draftVersion, status: job.status, phase: job.phase,
    progress: job.progress, retry_after_ms: job.retryAfterMs,
    error_code: job.errorCode,
    ...(job.outputAsset ? { asset: job.outputAsset,
      material: { id: `effect-material:${job.outputAsset.id}`, type: 'video',
        duration: job.outputAsset.durationSeconds } } : {}) };
}

async function renderEffect(context: ToolContext, id: string,
  params: z.output<typeof renderSchema>) {
  assertEffectDraftSettled(context, params.draftId, id);
  if (context.effectsRenderRecoveryIncomplete?.has(params.draftId)) {
    throw new EffectRecoveryUnavailableError(context, id, params.draftId, 'render');
  }
  const recovery = effectRenderRecovery.parse({ schemaVersion: 1,
    projectId: context.projectId, ...params,
    profile: params.profile ?? 'mp4-1080p' });
  const wire = await submit(context, id, recovery);
  const job = fromWireEffectJob(wire);
  context.recordOperation(id, { type: 'effects_action', action: 'watch_job',
    projectId: context.projectId!, operationId: id, jobId: job.id });
  return jobResult(context, id, wire, false);
}

const getJobSchema = z.union([strictObject({ jobId: effectId }),
  strictObject({ requestId: effectUuid })]);

async function getEffectJob(context: ToolContext, id: string,
  params: z.output<typeof getJobSchema>) {
  const suffix = 'jobId' in params ? `/jobs/${encodeURIComponent(params.jobId)}`
    : `/jobs/by-request/${encodeURIComponent(params.requestId)}`;
  const wire = await effectRequest(context, effectProjectPath(context, suffix));
  if ('requestId' in params && wire.request_id !== params.requestId) {
    throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
  }
  if ('jobId' in params && wire.job_id !== params.jobId) {
    throw new EffectError('EFFECT_SUBMISSION_UNKNOWN');
  }
  return jobResult(context, id, wire, true);
}

export function createEffectsJobTools(context: ToolContext) {
  return [makeEffectTool({ context, name: 'render_effect',
    description: 'Queue a saved version. Unknown: get_effect_job(requestId); '
      + 'only after 404 replay the exact requestId/version/profile. '
      + 'Never create a new key.',
    schema: renderSchema,
    run: (id, params) => renderEffect(context, id, params),
  }), makeEffectTool({ context, name: 'get_effect_job',
    description: 'Read by exactly one jobId or original requestId. '
      + 'Only succeeded means generated. 404 does not resolve an unknown submit.',
    schema: getJobSchema,
    run: (id, params) => getEffectJob(context, id, params),
  }), makeEffectTool({ context, name: 'cancel_effect_job',
    description: 'Request cancellation and report its actual terminal or cancelling state.',
    schema: strictObject({ jobId: effectId }),
    run: async (id, params) => jobResult(context, id, await effectRequest(context,
      effectProjectPath(context, `/jobs/${encodeURIComponent(params.jobId)}/cancel`),
      { body: {} }), false, false),
  })];
}
