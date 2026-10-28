import { http } from '@/lib/api/http-client';

/**
 * Typed client for the model-provider endpoints. Endpoints and payloads are
 * deliberately field-for-field identical to the inline calls in
 * `ModelSettingsPanel` — the wizard and the settings page share ONE write path
 * (first-run-setup-wizard spec §3.5).
 */

export type WizardSlot = 'chat' | 'fast' | 'video_cut' | 'vision' | 'research';

export interface KnownProvider {
  id: string;
  name: string;
  default_api_url: string;
  region: string;
  api_format: string;
  default_models: string[];
}

export interface SavedProvider {
  id: string;
  name: string;
  provider_type: string;
  api_url: string;
  api_key_masked: string;
  api_key_set: boolean;
  api_format: string;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProviderInput {
  name: string;
  provider_type: string;
  api_url: string;
  api_key: string;
  api_format: string;
}

export interface FetchModelsResult {
  success: boolean;
  models: string[];
  message?: string;
}

interface MutationResponse {
  success: boolean;
  message?: string;
  detail?: string;
  provider?: SavedProvider;
}

/** Same defaults the settings page uses per slot. */
export const SLOT_TEMPERATURE: Record<WizardSlot, number> = {
  chat: 0.7,
  fast: 0.7,
  video_cut: 0.7,
  vision: 0.7,
  research: 0.2,
};

export async function listKnownProviders(): Promise<KnownProvider[]> {
  const body = await http.get<{ providers?: KnownProvider[] }>(
    '/api/model-settings/providers',
  );
  return body.providers ?? [];
}

export async function listSavedProviders(): Promise<SavedProvider[]> {
  const body = await http.get<{ providers?: SavedProvider[] }>(
    '/api/model-settings/providers/saved',
  );
  return body.providers ?? [];
}

/** Probe `/models` with temporary credentials; nothing is persisted. */
export function fetchModels(input: {
  api_url: string;
  api_key: string;
  provider_type: string;
}): Promise<FetchModelsResult> {
  return http.post<FetchModelsResult>('/api/model-settings/fetch-models', input);
}

/** Same probe, but with the key already stored for `providerId`. */
export function fetchSavedProviderModels(
  providerId: string,
): Promise<FetchModelsResult> {
  return http.post<FetchModelsResult>(
    `/api/model-settings/providers/${providerId}/fetch-models`,
  );
}

export async function createProvider(input: ProviderInput): Promise<SavedProvider> {
  const body = await http.post<MutationResponse>(
    '/api/model-settings/providers',
    input,
  );
  return requireProvider(body);
}

/** `api_key: '__KEEP__'` preserves the stored key (settings-page contract). */
export async function updateProvider(
  providerId: string,
  input: ProviderInput,
): Promise<SavedProvider> {
  const body = await http.put<MutationResponse>(
    `/api/model-settings/providers/${providerId}`,
    input,
  );
  return requireProvider(body);
}

export async function saveAssignment(input: {
  function_type: WizardSlot;
  provider_id: string;
  model_name: string;
}): Promise<void> {
  const body = await http.put<MutationResponse>('/api/model-settings/assignments', {
    ...input,
    temperature: SLOT_TEMPERATURE[input.function_type],
    max_tokens: 128000,
  });
  if (!body.success) {
    throw new Error(body.detail || body.message || 'assignment_failed');
  }
}

function requireProvider(body: MutationResponse): SavedProvider {
  if (!body.success || !body.provider) {
    throw new Error(body.detail || body.message || 'provider_failed');
  }
  return body.provider;
}
