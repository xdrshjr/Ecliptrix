import type { CapabilityId } from '@/lib/api/setupStatus';
import {
  ROUTED_CAPABILITIES,
  getSkillRouter,
  updateSkillRouter,
  type RoutedCapabilityId,
} from '@/lib/api/skillrouter';

function isRoutedCapability(id: CapabilityId): id is RoutedCapabilityId {
  return (ROUTED_CAPABILITIES as readonly string[]).includes(id);
}

/**
 * "Use my own setup for this": adds `capability` to the relay's manual list.
 * The status is re-read first so a stale screen cannot drop an override that
 * was added elsewhere. Nothing else is touched (spec D1: the overlay never
 * rewrites manual configuration).
 *
 * @throws The client's `ApiError` when the write is refused or unreachable.
 */
export async function switchCapabilityToOwn(capability: CapabilityId): Promise<void> {
  if (!isRoutedCapability(capability)) return;
  const { manualCapabilities } = await getSkillRouter();
  await updateSkillRouter({
    manualCapabilities: ROUTED_CAPABILITIES.filter(
      (id) => id === capability || manualCapabilities.includes(id),
    ),
  });
}
