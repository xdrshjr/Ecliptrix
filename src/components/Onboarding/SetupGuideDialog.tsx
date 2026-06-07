'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import Modal from '@/components/ui/Modal';

interface SetupGuideDialogProps {
  open: boolean;
  /** Primary action: jump to Settings → Model Settings. */
  onGoToSettings: () => void;
  /** Secondary action / Esc / backdrop click: dismiss for this session. */
  onDismiss: () => void;
}

/**
 * First-run setup guide shown to admins when no CHAT LLM credential exists.
 *
 * Pure presentational — visibility logic lives in page.tsx. Focus trap, Esc,
 * backdrop close and focus restoration all come from ui/Modal (R3); this
 * component only owns the content and visual styling.
 */
const SetupGuideDialog: React.FC<SetupGuideDialogProps> = ({
  open,
  onGoToSettings,
  onDismiss,
}) => {
  const { t } = useLocale();

  const steps = [
    {
      title: t.setupGuide.stepProviderTitle,
      desc: t.setupGuide.stepProviderDesc,
    },
    {
      title: t.setupGuide.stepTestTitle,
      desc: t.setupGuide.stepTestDesc,
    },
    {
      title: t.setupGuide.stepAssignTitle,
      desc: t.setupGuide.stepAssignDesc,
    },
  ];

  return (
    <Modal
      isOpen={open}
      onClose={onDismiss}
      labelledBy="setup-guide-title"
      describedBy="setup-guide-desc"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      contentClassName="max-w-lg w-[92vw] rounded-2xl bg-card text-foreground border border-border shadow-2xl p-8 transition duration-200 ease-out motion-reduce:transition-none"
    >
      {/* Gradient key icon */}
      <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-5">
        <svg
          className="w-7 h-7 text-primary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
          />
        </svg>
      </div>

      <h2 id="setup-guide-title" className="text-xl font-semibold text-foreground">
        {t.setupGuide.title}
      </h2>
      <p
        id="setup-guide-desc"
        className="mt-2 text-sm text-muted-foreground leading-relaxed"
      >
        {t.setupGuide.description}
      </p>

      {/* Three-step walkthrough */}
      <ol className="mt-6 space-y-4">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
              {index + 1}
            </span>
            <div>
              <div className="text-sm font-medium text-foreground">
                {step.title}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {step.desc}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Actions */}
      <div className="mt-8 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="px-4 py-2 text-sm font-medium rounded-md text-muted-foreground hover:bg-accent transition-colors"
        >
          {t.setupGuide.later}
        </button>
        <button
          type="button"
          autoFocus
          onClick={onGoToSettings}
          className="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          {t.setupGuide.goToSettings}
        </button>
      </div>
    </Modal>
  );
};

export default SetupGuideDialog;
