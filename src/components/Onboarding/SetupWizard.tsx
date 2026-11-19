'use client';

import React, { useCallback, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import Modal from '@/components/ui/Modal';
import type { SettingsMenuItem } from '@/components/settings/SettingsSidebar';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import { openSetupWizard, type SetupWizardFocus } from '@/lib/setupEvents';
import DoneStep from './wizard/DoneStep';
import IntegrationGroupStep from './wizard/IntegrationGroupStep';
import ManualOnlyStep from './wizard/ManualOnlyStep';
import ModelsStep from './wizard/ModelsStep';
import OverviewStep from './wizard/OverviewStep';
import ProviderStep from './wizard/ProviderStep';
import RouterModelsStep from './wizard/RouterModelsStep';
import RouterStep from './wizard/RouterStep';
import SearchStep from './wizard/SearchStep';
import SourceStep from './wizard/SourceStep';
import WizardStepper from './wizard/WizardStepper';
import { useSetupWizard } from './wizard/useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY } from './wizard/wizardStyles';
import {
  INTEGRATION_GROUP_ORDER,
  integrationOfCapability,
} from './wizard/integrationGroups';
import { switchCapabilityToOwn } from './wizard/switchCapabilityToOwn';
import type { SourceModeState, WizardMode } from './wizard/wizardSteps';

export interface SetupWizardProps {
  /** `auto`: startup gap-filler. `manual`: re-run from Settings (all capabilities). */
  mode: WizardMode;
  /** Live status; the wizard reads it for the checklist and the done page. */
  capabilities: CapabilityStatus[];
  optOuts: CapabilityId[];
  /** `later` → the page remembers a session-level dismiss (auto mode only). */
  onClose: (reason: 'finished' | 'later') => void;
  onOpenSettings: (item: SettingsMenuItem) => void;
  /** Manual re-run from a "go configure" button: open on this card or step. */
  focus?: SetupWizardFocus;
  /**
   * Saved capability source (`SetupWizardHost` reads it). Omitted = the wizard
   * as it was before the relay existed: no source step, manual steps only.
   */
  sourceMode?: SourceModeState;
}

/**
 * First-run setup wizard. Mounted only while active, so every open starts from
 * a clean state. Focus trap / Esc / focus restoration come from ui/Modal; the
 * backdrop never closes it, so a freshly pasted key cannot be lost to a misclick.
 */
const SetupWizard: React.FC<SetupWizardProps> = ({
  mode,
  capabilities,
  optOuts,
  onClose,
  onOpenSettings,
  focus,
  sourceMode,
}) => {
  const copy = useLocale().t.setupWizard;
  const wizard = useSetupWizard({ capabilities, optOuts, mode, focus, sourceMode });
  const [confirmingClose, setConfirmingClose] = useState(false);

  // Esc and "later" both land here. Unsubmitted input asks first (inline bar,
  // not a nested dialog) because Modal gives no way to veto Esc.
  const requestClose = useCallback(() => {
    if (wizard.hasDraft && !confirmingClose) {
      setConfirmingClose(true);
      return;
    }
    onClose('later');
  }, [wizard.hasDraft, confirmingClose, onClose]);

  const openModelSettings = () => onOpenSettings('model');

  /**
   * The relay switched a capability off: move it to the user's own setup, then
   * land where that setup lives (its integration card, or the model settings).
   */
  const handleUseOwnConfig = async (capability: CapabilityId) => {
    await switchCapabilityToOwn(capability);
    const integration = integrationOfCapability(capability);
    if (integration) openSetupWizard(integration);
    else if (capability !== 'web_search') openModelSettings();
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      closeOnBackdrop={false}
      labelledBy="setup-wizard-title"
      describedBy="setup-wizard-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      contentClassName="flex max-h-[88vh] w-[min(720px,94vw)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl sm:flex-row"
    >
      <aside className="flex-shrink-0 border-b border-border bg-muted/30 p-5 sm:w-52 sm:border-b-0 sm:border-r sm:p-6">
        <WizardStepper steps={wizard.steps} stepIndex={wizard.stepIndex} onGoTo={wizard.goTo} />
      </aside>

      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6 sm:p-8">
        {confirmingClose && (
          <div
            role="alert"
            className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
          >
            <span>{copy.discardPrompt}</span>
            <span className="flex gap-2">
              <button type="button" onClick={() => setConfirmingClose(false)} className={BUTTON_PRIMARY}>
                {copy.keepEditing}
              </button>
              <button type="button" onClick={() => onClose('later')} className={BUTTON_GHOST}>
                {copy.discard}
              </button>
            </span>
          </div>
        )}

        <div
          key={wizard.current}
          className="animate-in fade-in slide-in-from-bottom-2 duration-150 motion-reduce:animate-none"
        >
          {wizard.current === 'overview' && (
            <OverviewStep
              capabilities={capabilities}
              optOuts={wizard.optOuts}
              mode={mode}
              onStart={wizard.goNext}
              onLater={requestClose}
              onOpenModelSettings={openModelSettings}
              onSkipOptional={wizard.skipOptional}
              onUseOwnConfig={handleUseOwnConfig}
            />
          )}
          {wizard.current === 'source' && <SourceStep wizard={wizard} />}
          {wizard.current === 'router' && <RouterStep wizard={wizard} />}
          {wizard.current === 'routerModels' && <RouterModelsStep wizard={wizard} />}
          {wizard.current === 'manualOnly' && (
            <ManualOnlyStep wizard={wizard} capabilities={capabilities} />
          )}
          {wizard.current === 'provider' && <ProviderStep wizard={wizard} />}
          {wizard.current === 'models' && <ModelsStep wizard={wizard} />}
          {INTEGRATION_GROUP_ORDER.map(
            (group) =>
              wizard.current === group && (
                <IntegrationGroupStep key={group} wizard={wizard} group={group} />
              ),
          )}
          {wizard.current === 'search' && <SearchStep wizard={wizard} />}
          {wizard.current === 'done' && (
            <DoneStep
              capabilities={capabilities}
              optOuts={wizard.optOuts}
              onFinish={() => onClose('finished')}
              onOpenModelSettings={openModelSettings}
              onUseOwnConfig={handleUseOwnConfig}
            />
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SetupWizard;
