'use client';

import React, { useEffect, useState } from 'react';
import { getSkillRouter } from '@/lib/api/skillrouter';
import SetupWizard, { type SetupWizardProps } from './SetupWizard';
import type { SourceModeState } from './wizard/wizardSteps';

/** How long the wizard waits for the saved source before opening without it. */
export const SOURCE_MODE_TIMEOUT_MS = 2500;

/**
 * Reads the saved capability source, then mounts {@link SetupWizard} with it.
 * The wizard freezes its step list when it opens, so the source has to be known
 * first. Any failure (older backend, timeout) degrades to the manual wizard,
 * i.e. exactly what ships without the relay: never a blocked first run.
 */
const SetupWizardHost: React.FC<Omit<SetupWizardProps, 'sourceMode'>> = (props) => {
  const [sourceMode, setSourceMode] = useState<SourceModeState | 'loading'>('loading');

  useEffect(() => {
    let isActive = true;
    const fallback = setTimeout(() => {
      if (isActive) setSourceMode((current) => (current === 'loading' ? 'manual' : current));
    }, SOURCE_MODE_TIMEOUT_MS);
    getSkillRouter()
      .then((status) => isActive && setSourceMode(status.modeState))
      .catch(() => isActive && setSourceMode('manual'));
    return () => {
      isActive = false;
      clearTimeout(fallback);
    };
  }, []);

  if (sourceMode === 'loading') return null;
  return <SetupWizard {...props} sourceMode={sourceMode} />;
};

export default SetupWizardHost;
