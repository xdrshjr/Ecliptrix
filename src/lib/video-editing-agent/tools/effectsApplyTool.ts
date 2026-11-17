import { z } from 'zod';
import { fromWireEffectAsset } from '@/lib/api/effects';
import { assertEffectSourceMatches,
  fingerprintEffectTarget } from '@/lib/effects/provenance';
import { EffectError } from '@/types/effects';
import type { EffectsApplyRequest, ToolContext } from '../types';
import { createEffectApplyReceipt } from '../effectApplyReceipts';
import { effectId, effectProjectPath, effectRequest,
  makeEffectTool, strictObject } from './effectsCatalogTools';
import { captureEffectsTarget, findEffectsClip,
  getEffectsTargets } from './effectsDraftTools';

/** Every timeline mutation shares this conservative unknown-result guard. */
export function assertCanMutateEffectsTimeline(context: ToolContext): void {
  context.abortSignal?.throwIfAborted();
  if (context.effectsApplyUncertain) {
    throw new EffectError('EFFECT_TIMELINE_RESYNC_REQUIRED');
  }
}

async function getAsset(context: ToolContext, id: string) {
  const asset = fromWireEffectAsset(await effectRequest(context,
    effectProjectPath(context, `/assets/${encodeURIComponent(id)}`)));
  if (asset.projectId !== context.projectId || asset.kind !== 'output-video') {
    throw new EffectError('EFFECT_NOT_FOUND');
  }
  return asset;
}

const applySchema = z.discriminatedUnion('mode', [
  strictObject({ mode: z.literal('replace'), assetId: effectId,
    targetClipId: effectId, expectedTargetFingerprint: z.string().length(64) }),
  strictObject({ mode: z.literal('insert'), assetId: effectId,
    startTime: z.number().finite().min(0).max(86400) }),
]);

export function createEffectsApplyTools(context: ToolContext) {
  return [makeEffectTool({ context, name: 'get_effect_target',
    description: 'Bind this run to a current clip after matching the output’s immutable source hash, trim and canvas.',
    schema: strictObject({ assetId: effectId, targetClipId: effectId }),
    run: async (_, params) => {
      const asset = await getAsset(context, params.assetId);
      const { item, track } = findEffectsClip(context, params.targetClipId);
      let target;
      if (item.metadata?.effects?.assetId === asset.id && item.url === asset.url
        && item.cacheUrl === asset.url && item.serverUrl === asset.url
        && item.storageKey === asset.storageKey && item.clipStart === 0
        && item.clipEnd === item.duration) {
        target = { projectId: context.projectId!, trackId: track.id,
          clipId: item.id, durationSeconds: item.duration,
          targetFingerprint: fingerprintEffectTarget(track, item) };
      } else {
        target = (await captureEffectsTarget(context, params.targetClipId)).target;
        assertEffectSourceMatches(asset, target);
      }
      getEffectsTargets(context).outputs.set(`${asset.id}:${item.id}`, target);
      return { success: true, expectedTargetFingerprint: target.targetFingerprint,
        targetClipId: item.id, assetId: asset.id };
    } }), makeEffectTool({ context, name: 'apply_effect',
    description: 'Apply a generated asset after a real client acknowledgement. Unknown results require a new turn; never retry automatically.',
    schema: applySchema,
    run: async (id, params) => {
      assertCanMutateEffectsTimeline(context);
      const asset = await getAsset(context, params.assetId);
      if (params.mode === 'replace') {
        const target = getEffectsTargets(context).outputs.get(`${asset.id}:${params.targetClipId}`);
        const current = findEffectsClip(context, params.targetClipId);
        if (!target || target.targetFingerprint !== params.expectedTargetFingerprint
          || fingerprintEffectTarget(current.track, current.item) !== target.targetFingerprint) {
          throw new EffectError('EFFECT_TARGET_CHANGED');
        }
        if (current.item.metadata?.effects?.assetId !== asset.id) {
          assertEffectSourceMatches(asset, target);
        }
      }
      assertCanMutateEffectsTimeline(context);
      if (!context.emit) throw new EffectError('EFFECT_CLIENT_UNAVAILABLE');
      const operation: EffectsApplyRequest['operation'] = { ...params,
        type: 'effects_action', action: 'apply_asset',
        projectId: context.projectId!, operationId: id };
      const ticket = createEffectApplyReceipt({ operation,
        runId: context.effectsRunId ??= crypto.randomUUID(),
        signal: context.abortSignal,
        onTimeline: timeline => { context.timelineState = timeline; } });
      context.emit(ticket.request);
      const result = await ticket.result;
      if (result.state === 'dispatched_unknown') context.effectsApplyUncertain = true;
      return { success: ['applied', 'noop'].includes(result.state), ...result,
        error_code: result.errorCode ?? (result.state === 'dispatched_unknown'
          ? 'EFFECT_TIMELINE_RESYNC_REQUIRED' : undefined) };
    } })];
}
