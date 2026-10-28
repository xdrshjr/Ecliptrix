import { http } from '@/lib/api/http-client';

export type CapabilityId =
  | 'chat'
  | 'fast'
  | 'video_cut'
  | 'vision'
  | 'research'
  | 'web_search';
export type CapabilityState =
  | 'ready'
  | 'inherited'
  | 'missing'
  | 'invalid'
  | 'indeterminate';
export type CapabilitySource = 'database' | 'environment' | 'inherited' | 'none';

export interface CapabilityStatus {
  id: CapabilityId;
  tier: 'core' | 'extended';
  state: CapabilityState;
  source: CapabilitySource;
  providerName?: string;
  modelName?: string;
  inheritedFrom?: CapabilityId;
}

interface WireCapability {
  id: CapabilityId;
  tier: 'core' | 'extended';
  state: CapabilityState;
  source?: CapabilitySource;
  provider_name?: string | null;
  model_name?: string | null;
  inherited_from?: CapabilityId | null;
}

interface CapabilityStatusResponse {
  success?: boolean;
  data?: { capabilities?: WireCapability[] };
}

/**
 * Fetch per-capability readiness. Throws when the backend reports a resolver
 * fault (`success !== true`) so callers can treat it as "unknown" (fail-open).
 */
export async function fetchCapabilityStatus(): Promise<CapabilityStatus[]> {
  const body = await http.get<CapabilityStatusResponse>(
    '/api/config/capability-status',
    { timeoutMs: 5000 },
  );
  if (body?.success !== true || !Array.isArray(body.data?.capabilities)) {
    throw new Error('capability_status_unavailable');
  }
  return body.data.capabilities.map((item) => ({
    id: item.id,
    tier: item.tier,
    state: item.state,
    source: item.source ?? 'none',
    providerName: item.provider_name ?? undefined,
    modelName: item.model_name ?? undefined,
    inheritedFrom: item.inherited_from ?? undefined,
  }));
}

/** A capability that still needs the user (missing / invalid). */
export function isGap(capability: CapabilityStatus): boolean {
  return capability.state === 'missing' || capability.state === 'invalid';
}
