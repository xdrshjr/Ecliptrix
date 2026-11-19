import { http } from '@/lib/api/http-client';

export type CapabilityId =
  | 'chat'
  | 'fast'
  | 'video_cut'
  | 'vision'
  | 'research'
  | 'web_search'
  | 'tts'
  | 'asr'
  | 'voice_clone'
  | 'ai_image'
  | 'ai_video'
  | 'video_library'
  | 'image_library'
  | 'audio_library';

/** Capabilities the user may knowingly decline (everything but the 4 model slots). */
export const EXTENDED_CAPABILITIES: readonly CapabilityId[] = [
  'research',
  'web_search',
  'tts',
  'asr',
  'voice_clone',
  'ai_image',
  'ai_video',
  'video_library',
  'image_library',
  'audio_library',
];
export type CapabilityState =
  | 'ready'
  | 'inherited'
  | 'missing'
  | 'invalid'
  /** Served by the AI relay, but the relay reports the capability as off. */
  | 'unavailable'
  | 'indeterminate';
export type CapabilitySource = 'database' | 'environment' | 'inherited' | 'router' | 'none';

const KNOWN_STATES: readonly CapabilityState[] = [
  'ready',
  'inherited',
  'missing',
  'invalid',
  'unavailable',
  'indeterminate',
];
const KNOWN_SOURCES: readonly CapabilitySource[] = [
  'database',
  'environment',
  'inherited',
  'router',
  'none',
];

/**
 * Forward compatibility (spec RV-05): a value this build does not know must
 * not crash the UI or raise a gap. An unknown state degrades to
 * `indeterminate` and an unknown source to `none` — both fail-open.
 */
function normalizeState(value: unknown): CapabilityState {
  return KNOWN_STATES.includes(value as CapabilityState)
    ? (value as CapabilityState)
    : 'indeterminate';
}

function normalizeSource(value: unknown): CapabilitySource {
  return KNOWN_SOURCES.includes(value as CapabilitySource)
    ? (value as CapabilitySource)
    : 'none';
}

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
    state: normalizeState(item.state),
    source: normalizeSource(item.source),
    providerName: item.provider_name ?? undefined,
    modelName: item.model_name ?? undefined,
    inheritedFrom: item.inherited_from ?? undefined,
  }));
}

/**
 * A capability that still needs the user (missing / invalid / switched off at
 * the relay). Any other value — including ones this build has never seen —
 * is not a gap (fail-open).
 */
export function isGap(capability: CapabilityStatus): boolean {
  return (
    capability.state === 'missing' ||
    capability.state === 'invalid' ||
    capability.state === 'unavailable'
  );
}
