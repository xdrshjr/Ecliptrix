'use client';

import { useEffect, useRef } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import {
  CREDENTIAL_MISSING_EVENT,
  type CredentialMissingDetail,
} from '@/lib/credentialMissing';
import { openSetupWizard } from '@/lib/setupEvents';

/** The same integration is not prompted again within this window (ms). */
const PROMPT_COOLDOWN_MS = 4000;

/**
 * Mounted once on the main page. Shows "<name> isn't set up yet" with a
 * "Go configure" action whenever a feature reports missing credentials, and
 * throttles repeats so a retry loop cannot stack identical toasts.
 */
const CredentialMissingListener: React.FC = () => {
  const { t } = useLocale();
  const { showConfirm } = useNotification();
  const lastShownRef = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    const handle = (event: Event) => {
      const { integrationId } = (event as CustomEvent<CredentialMissingDetail>).detail;
      const last = lastShownRef.current;
      const now = Date.now();
      if (last && last.id === integrationId && now - last.at < PROMPT_COOLDOWN_MS) return;
      lastShownRef.current = { id: integrationId, at: now };
      const copy = t.integrations;
      showConfirm(
        copy.cta.missing.replace('{name}', copy[integrationId].name),
        () => openSetupWizard(integrationId),
        { confirmLabel: copy.cta.configure },
      );
    };
    window.addEventListener(CREDENTIAL_MISSING_EVENT, handle);
    return () => window.removeEventListener(CREDENTIAL_MISSING_EVENT, handle);
  }, [showConfirm, t]);

  return null;
};

export default CredentialMissingListener;
