import { ApiError } from '@/lib/api/http-client';
import {
  createProvider,
  updateProvider,
  type FetchModelsResult,
  type ProviderInput,
  type SavedProvider,
} from '@/lib/api/modelSettings';

/**
 * Result of probing a provider's `/models` endpoint.
 *  - ok:          credentials work, model list available
 *  - unverified:  no usable list (provider has no /models, or unclassifiable
 *                 failure) — the user may continue by typing a model name
 *  - keyInvalid:  explicit auth rejection
 *  - unreachable: transport-level failure
 */
export type VerifyOutcome =
  | { kind: 'ok'; models: string[] }
  | { kind: 'unverified' }
  | { kind: 'keyInvalid' }
  | { kind: 'unreachable' };

const AUTH_FAILURE =
  /\b(401|403)\b|unauthori[sz]ed|forbidden|authentication|invalid[_ -]?api[_ -]?key|incorrect api key/i;
const TRANSPORT_FAILURE = /^(request timed out|failed:)/i;

/**
 * `fetch-models` reports failure as free text with NO status code (F12), so
 * classification is pattern-based and conservative: only an explicit auth
 * rejection blocks; everything else the user can still proceed from, because
 * the final key check happens when the chat model is saved.
 */
export function classifyFetchModels(result: FetchModelsResult): VerifyOutcome {
  if (result.success) {
    return result.models.length > 0
      ? { kind: 'ok', models: result.models }
      : { kind: 'unverified' };
  }
  const message = result.message ?? '';
  if (AUTH_FAILURE.test(message)) return { kind: 'keyInvalid' };
  if (TRANSPORT_FAILURE.test(message)) return { kind: 'unreachable' };
  return { kind: 'unverified' };
}

/** A thrown error: a 4xx is "can't verify"; anything else is transport. */
export function classifyFetchModelsError(error: unknown): VerifyOutcome {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return { kind: 'unverified' };
  }
  return { kind: 'unreachable' };
}

function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && /already exists/i.test(error.message);
}

export interface PersistProviderArgs {
  /** Present once this wizard run (or a saved choice) created the provider. */
  providerId: string | null;
  input: ProviderInput;
  /** False → send '__KEEP__' so the stored key survives (settings contract). */
  keyChanged: boolean;
}

/**
 * Write the provider through the same endpoints as the settings page.
 * An existing id always means PUT — never a second POST — so stepping back to
 * retype a key cannot leave an orphan provider behind (RV-04).
 */
export async function persistProvider(
  args: PersistProviderArgs,
): Promise<SavedProvider> {
  const { providerId, input, keyChanged } = args;
  if (providerId) {
    return updateProvider(providerId, {
      ...input,
      api_key: keyChanged ? input.api_key : '__KEEP__',
    });
  }
  try {
    return await createProvider(input);
  } catch (error) {
    if (!isDuplicateName(error)) throw error;
    return createProvider({ ...input, name: `${input.name} 2` });
  }
}
