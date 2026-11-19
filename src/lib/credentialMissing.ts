import { notConfiguredIntegration } from '@/lib/api/integrations';
import { ApiError } from '@/lib/api/http-client';
import type { SetupWizardFocus } from '@/lib/setupEvents';

const ROUTER_INTEGRATION_ID = 'skillrouter';

/**
 * Where "go configure" should land for this failure: an integration card, the
 * SkillRouter step (a routed capability without a gateway key answers
 * `credential_not_configured` for `skillrouter`), or nowhere.
 */
export function notConfiguredTarget(error: unknown): SetupWizardFocus | null {
  const integrationId = notConfiguredIntegration(error);
  if (integrationId) return integrationId;
  const isRouterError =
    error instanceof ApiError &&
    error.code === 'credential_not_configured' &&
    error.details?.integration_id === ROUTER_INTEGRATION_ID;
  return isRouterError ? ROUTER_INTEGRATION_ID : null;
}

/**
 * Raised (as a DOM event) when a feature fails because its credentials are not
 * configured. Call sites that only have a thrown error and no JSX to hang a
 * button on (services, hooks, toasts) report it here; `CredentialMissingListener`
 * turns it into a "go configure" prompt. See spec §3.9.
 */
export const CREDENTIAL_MISSING_EVENT = 'ecliptrix-credential-missing';

export interface CredentialMissingDetail {
  integrationId: SetupWizardFocus;
}

/**
 * If `error` means "credentials missing", announce it and return true so the
 * caller can skip its generic failure toast. Any other error returns false.
 */
export function reportCredentialMissing(error: unknown): boolean {
  const integrationId = notConfiguredTarget(error);
  if (!integrationId || typeof window === 'undefined') return false;
  window.dispatchEvent(
    new CustomEvent<CredentialMissingDetail>(CREDENTIAL_MISSING_EVENT, {
      detail: { integrationId },
    }),
  );
  return true;
}
