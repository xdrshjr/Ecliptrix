import { isGap, type CapabilityId, type CapabilityStatus } from '@/lib/api/setupStatus';
import type { WizardSlot } from '@/lib/api/modelSettings';
import type { SettingsMenuItem } from '@/components/settings/SettingsSidebar';

export type WizardStepId = 'overview' | 'provider' | 'models' | 'search' | 'done';
export type WizardMode = 'auto' | 'manual';

/** Capabilities served by a model provider, in the order the wizard shows them. */
export const MODEL_SLOTS: readonly WizardSlot[] = [
  'chat',
  'fast',
  'video_cut',
  'vision',
  'research',
];

function isModelSlot(id: CapabilityId): id is WizardSlot {
  return (MODEL_SLOTS as readonly string[]).includes(id);
}

/** True when the user has to act on `capability` in this run of the wizard. */
function needsAction(
  capability: CapabilityStatus,
  optOuts: readonly CapabilityId[],
): boolean {
  if (!isGap(capability)) return false;
  return capability.tier === 'core' || !optOuts.includes(capability.id);
}

/** Model slots the wizard may write: gaps (auto) or every slot (manual). */
export function selectableSlots(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
  mode: WizardMode,
): WizardSlot[] {
  const byId = new Map(capabilities.map((item) => [item.id, item]));
  return MODEL_SLOTS.filter((slot) => {
    const capability = byId.get(slot);
    if (!capability) return mode === 'manual';
    return mode === 'manual' || needsAction(capability, optOuts);
  });
}

/**
 * Ordered steps for this run. Derived ONCE when the wizard opens and then
 * frozen: writes refetch the status, and a shrinking list would make the
 * stepper jump under the user's feet.
 */
export function deriveWizardSteps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
  mode: WizardMode,
): WizardStepId[] {
  const steps: WizardStepId[] = ['overview'];
  const gaps = capabilities.filter((item) => needsAction(item, optOuts));
  const needsModels =
    mode === 'manual' || gaps.some((item) => isModelSlot(item.id));
  const needsSearch =
    mode === 'manual' || gaps.some((item) => item.id === 'web_search');
  if (needsModels) steps.push('provider', 'models');
  if (needsSearch) steps.push('search');
  steps.push('done');
  return steps;
}

/** True while at least one capability still needs the user. */
export function countRemainingGaps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
): number {
  return capabilities.filter((item) => needsAction(item, optOuts)).length;
}

/** Settings sidebar entries that carry the "needs setup" dot (same verdict). */
export function settingsAttentionItems(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
): SettingsMenuItem[] {
  const gaps = capabilities.filter((item) => needsAction(item, optOuts));
  const items: SettingsMenuItem[] = [];
  if (gaps.some((item) => isModelSlot(item.id))) items.push('model');
  if (gaps.some((item) => item.id === 'web_search')) items.push('webResearch');
  return items;
}
