import { notConfiguredIntegration, type IntegrationId } from '@/lib/api/integrations';

/**
 * Raised (as a DOM event) when a feature fails because its credentials are not
 * configured. Call sites that only have a thrown error and no JSX to hang a
 * button on (services, hooks, toasts) report it here; `CredentialMissingListener`
 * turns it into a "go configure" prompt. See spec §3.9.
 */
export const CREDENTIAL_MISSING_EVENT = 'ecliptrix-credential-missing';

export interface CredentialMissingDetail {
  integrationId: IntegrationId;
}

/**
 * If `error` means "credentials missing", announce it and return true so the
 * caller can skip its generic failure toast. Any other error returns false.
 */
export function reportCredentialMissing(error: unknown): boolean {
  const integrationId = notConfiguredIntegration(error);
  if (!integrationId || typeof window === 'undefined') return false;
  window.dispatchEvent(
    new CustomEvent<CredentialMissingDetail>(CREDENTIAL_MISSING_EVENT, {
      detail: { integrationId },
    }),
  );
  return true;
}
