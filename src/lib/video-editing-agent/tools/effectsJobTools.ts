import { z } from 'zod';
import { fromWireEffectJob } from '@/lib/api/effects';
import { assertEffectSourceMatches } from '@/lib/effects/provenance';
import { createEffectMaterial } from '@/components/video/effects/effectsTimeline';
import type { ToolContext } from '../types';
import { EffectError } from '@/types/effects';
import { EffectRequestError, effectId, effectProjectPath, effectRequest,
  effectUuid, makeEffectTool, strictObject } from './effectsCatalogTools';
import { getEffectsTargets } from './effectsDraftTools';

async function submit(context: ToolContext, body: Record<string, unknown>) {
  const path = effectProjectPath(context, '/jobs');
  try { return await effectRequest(context, path, { body }); }
  catch (error) {
    if (error instanceof EffectRequestError && error.status < 500) throw error;
    try {
      return await effectRequest(context, `${path}/by-request/${body.request_id}`);
    } catch (lookupError) {
      if (!(lookupError instanceof EffectRequestError) || lookupError.status !== 404) {
        throw error;
      }
    }
    return effectRequest(context, path, { body });
  }
}

function jobResult(context: ToolContext, identifier: string,
  wire: Record<string, unknown>, register: boolean) {
  const job = fromWireEffectJob(wire);
  if (job.projectId !== context.projectId) throw new EffectError('EFFECT_NOT_FOUND');
  if (register && job.status === 'succeeded' && job.outputAsset) {
    const material = createEffectMaterial(job.outputAsset);
    if (!context.materials.some(item => item.id === material.id)) {
      context.materials = [...context.materials, material];
      context.recordOperation(identifier, { type: 'add_materials', materials: [material] });
    }
    const target = getEffectsTargets(context).drafts.get(job.draftId);
    if (target) {
      try {
        assertEffectSourceMatches(job.outputAsset, target);
        getEffectsTargets(context).outputs.set(`${job.outputAsset.id}:${target.clipId}`, target);
      } catch (error) {
        if (!(error instanceof EffectError) || error.code !== 'EFFECT_SOURCE_MISMATCH') throw error;
      }
    }
  }
  return { success: true, jobId: job.id, draftId: job.draftId,
    draftVersion: job.draftVersion, status: job.status, phase: job.phase,
    progress: job.progress, retry_after_ms: job.retryAfterMs,
    error_code: job.errorCode,
    ...(job.outputAsset ? { asset: job.outputAsset,
      material: { id: `effect-material:${job.outputAsset.id}`, type: 'video',
        duration: job.outputAsset.durationSeconds } } : {}) };
}

export function createEffectsJobTools(context: ToolContext) {
  return [makeEffectTool({ context, name: 'render_effect',
    description: 'Queue one immutable saved version. A returned job is not generated or applied; poll get_effect_job later.',
    schema: strictObject({ draftId: effectId,
      expectedVersion: z.number().int().positive(), requestId: effectUuid,
      profile: z.enum(['mp4-1080p', 'mp4-720p']).optional() }),
    run: async (id, params) => {
      const wire = await submit(context, { draft_id: params.draftId,
        expected_version: params.expectedVersion, request_id: params.requestId,
        output: { profile: params.profile ?? 'mp4-1080p' } });
      const job = fromWireEffectJob(wire);
      if (job.projectId !== context.projectId) throw new EffectError('EFFECT_NOT_FOUND');
      context.recordOperation(id, { type: 'effects_action', action: 'watch_job',
        projectId: context.projectId!, operationId: id, jobId: job.id });
      return jobResult(context, id, wire, false);
    } }), makeEffectTool({ context, name: 'get_effect_job',
    description: 'Read a durable effect job. Only succeeded means generated; register its stable material once.',
    schema: strictObject({ jobId: effectId }),
    run: async (id, params) => jobResult(context, id, await effectRequest(context,
      effectProjectPath(context, `/jobs/${encodeURIComponent(params.jobId)}`)), true),
  }), makeEffectTool({ context, name: 'cancel_effect_job',
    description: 'Request cancellation and report its actual terminal or cancelling state.',
    schema: strictObject({ jobId: effectId }),
    run: async (id, params) => jobResult(context, id, await effectRequest(context,
      effectProjectPath(context, `/jobs/${encodeURIComponent(params.jobId)}/cancel`),
      { body: {} }), false),
  })];
}
