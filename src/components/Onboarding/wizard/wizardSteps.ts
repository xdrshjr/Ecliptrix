import { isGap, type CapabilityId, type CapabilityStatus } from '@/lib/api/setupStatus';
import type { WizardSlot } from '@/lib/api/modelSettings';
import type { SettingsMenuItem } from '@/components/settings/SettingsSidebar';
import { MANUAL_ONLY_CAPABILITIES, type ModeState } from '@/lib/api/skillrouter';
import type { SetupWizardFocus } from '@/lib/setupEvents';
import {
  INTEGRATION_GROUP_ORDER,
  groupOfCapability,
  type IntegrationGroupId,
} from './integrationGroups';

export type WizardStepId =
  | 'overview'
  | 'source'
  | 'router'
  | 'routerModels'
  | 'manualOnly'
  | 'provider'
  | 'models'
  | IntegrationGroupId
  | 'search'
  | 'done';
export type WizardMode = 'auto' | 'manual';

/** Persisted capability-source mode; `unset` = the user never chose one. */
export type SourceModeState = ModeState;
/** What the source step offers; `unset` is never a choice. */
export type SourceChoice = 'router' | 'manual';

/**
 * Capability-source inputs of {@link deriveWizardSteps}. Omitting them keeps the
 * pre-SkillRouter step list byte-for-byte (no source step, manual branch).
 */
export interface WizardSourceOptions {
  sourceMode: SourceModeState;
  /** The card currently picked on the source step (drives the branch). */
  choice: SourceChoice;
  focus?: SetupWizardFocus;
}

function isManualOnly(id: CapabilityId): boolean {
  return (MANUAL_ONLY_CAPABILITIES as readonly string[]).includes(id);
}

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
 * Integration group steps for this run: a group appears when one of its
 * capabilities needs the user, or (`showAll`) when the backend knows any of
 * them, so a manual re-run can revisit everything that exists.
 */
function integrationSteps(
  capabilities: readonly CapabilityStatus[],
  gaps: readonly CapabilityStatus[],
  showAll: boolean,
): IntegrationGroupId[] {
  return INTEGRATION_GROUP_ORDER.filter((group) => {
    const pool = showAll ? capabilities : gaps;
    return pool.some((item) => groupOfCapability(item.id) === group);
  });
}

/** The manual-branch step list (the whole wizard before SkillRouter existed). */
function manualSteps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
  mode: WizardMode,
  showAll: boolean,
): WizardStepId[] {
  const steps: WizardStepId[] = ['overview'];
  const gaps = capabilities.filter((item) => needsAction(item, optOuts));
  const needsModels =
    mode === 'manual' || gaps.some((item) => isModelSlot(item.id));
  const needsSearch = showAll || gaps.some((item) => item.id === 'web_search');
  if (needsModels) steps.push('provider', 'models');
  steps.push(...integrationSteps(capabilities, gaps, showAll));
  if (needsSearch) steps.push('search');
  steps.push('done');
  return steps;
}

/**
 * The router-branch tail. While the user is still choosing (source step shown)
 * it is the full path; when the router is already the saved source it only
 * lists what is actually broken, so a healthy install never revisits the key.
 */
function routerSteps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
  isChoosing: boolean,
): WizardStepId[] {
  const gaps = capabilities.filter((item) => needsAction(item, optOuts));
  const routedGap = gaps.some((item) => !isManualOnly(item.id));
  const modelGap = gaps.some((item) => isModelSlot(item.id));
  const manualOnlyGap = gaps.some((item) => isManualOnly(item.id));
  const steps: WizardStepId[] = [];
  if (isChoosing || routedGap) steps.push('router');
  if (isChoosing || routedGap || modelGap) steps.push('routerModels');
  if (manualOnlyGap) steps.push('manualOnly');
  return steps;
}

function isIntegrationFocus(focus: SetupWizardFocus | undefined): boolean {
  return focus !== undefined && focus !== 'skillrouter';
}

/**
 * The source step shows on a first install with a gap, on a manual re-run, and
 * when a "configure the router" button opened the wizard; never when a button
 * pointed at one specific manual integration.
 */
function shouldShowSource(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
  mode: WizardMode,
  source: WizardSourceOptions,
): boolean {
  if (isIntegrationFocus(source.focus)) return false;
  if (source.focus === 'skillrouter' || mode === 'manual') return true;
  return (
    source.sourceMode === 'unset' &&
    capabilities.some((item) => needsAction(item, optOuts))
  );
}

/**
 * Ordered steps for this run. Manual branch: overview → provider → models →
 * voice → generation → media → search → done. Router branch: overview →
 * router → routerModels → manualOnly → done. A leading `source` step offers
 * the choice (see {@link shouldShowSource}). Derived when the wizard opens and
 * then frozen: writes refetch the status, and a shrinking list would make the
 * stepper jump under the user's feet. The exceptions are the user's own "only
 * set up models" choice (`showAll = false`) and flipping the source card.
 */
export function deriveWizardSteps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
  mode: WizardMode,
  showAll: boolean = mode === 'manual',
  source?: WizardSourceOptions,
): WizardStepId[] {
  if (!source) return manualSteps(capabilities, optOuts, mode, showAll);
  const hasSource = shouldShowSource(capabilities, optOuts, mode, source);
  const isRouter = isIntegrationFocus(source.focus)
    ? false
    : hasSource
      ? source.choice === 'router'
      : source.sourceMode === 'router';
  if (!isRouter) {
    const steps = manualSteps(capabilities, optOuts, mode, showAll);
    return hasSource ? [steps[0], 'source', ...steps.slice(1)] : steps;
  }
  const tail = routerSteps(capabilities, optOuts, hasSource);
  return ['overview', ...(hasSource ? (['source'] as const) : []), ...tail, 'done'];
}

/** True while at least one capability still needs the user. */
export function countRemainingGaps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
): number {
  return capabilities.filter((item) => needsAction(item, optOuts)).length;
}

/** Optional (extended) capabilities still waiting for the user. */
export function countOptionalGaps(
  capabilities: readonly CapabilityStatus[],
  optOuts: readonly CapabilityId[],
): number {
  return capabilities.filter(
    (item) => item.tier === 'extended' && needsAction(item, optOuts),
  ).length;
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
  if (gaps.some((item) => groupOfCapability(item.id) !== null)) items.push('integrations');
  if (gaps.some((item) => item.state === 'unavailable' || item.source === 'router')) {
    items.push('skillrouter');
  }
  return items;
}
