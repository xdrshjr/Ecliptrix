import type { IntegrationId } from '@/lib/api/integrations';
import type { CapabilityId } from '@/lib/api/setupStatus';

/**
 * Wizard step groups (setup-wizard-full-capability-coverage §3.7). Pure data:
 * which integrations share a step, and which capabilities each one unlocks
 * (the contract test pins this to the backend registry fixture).
 */
export type IntegrationGroupId = 'voice' | 'generation' | 'media';

export const INTEGRATION_GROUPS: Record<IntegrationGroupId, readonly IntegrationId[]> = {
  voice: ['volcano_tts', 'volcano_asr', 'volcano_voice_clone'],
  generation: ['ark'],
  media: ['pexels', 'unsplash', 'freesound'],
};

/** Group order in the stepper and the checklist. */
export const INTEGRATION_GROUP_ORDER: readonly IntegrationGroupId[] = [
  'voice',
  'generation',
  'media',
];

/** Capabilities an integration unlocks. `ark` serves two of them (E5). */
export const INTEGRATION_CAPABILITIES: Record<IntegrationId, readonly CapabilityId[]> = {
  volcano_tts: ['tts'],
  volcano_asr: ['asr'],
  volcano_voice_clone: ['voice_clone'],
  ark: ['ai_image', 'ai_video'],
  pexels: ['video_library'],
  unsplash: ['image_library'],
  freesound: ['audio_library'],
};

export function groupOfCapability(capability: CapabilityId): IntegrationGroupId | null {
  for (const group of INTEGRATION_GROUP_ORDER) {
    const hit = INTEGRATION_GROUPS[group].some((id) =>
      INTEGRATION_CAPABILITIES[id].includes(capability),
    );
    if (hit) return group;
  }
  return null;
}

export function groupOfIntegration(id: IntegrationId): IntegrationGroupId {
  const group = INTEGRATION_GROUP_ORDER.find((candidate) =>
    INTEGRATION_GROUPS[candidate].includes(id),
  );
  if (!group) throw new Error(`integration ${id} is not in any wizard group`);
  return group;
}

/** Display grouping of EVERY capability for the overview checklist. */
export type ChecklistGroupId = 'models' | IntegrationGroupId | 'search';

export function checklistGroupOf(capability: CapabilityId): ChecklistGroupId {
  if (capability === 'web_search') return 'search';
  return groupOfCapability(capability) ?? 'models';
}

export const CHECKLIST_GROUP_ORDER: readonly ChecklistGroupId[] = [
  'models',
  'voice',
  'generation',
  'media',
  'search',
];
