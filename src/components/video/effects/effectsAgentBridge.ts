import { z } from 'zod';
import type { MaterialItem, TimelineState } from '@/types';
import type { EffectAsset, EffectTargetSnapshot } from '@/types/effects';
import { EffectError } from '@/types/effects';
import { attachEffectInput, getEffectAsset, getEffectJob } from '@/lib/api/effects';
import { http } from '@/lib/api/http-client';
import { assertEffectSourceMatches, fingerprintEffectTarget,
  hashEffectValue } from '@/lib/effects/provenance';
import { applyEffectsTimelineAction } from '../timeline/store/actions/applyEffects';
import { useTimelineStore } from '../timeline/store/useTimelineStore';
import type { EffectsAgentBridge, EffectsApplyRequest,
  EffectsApplyResult } from '@/lib/video-editing-agent/types';

interface BridgeOptions {
  projectId?: string;
  getProjectId: () => string | undefined;
  getMaterials?: () => readonly MaterialItem[];
  registerMaterial: (material: MaterialItem) => void;
  onWatchJob: (job: Awaited<ReturnType<typeof getEffectJob>>) => void;
}
const common = { type: z.literal('effects_action'),
  action: z.literal('apply_asset'), projectId: z.string().min(1),
  operationId: z.string().min(1).max(256), assetId: z.string().min(1) };
const operationSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('insert'),
    startTime: z.number().finite().min(0).max(86400) }).strict(),
  z.object({ ...common, mode: z.literal('replace'), targetClipId: z.string().min(1),
    expectedTargetFingerprint: z.string().length(64) }).strict(),
]);

function getClip(id: string) {
  for (const track of useTimelineStore.getState().exportToData().tracks) {
    const item = track.items.find(item => item.id === id);
    if (item) return { track, item };
  }
  throw new EffectError('EFFECT_TARGET_CHANGED');
}

async function prepareTarget(options: {
  request: EffectsApplyRequest; asset: EffectAsset; isValid: () => boolean;
  getMaterials?: () => readonly MaterialItem[];
}): Promise<EffectTargetSnapshot | undefined> {
  const operation = options.request.operation;
  if (operation.mode !== 'replace') return undefined;
  const { track, item } = getClip(operation.targetClipId);
  if (fingerprintEffectTarget(track, item) !== operation.expectedTargetFingerprint) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  const target: EffectTargetSnapshot = { projectId: operation.projectId,
    trackId: track.id, clipId: item.id, durationSeconds: item.duration,
    targetFingerprint: operation.expectedTargetFingerprint,
    trimStartFrame: Math.round((item.clipStart ?? 0) * 30),
    durationFrames: Math.ceil(item.duration * 30) };
  const isSame = item.metadata?.effects?.assetId === options.asset.id
    && item.url === options.asset.url && item.cacheUrl === options.asset.url
    && item.serverUrl === options.asset.url && item.storageKey === options.asset.storageKey
    && item.clipStart === 0 && item.clipEnd === item.duration;
  if (isSame) return target;
  const material = options.getMaterials?.().find(m => m.id === item.materialId);
  const resolved = { ...material, ...item };
  const source = [resolved.cacheUrl, resolved.metadata?.localResolvedUrl,
    resolved.serverUrl, resolved.url].find(url => typeof url === 'string'
      && url.startsWith('/api/storage/files/'));
  if (!source) throw new EffectError('EFFECT_INPUT_NOT_LOCAL');
  const input = await attachEffectInput(operation.projectId, source, item.materialId);
  if (!options.isValid()) throw new EffectError('EFFECT_TARGET_CHANGED');
  target.sourceSha256 = input.sha256;
  assertEffectSourceMatches(options.asset, target);
  return target;
}

async function applyRequest(options: BridgeOptions, request: EffectsApplyRequest,
  isLeaseValid: () => boolean): Promise<EffectsApplyResult> {
  const operation = request.operation;
  const isValid = () => isLeaseValid() && Date.now() < request.expiresAt
    && options.projectId === options.getProjectId()
    && operation.projectId === options.projectId;
  try {
    operationSchema.parse(operation);
    if (!isValid()) throw new EffectError('EFFECT_TARGET_CHANGED');
    const asset = await getEffectAsset(operation.projectId, operation.assetId);
    if (!isValid()) throw new EffectError('EFFECT_TARGET_CHANGED');
    const target = await prepareTarget({ request, asset, isValid,
      getMaterials: options.getMaterials });
    if (!isValid()) throw new EffectError('EFFECT_TARGET_CHANGED');
    const result = applyEffectsTimelineAction({ asset, reason: 'agent',
      getStore: useTimelineStore.getState, getProjectId: options.getProjectId,
      registerMaterial: options.registerMaterial, isLeaseValid: isValid,
      intent: { projectId: operation.projectId, operationId: operation.operationId,
        mode: operation.mode, target,
        startTime: operation.mode === 'insert' ? operation.startTime : undefined } });
    return { state: result.status === 'noop' ? 'noop' : 'applied',
      assetId: asset.id, clipId: result.clipId,
      before: { ...result.before, selectedItems: [] } as TimelineState,
      after: { ...result.after, selectedItems: [result.clipId] } as TimelineState };
  } catch (error) {
    return { state: 'not_applied', assetId: operation.assetId,
      errorCode: error instanceof EffectError ? error.code : 'EFFECT_INVALID_ARGUMENT' };
  }
}

/** A project mount owns job delivery; individual run leases own commits.
 * Kept together so the bridge's revocation, request and idempotency maps share
 * exactly one mount lifetime; its methods are short independent entry points. */
export function createEffectsAgentBridge(options: BridgeOptions): EffectsAgentBridge {
  const owned = new Map<string, string>();
  const requests = new Map<string, string>();
  const revoked = new Set<string>();
  const stoppedJobs = new Set<string>();
  const delivered = new Map<string, { digest: string;
    result: Promise<EffectsApplyResult> }>();
  const registerMaterials = (materials: MaterialItem[]) => {
    if (options.getProjectId() !== options.projectId) return;
    materials.filter(material => material.metadata?.effects?.projectId === options.projectId)
      .forEach(options.registerMaterial);
  };
  return {
    registerMaterials,
    beginOperation(event) {
      revoked.delete(event.toolCallId);
      stoppedJobs.delete(event.toolCallId);
      if (event.toolName === 'render_effect' && typeof event.params.requestId === 'string') {
        requests.set(event.toolCallId, event.params.requestId);
      }
    },
    async watch(operation) {
      if (operation.projectId !== options.projectId
        || options.getProjectId() !== options.projectId) return;
      owned.set(operation.operationId, operation.jobId);
      if (stoppedJobs.has(operation.operationId)) {
        await cancelOwnedJob({ options, jobId: operation.jobId }); return;
      }
      const job = await getEffectJob(operation.projectId, operation.jobId);
      if (stoppedJobs.has(operation.operationId)) {
        await cancelOwnedJob({ options, jobId: operation.jobId }); return;
      }
      if (options.getProjectId() === options.projectId) options.onWatchJob(job);
    },
    apply(request, isLeaseValid) {
      const key = `${request.runId}:${request.operation.operationId}`;
      const digest = hashEffectValue(request.operation);
      const previous = delivered.get(key);
      if (previous) return previous.digest === digest ? previous.result
        : Promise.resolve({ state: 'not_applied', assetId: request.operation.assetId,
          errorCode: 'EFFECT_IDEMPOTENCY_CONFLICT' });
      const result = applyRequest(options, request, () => isLeaseValid()
        && !revoked.has(request.operation.operationId));
      delivered.set(key, { digest, result });
      const timer = setTimeout(() => delivered.delete(key), 120_000);
      timer.unref?.();
      return result;
    },
    cancelOperations({ cancelJobs, operationIds }) {
      const ids = operationIds ?? Array.from(owned.keys());
      ids.forEach(id => revoked.add(id));
      if (!cancelJobs || !options.projectId) return;
      ids.forEach(id => stoppedJobs.add(id));
      for (const id of ids) void cancelOwnedJob({ options,
        jobId: owned.get(id), requestId: requests.get(id) });
    },
  };
}

/** Cleanup owns a fresh five-second signal, even after the Agent was aborted. */
async function cancelOwnedJob(context: { options: BridgeOptions;
  jobId?: string; requestId?: string }): Promise<void> {
  const { options } = context;
  if (!context.jobId && !context.requestId) return;
  const root = `/api/effects/projects/${encodeURIComponent(options.projectId!)}/jobs`;
  const signal = AbortSignal.timeout(5000);
  const deadline = Date.now() + 5000;
  try {
    let jobId = context.jobId;
    if (!jobId) {
      jobId = await findSubmittedJob(root, context.requestId!, signal, deadline);
    }
    const result = await http.post<{ data: Record<string, unknown> }>(
      `${root}/${jobId}/cancel`, {}, { signal, retries: 0 });
    const { fromWireEffectJob } = await import('@/lib/api/effects');
    if (options.projectId === options.getProjectId()) {
      options.onWatchJob(fromWireEffectJob(result.data));
    }
  } catch {
    // No terminal state is invented; durable jobs remain discoverable on reopen.
  }
}

/** A POST may still be waiting for the project lock when Stop arrives. */
async function findSubmittedJob(root: string, requestId: string,
  signal: AbortSignal, deadline: number): Promise<string> {
  while (Date.now() < deadline && !signal.aborted) {
    try {
      const lookup = await http.get<{ data: { job_id: string } }>(
        `${root}/by-request/${requestId}`, { signal, retries: 0,
          timeoutMs: Math.max(1, deadline - Date.now()) });
      return lookup.data.job_id;
    } catch (error) {
      if ((error as { status?: number })?.status !== 404
        || Date.now() + 150 >= deadline || signal.aborted) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  throw new EffectError('EFFECT_REQUEST_FAILED');
}
