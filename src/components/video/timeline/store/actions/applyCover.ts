import type { MaterialItem } from '@/types';
import { CoverTimelineError, planCoverTimelineChange,
  type CoverTimelineOptions, type CoverTimelinePlan } from '../../../cover/coverTimeline';
import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import { replaceTimelineAction } from './replaceTimeline';

export interface ApplyCoverTimelineOptions extends Omit<CoverTimelineOptions, 'timeline'> {
  getStore: () => TimelineStore;
  getProjectId: () => string | undefined;
  registerMaterial: (material: MaterialItem) => void;
  reason?: 'cover' | 'agent';
}

export function applyCoverTimelineAction(options: ApplyCoverTimelineOptions): CoverTimelinePlan {
  const { getStore, projectId, reason = 'cover' } = options;
  const state = getStore();
  if (options.getProjectId() !== projectId) throw new CoverTimelineError('Project changed');
  if (state.isInteracting) throw new CoverTimelineError('Finish the active gesture');
  if (isEditLocked(state) && reason !== 'agent') throw new CoverTimelineError('Editor is locked');
  const plan = planCoverTimelineChange({ ...options, timeline: state.exportToData() });
  if (plan.status === 'noop') return plan;
  const baseline = JSON.stringify(state.exportToData().tracks);
  if (plan.material) options.registerMaterial(plan.material);
  // No await between these live checks and the single history transaction.
  if (options.getProjectId() !== projectId || getStore().isInteracting
    || JSON.stringify(getStore().exportToData().tracks) !== baseline) {
    throw new CoverTimelineError('Editor changed while registering material');
  }
  if (!replaceTimelineAction(getStore, plan.timeline, reason)) {
    throw new CoverTimelineError('Timeline update was refused');
  }
  if (plan.clipId) {
    getStore().setCurrentTime(0);
    getStore().selectItem(plan.clipId);
  }
  return plan;
}
