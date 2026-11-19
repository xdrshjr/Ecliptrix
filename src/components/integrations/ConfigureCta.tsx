'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { openSetupWizard, type SetupWizardFocus } from '@/lib/setupEvents';
import { TEXT_LINK } from '@/components/Onboarding/wizard/wizardStyles';

interface ConfigureCtaProps {
  /** An integration card, or `skillrouter` for the AI relay step. */
  integrationId: SetupWizardFocus;
  className?: string;
}

/**
 * "Go configure" button for a failure caused by missing credentials. It opens
 * the setup wizard (manual mode) on that integration's card (or, for a routed
 * capability without a gateway key, on the SkillRouter step), which is what
 * makes choosing "not now" in the wizard a safe, reversible decision.
 */
const ConfigureCta: React.FC<ConfigureCtaProps> = ({ integrationId, className = '' }) => {
  const { t } = useLocale();
  const name =
    integrationId === 'skillrouter'
      ? t.setupWizard.routerStep.name
      : t.integrations[integrationId].name;
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
