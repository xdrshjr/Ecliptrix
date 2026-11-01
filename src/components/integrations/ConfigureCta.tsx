'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { IntegrationId } from '@/lib/api/integrations';
import { openSetupWizard } from '@/lib/setupEvents';
import { TEXT_LINK } from '@/components/Onboarding/wizard/wizardStyles';

interface ConfigureCtaProps {
  integrationId: IntegrationId;
  className?: string;
}

/**
 * "Go configure" button for a failure caused by missing credentials. It opens
 * the setup wizard (manual mode) on that integration's card, which is what
 * makes choosing "not now" in the wizard a safe, reversible decision.
 */
const ConfigureCta: React.FC<ConfigureCtaProps> = ({ integrationId, className = '' }) => {
  const { t } = useLocale();
  const name = t.integrations[integrationId].name;
  return (
    <button
      type="button"
      onClick={() => openSetupWizard(integrationId)}
      aria-label={`${t.integrations.cta.configure}: ${name}`}
      className={`${TEXT_LINK} ${className}`}
    >
      {t.integrations.cta.configure}
    </button>
  );
};

export default ConfigureCta;
