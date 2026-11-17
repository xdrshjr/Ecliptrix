import type { EffectRenderJob } from '@/types/effects';
import { EffectError } from '@/types/effects';

const ACTIVE_ORDER = ['queued', 'running', 'cancelling'];
const PHASE_ORDER = ['preparing', 'frames', 'encoding', 'validating', 'publishing'];

/** Public states never move backwards when independent snapshots arrive. */
export const isEffectJobActive = (job: EffectRenderJob) =>
  ACTIVE_ORDER.includes(job.status);

export interface EffectJobMerge {
  job: EffectRenderJob;
  error?: Error;
}

function readProgress(job: EffectRenderJob): number {
  return Number.isFinite(job.progress)
    ? Math.min(1, Math.max(0, job.progress)) : 0;
}

/** Merge only one project/job identity, preserving the first terminal state. */
export function mergeEffectJob(current: EffectRenderJob,
  incoming: EffectRenderJob): EffectJobMerge {
  if (current.id !== incoming.id || current.projectId !== incoming.projectId) {
    return { job: current,
      error: new EffectError('EFFECT_IDEMPOTENCY_CONFLICT') };
  }
  const currentActive = isEffectJobActive(current);
  const incomingActive = isEffectJobActive(incoming);
  if (!currentActive && !incomingActive && current.status !== incoming.status) {
    return { job: current,
      error: new EffectError('EFFECT_IDEMPOTENCY_CONFLICT') };
  }
  if (!currentActive && incomingActive) return { job: current };
  if (currentActive && incomingActive && ACTIVE_ORDER.indexOf(incoming.status)
    < ACTIVE_ORDER.indexOf(current.status)) return { job: current };
  const job = { ...current, ...incoming,
    progress: Math.max(readProgress(current), readProgress(incoming)),
    outputAsset: incoming.outputAsset ?? current.outputAsset };
  if (!incomingActive) {
    job.phase = job.status;
    if (job.status === 'succeeded') job.progress = 1;
  } else if (current.status === 'running' && incoming.status === 'running'
    && PHASE_ORDER.indexOf(incoming.phase) < PHASE_ORDER.indexOf(current.phase)) {
    job.phase = current.phase;
  }
  return { job };
}
