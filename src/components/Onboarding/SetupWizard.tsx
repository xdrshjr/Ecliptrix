'use client';

import React, { useCallback, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import Modal from '@/components/ui/Modal';
import type { SettingsMenuItem } from '@/components/settings/SettingsSidebar';
import type { CapabilityId, CapabilityStatus } from '@/lib/api/setupStatus';
import DoneStep from './wizard/DoneStep';
import ModelsStep from './wizard/ModelsStep';
import OverviewStep from './wizard/OverviewStep';
import ProviderStep from './wizard/ProviderStep';
import SearchStep from './wizard/SearchStep';
import WizardStepper from './wizard/WizardStepper';
import { useSetupWizard } from './wizard/useSetupWizard';
import { BUTTON_GHOST, BUTTON_PRIMARY } from './wizard/wizardStyles';
import type { WizardMode } from './wizard/wizardSteps';

export interface SetupWizardProps {
  /** `auto`: startup gap-filler. `manual`: re-run from Settings (all capabilities). */
  mode: WizardMode;
  /** Live status; the wizard reads it for the checklist and the done page. */
  capabilities: CapabilityStatus[];
  optOuts: CapabilityId[];
  /** `later` → the page remembers a session-level dismiss (auto mode only). */
  onClose: (reason: 'finished' | 'later') => void;
  onOpenSettings: (item: SettingsMenuItem) => void;
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
}) => {
  const copy = useLocale().t.setupWizard;
  const wizard = useSetupWizard({ capabilities, optOuts, mode });
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
              optOuts={optOuts}
              mode={mode}
              onStart={wizard.goNext}
              onLater={requestClose}
              onOpenModelSettings={openModelSettings}
            />
          )}
          {wizard.current === 'provider' && <ProviderStep wizard={wizard} />}
          {wizard.current === 'models' && <ModelsStep wizard={wizard} />}
          {wizard.current === 'search' && <SearchStep wizard={wizard} />}
          {wizard.current === 'done' && (
            <DoneStep
              capabilities={capabilities}
              optOuts={optOuts}
              onFinish={() => onClose('finished')}
              onOpenModelSettings={openModelSettings}
            />
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SetupWizard;
