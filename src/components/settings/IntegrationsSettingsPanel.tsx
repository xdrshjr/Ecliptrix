'use client';

import React, { useCallback, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { IntegrationStatus } from '@/lib/api/integrations';
import { notifySetupConfigUpdated } from '@/lib/setupEvents';
import { readOptOuts, removeOptOut } from '@/lib/setupOptOut';
import IntegrationCard from '@/components/integrations/IntegrationCard';
import { useIntegrations } from '@/components/integrations/useIntegrations';
import {
  INTEGRATION_GROUPS,
  INTEGRATION_GROUP_ORDER,
} from '@/components/Onboarding/wizard/integrationGroups';
import { BUTTON_GHOST, TEXT_LINK } from '@/components/Onboarding/wizard/wizardStyles';

interface IntegrationsSettingsPanelProps {
  /** Jump to the Web search panel, where the Tavily keys are managed. */
  onOpenWebResearch?: () => void;
}

const CARD_CLASS = 'rounded-lg border border-border bg-card p-6';

interface OptedOutNoticeProps {
  onReenable: () => void;
}

/** Shown above a card whose reminders were switched off in the wizard. */
const OptedOutNotice: React.FC<OptedOutNoticeProps> = ({ onReenable }) => {
  const copy = useLocale().t.integrations;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      <span>{copy.panel.notUsing}</span>
      <button type="button" onClick={onReenable} className={BUTTON_GHOST}>
        {copy.action.reenable}
      </button>
    </div>
  );
};

/**
 * Settings → Services & libraries. Renders the SAME {@link IntegrationCard}
 * the setup wizard uses, always editable, so whatever the wizard saved shows
 * up here field for field (secrets only as "saved").
 */
const IntegrationsSettingsPanel: React.FC<IntegrationsSettingsPanelProps> = ({
  onOpenWebResearch,
}) => {
  const { t } = useLocale();
  const copy = t.integrations;
  const { integrations, loadState, reload } = useIntegrations();
  const [optOuts, setOptOuts] = useState(() => readOptOuts());

  const reenable = useCallback((integration: IntegrationStatus) => {
    integration.capabilities.forEach((id) => removeOptOut(id));
    setOptOuts(readOptOuts());
    notifySetupConfigUpdated();
  }, []);

  const isMuted = (integration: IntegrationStatus) =>
    !integration.usable && integration.capabilities.every((id) => optOuts.includes(id));

  return (
    <div className="h-full min-w-0 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto min-w-0 max-w-3xl space-y-6 p-4 sm:p-8 motion-reduce:[&_*]:!transition-none">
        <header>
          <h2 className="text-xl font-semibold">{t.adminSettings.integrationsSettings}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {copy.panel.description} {copy.hint.priority}
          </p>
        </header>

        {loadState === 'loading' && (
          <p role="status" className="text-sm text-muted-foreground">
            {copy.panel.loading}
          </p>
        )}
        {loadState === 'error' && (
          <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
            {copy.panel.loadFailed}
            <button type="button" onClick={() => void reload()} className={TEXT_LINK}>
              {copy.panel.retry}
            </button>
          </div>
        )}

        {INTEGRATION_GROUP_ORDER.map((group) => {
          const items = INTEGRATION_GROUPS[group]
            .map((id) => integrations.find((candidate) => candidate.id === id))
            .filter((item): item is IntegrationStatus => item !== undefined);
          if (items.length === 0) return null;
          return (
            <section key={group} aria-label={t.setupWizard.group[group].title} className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {t.setupWizard.group[group].title}
              </h3>
              {items.map((item) => (
                <div key={item.id} className={CARD_CLASS}>
                  {isMuted(item) && (
                    <OptedOutNotice onReenable={() => reenable(item)} />
                  )}
                  <IntegrationCard integration={item} onChanged={reload} showHeader allowClear />
                </div>
              ))}
            </section>
          );
        })}

        {onOpenWebResearch && (
          <section className={CARD_CLASS}>
            <p className="text-sm text-muted-foreground">{copy.panel.tavilyNote}</p>
            <button type="button" onClick={onOpenWebResearch} className={`mt-2 ${TEXT_LINK}`}>
              {copy.panel.openWebSearch}
            </button>
          </section>
        )}
      </div>
    </div>
  );
};

export default IntegrationsSettingsPanel;
