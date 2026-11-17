import type { MaterialItem } from '@/types';
import { EffectError } from '@/types/effects';
import type { TimelineStore } from '../useTimelineStore';
import { isEditLocked } from '../editLock';
import { replaceTimelineAction } from './replaceTimeline';
import { planEffectsTimelineChange,
  type EffectsTimelineOptions } from '../../../effects/effectsTimeline';

interface ApplyEffectsOptions extends Omit<EffectsTimelineOptions, 'timeline'> {
  getStore: () => TimelineStore;
  getProjectId: () => string | undefined;
  registerMaterial: (material: MaterialItem) => void;
  reason?: 'effects' | 'agent';
  isLeaseValid?: () => boolean;
}

function assertAllowed(options: ApplyEffectsOptions): void {
  const state = options.getStore();
  if (options.getProjectId() !== options.intent.projectId) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  if (state.isInteracting) throw new EffectError('EFFECT_ACTIVE_GESTURE');
  const isAgent = options.reason === 'agent' && options.isLeaseValid?.();
  if (options.reason === 'agent' && !isAgent) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  if (isEditLocked(state) && !isAgent) {
    throw new EffectError('EFFECT_EDIT_LOCKED');
  }
}

/** Register then commit in the same stack, with a second live guard. */
export function applyEffectsTimelineAction(options: ApplyEffectsOptions) {
  assertAllowed(options);
  const before = options.getStore().exportToData();
  const plan = planEffectsTimelineChange({ ...options, timeline: before });
  if (plan.status === 'noop') return { ...plan, before, after: before };
  const baseline = JSON.stringify(before.tracks);
  options.registerMaterial(plan.material);
  assertAllowed(options);
  if (JSON.stringify(options.getStore().exportToData().tracks) !== baseline) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  if (!replaceTimelineAction(options.getStore, plan.timeline,
    options.reason ?? 'effects')) {
    throw new EffectError('EFFECT_TARGET_CHANGED');
  }
  options.getStore().selectItem(plan.clipId);
  const after = options.getStore().exportToData();
  return { ...plan, before, after };
}
