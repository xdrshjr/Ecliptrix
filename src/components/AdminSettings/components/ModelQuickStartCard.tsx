'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';

interface ModelQuickStartCardProps {
  onAddProvider: () => void;
}

/**
 * Zero-provider empty state for the providers tab (desktop-config-free-startup).
 *
 * Kept outside ModelSettingsPanel.tsx (already over the 800-line threshold) —
 * the panel only swaps its dashed empty-state div for this card. Step copy is
 * shared with SetupGuideDialog via the setupGuide i18n namespace.
 */
const ModelQuickStartCard: React.FC<ModelQuickStartCardProps> = ({ onAddProvider }) => {
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
    <div className="rounded-xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-8 text-center">
      <h3 className="text-lg font-semibold text-foreground">
        {t.adminSettings.modelQuickStartTitle}
      </h3>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {t.adminSettings.modelQuickStartDesc}
      </p>

      <div className="mt-6 flex flex-col sm:flex-row items-stretch justify-center gap-4 sm:gap-6 text-left">
        {steps.map((step, index) => (
          <div key={step.title} className="flex items-start gap-2.5 sm:max-w-[180px]">
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
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={onAddProvider}
        className="mt-7 inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        {t.adminSettings.modelQuickStartAddProvider}
      </button>
    </div>
  );
};

export default ModelQuickStartCard;
