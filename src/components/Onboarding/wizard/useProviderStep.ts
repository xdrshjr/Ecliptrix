'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchModels,
  fetchSavedProviderModels,
  listKnownProviders,
  listSavedProviders,
  type KnownProvider,
  type SavedProvider,
} from '@/lib/api/modelSettings';
import {
  classifyFetchModels,
  classifyFetchModelsError,
  persistProvider,
  type VerifyOutcome,
} from './providerFlow';
import { isPlaceholderKey } from './modelHints';

export const CUSTOM_PROVIDER_ID = 'custom';

export interface ProviderDraft {
  knownId: string;
  name: string;
  apiUrl: string;
  apiFormat: string;
  /** Plaintext key. Lives only here; cleared the moment the provider is saved. */
  apiKey: string;
}

export type ProviderError =
  | { code: 'keyRequired' | 'keyPlaceholder' | 'keyInvalid' | 'unreachable' }
  | { code: 'generic'; detail: string };

const EMPTY_DRAFT: ProviderDraft = {
  knownId: '',
  name: '',
  apiUrl: '',
  apiFormat: 'auto',
  apiKey: '',
};

function newestFirst(saved: SavedProvider[]): SavedProvider[] {
  return [...saved].sort((a, b) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );
}

/** Provider selection + key entry + verify-and-persist (wizard step 1). */
export function useProviderStep(onVerified: () => void) {
  const [known, setKnown] = useState<KnownProvider[]>([]);
  const [saved, setSaved] = useState<SavedProvider[]>([]);
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT);
  const [providerId, setProviderId] = useState<string | null>(null);
  // Preset whose key the server already holds. Switching to another preset
  // must ask for a key again, or the old key would be sent to the new service.
  const [storedKeyKnownId, setStoredKeyKnownId] = useState<string | null>(null);
  const [reusingSaved, setReusingSaved] = useState<SavedProvider | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<ProviderError | null>(null);
  const [canSkipVerify, setCanSkipVerify] = useState(false);
  const preselectedRef = useRef(false);

  const pickSaved = useCallback((provider: SavedProvider) => {
    setReusingSaved(provider);
    setProviderId(provider.id);
    setStoredKeyKnownId(provider.provider_type);
    setDraft((prev) => ({ ...prev, knownId: provider.provider_type, apiKey: '' }));
    setError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([listKnownProviders(), listSavedProviders()]).then(
      ([knownResult, savedResult]) => {
        if (cancelled) return;
        if (knownResult.status === 'fulfilled') setKnown(knownResult.value);
        if (savedResult.status !== 'fulfilled') return;
        const ordered = newestFirst(savedResult.value);
        setSaved(ordered);
        if (ordered.length > 0 && !preselectedRef.current) {
          preselectedRef.current = true;
          pickSaved(ordered[0]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pickSaved]);

  const pickKnown = useCallback(
    (id: string) => {
      const preset = known.find((item) => item.id === id);
      // A saved provider belongs to the user — never morph it into another one.
      if (reusingSaved) {
        setReusingSaved(null);
        setProviderId(null);
      }
      setDraft((prev) => ({
        ...prev,
        knownId: id,
        name: preset?.name ?? 'Custom',
        apiUrl: preset?.default_api_url ?? '',
        apiFormat: preset?.api_format ?? 'openai',
      }));
      setError(null);
      setCanSkipVerify(false);
    },
    [known, reusingSaved],
  );

  const editDraft = useCallback((patch: Partial<ProviderDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setError(null);
    setCanSkipVerify(false);
  }, []);

  const probe = useCallback(
    async (apiKey: string): Promise<VerifyOutcome> => {
      try {
        const result = apiKey
          ? await fetchModels({
              api_url: draft.apiUrl,
              api_key: apiKey,
              provider_type: draft.knownId || CUSTOM_PROVIDER_ID,
            })
          : await fetchSavedProviderModels(providerId ?? '');
        return classifyFetchModels(result);
      } catch (thrown) {
        return classifyFetchModelsError(thrown);
      }
    },
    [draft.apiUrl, draft.knownId, providerId],
  );

  /**
   * A saved provider the user merely picked is left untouched; anything this
   * wizard created is updated in place (PUT) so edits never spawn a duplicate.
   */
  const saveIfNeeded = useCallback(
    async (apiKey: string): Promise<string> => {
      if (!apiKey && providerId && reusingSaved) return providerId;
      const provider = await persistProvider({
        providerId,
        keyChanged: apiKey !== '',
        input: {
          name: draft.name || 'Custom',
          provider_type: draft.knownId || CUSTOM_PROVIDER_ID,
          api_url: draft.apiUrl,
          api_key: apiKey,
          api_format: draft.apiFormat,
        },
      });
      setProviderId(provider.id);
      setStoredKeyKnownId(draft.knownId);
      return provider.id;
    },
    [draft, providerId, reusingSaved],
  );

  const hasStoredKey = providerId !== null && storedKeyKnownId === draft.knownId;

  const verify = useCallback(
    async (skipVerification = false) => {
      const apiKey = draft.apiKey.trim();
      const usingStoredKey = !apiKey && hasStoredKey;
      if (!apiKey && !usingStoredKey) return setError({ code: 'keyRequired' });
      if (isPlaceholderKey(apiKey)) return setError({ code: 'keyPlaceholder' });
      setVerifying(true);
      setError(null);
      try {
        const outcome: VerifyOutcome = skipVerification
          ? { kind: 'unverified' }
          : await probe(apiKey);
        if (outcome.kind === 'keyInvalid' || outcome.kind === 'unreachable') {
          setError({ code: outcome.kind });
          setCanSkipVerify(outcome.kind === 'unreachable');
          return;
        }
        await saveIfNeeded(apiKey);
        const found = outcome.kind === 'ok' ? outcome.models : [];
        setModels(found);
        setDraft((prev) => ({ ...prev, apiKey: '' }));
        onVerified();
      } catch (thrown) {
        setError({
          code: 'generic',
          detail: thrown instanceof Error ? thrown.message : String(thrown),
        });
      } finally {
        setVerifying(false);
      }
    },
    [draft.apiKey, hasStoredKey, probe, saveIfNeeded, onVerified],
  );

  return {
    known,
    saved,
    draft,
    providerId,
    hasStoredKey,
    reusingSaved,
    models,
    verifying,
    error,
    canSkipVerify,
    hasKeyDraft: draft.apiKey !== '',
    pickKnown,
    pickSaved,
    editDraft,
    verify,
  };
}
