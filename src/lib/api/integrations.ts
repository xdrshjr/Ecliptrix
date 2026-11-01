import { ApiError, http } from '@/lib/api/http-client';
import type { CapabilityId } from '@/lib/api/setupStatus';

/**
 * Typed client for `/api/integrations` (setup-wizard-full-capability-coverage
 * spec §5). Responses carry no secrets: a secret field only reports whether
 * it is configured (and a count for lists). The wizard and the settings page
 * share these four calls, so a value saved in one is the value shown in the
 * other.
 */

export type IntegrationId =
  | 'volcano_tts'
  | 'volcano_asr'
  | 'volcano_voice_clone'
  | 'ark'
  | 'pexels'
  | 'unsplash'
  | 'freesound';

export type FieldKind = 'secret' | 'secret_list' | 'text' | 'choice';
export type FieldSource = 'database' | 'environment' | 'default' | 'none';
export type VerifyLevel = 'free' | 'handshake' | 'billed_minimal' | 'none';
export type ProbeOutcome =
  | 'ok'
  | 'invalid_credentials'
  | 'not_entitled'
  | 'rate_limited'
  | 'unreachable'
  | 'upstream_error'
  | 'unverifiable';

export interface IntegrationFieldStatus {
  name: string;
  kind: FieldKind;
  required: boolean;
  configured: boolean;
  source: FieldSource;
  /** Only for `text` / `choice` fields; secrets are never echoed. */
  value?: string;
  choices?: string[];
  /** Only for `secret_list` fields: how many keys are configured. */
  count?: number;
  /** Only for `secret_list` fields, when the backend reports its limit. */
  maxItems?: number;
}

export interface IntegrationStatus {
  id: IntegrationId;
  capabilities: CapabilityId[];
  verifyLevel: VerifyLevel;
  usable: boolean;
  source: FieldSource;
  fields: IntegrationFieldStatus[];
}

export interface IntegrationList {
  integrations: IntegrationStatus[];
  loadFailed: boolean;
}

export interface ProbeResult {
  outcome: ProbeOutcome;
  verifyLevel: VerifyLevel;
  elapsedMs: number;
}

/** `string[]` for `secret_list`; `''` / `null` clears the field. */
export type FieldPatch = Record<string, string | string[] | null>;

interface WireField extends Omit<IntegrationFieldStatus, 'maxItems'> {
  max_items?: number;
}

interface WireIntegration
  extends Omit<IntegrationStatus, 'verifyLevel' | 'fields'> {
  verify_level: VerifyLevel;
  fields: WireField[];
}

interface Envelope<T> {
  success?: boolean;
  data?: T;
}

const BASE = '/api/integrations';

function fieldFromWire(field: WireField): IntegrationFieldStatus {
  const { max_items: maxItems, ...rest } = field;
  return maxItems === undefined ? rest : { ...rest, maxItems };
}

function fromWire(item: WireIntegration): IntegrationStatus {
  const { verify_level: verifyLevel, fields, ...rest } = item;
  return { ...rest, verifyLevel, fields: (fields ?? []).map(fieldFromWire) };
}

function requireData<T>(body: Envelope<T> | null): T {
  if (!body || body.success !== true || body.data == null) {
    throw new Error('integrations_unavailable');
  }
  return body.data;
}

/** Every integration's public status. */
export async function listIntegrations(): Promise<IntegrationList> {
  const body = await http.get<
    Envelope<{ integrations?: WireIntegration[]; load_failed?: boolean }>
  >(BASE, { timeoutMs: 5000 });
  const data = requireData(body);
  return {
    integrations: (data.integrations ?? []).map(fromWire),
    loadFailed: data.load_failed === true,
  };
}

/** Partial update: omitted fields are kept, `''` / `null` clears one. */
export async function saveIntegration(
  id: IntegrationId,
  fields: FieldPatch,
): Promise<IntegrationStatus> {
  const body = await http.put<Envelope<WireIntegration>>(
    `${BASE}/${id}`,
    { fields },
    { timeoutMs: 8000 },
  );
  return fromWire(requireData(body));
}

/**
 * Drop the in-app configuration (falls back to `.env`). DELETE has no body, so
 * the JSON content type the backend's origin check demands is set explicitly.
 */
export async function clearIntegration(id: IntegrationId): Promise<IntegrationStatus> {
  const body = await http.del<Envelope<WireIntegration>>(`${BASE}/${id}`, {
    headers: { 'Content-Type': 'application/json' },
    timeoutMs: 8000,
  });
  return fromWire(requireData(body));
}

/** Probe the SAVED configuration. `success` only means the probe ran. */
export async function testIntegration(id: IntegrationId): Promise<ProbeResult> {
  const body = await http.post<
    Envelope<{ outcome: ProbeOutcome; verify_level: VerifyLevel; elapsed_ms?: number }>
  >(`${BASE}/${id}/test`, {}, { timeoutMs: 20000 });
  const data = requireData(body);
  return {
    outcome: data.outcome,
    verifyLevel: data.verify_level,
    elapsedMs: data.elapsed_ms ?? 0,
  };
}

export type IntegrationSaveErrorKind =
  | 'placeholder'
  | 'malformed'
  | 'tooMany'
  | 'invalidChoice'
  | 'unknownField'
  | 'originForbidden'
  | 'required'
  | 'saveFailed';

export interface IntegrationSaveError {
  kind: IntegrationSaveErrorKind;
  field?: string;
}

const SAVE_ERROR_CODES: Record<string, IntegrationSaveErrorKind> = {
  credential_placeholder: 'placeholder',
  credential_malformed: 'malformed',
  too_many_values: 'tooMany',
  invalid_choice: 'invalidChoice',
  unknown_field: 'unknownField',
  origin_forbidden: 'originForbidden',
};

/** Map a rejected write to a locale-free kind (the UI owns the wording). */
export function classifyIntegrationError(error: unknown): IntegrationSaveError {
  if (!(error instanceof ApiError)) return { kind: 'saveFailed' };
  const kind = SAVE_ERROR_CODES[error.code] ?? 'saveFailed';
  const field = error.details?.field;
  return typeof field === 'string' ? { kind, field } : { kind };
}

/** The stable code the backend adds when a feature has no usable credentials. */
export const CREDENTIAL_NOT_CONFIGURED = 'credential_not_configured';

/**
 * TTS and subtitle recognition keep their pre-existing "not configured"
 * envelopes (the backend only appends `integration_id`), so those two codes
 * are aliases for their integration.
 */
const LEGACY_NOT_CONFIGURED: Record<string, IntegrationId> = {
  TTS_CONFIG_MISSING: 'volcano_tts',
  ASR_NOT_CONFIGURED: 'volcano_asr',
};

const INTEGRATION_IDS: readonly string[] = [
  'volcano_tts',
  'volcano_asr',
  'volcano_voice_clone',
  'ark',
  'pexels',
  'unsplash',
  'freesound',
];

/**
 * Which integration a "credentials missing" failure points at, or `null` for
 * any other error. Used to offer "go configure" for exactly that card (§3.9).
 */
export function notConfiguredIntegration(error: unknown): IntegrationId | null {
  if (!(error instanceof ApiError)) return null;
  const legacy = LEGACY_NOT_CONFIGURED[error.code];
  if (legacy) return legacy;
  if (error.code !== CREDENTIAL_NOT_CONFIGURED) return null;
  const id = error.details?.integration_id;
  return typeof id === 'string' && INTEGRATION_IDS.includes(id) ? (id as IntegrationId) : null;
}
