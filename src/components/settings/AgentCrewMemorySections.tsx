'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SettingsSectionCard from './components/SettingsSectionCard';
import { NumberField, SwitchField } from './components/SettingsFieldHelpers';
import {
  CREW_MEMORY_LIMITS, type CrewMemoryNumericKey, type CrewMemorySettings,
} from './agentCrewMemorySettings';

/** The "Research crew" and "Conversation memory" groups of the Agent capabilities page. */

type ToggleKey = 'crew_enabled' | 'auto_compact';

function Limit({ settingKey, label, value, onNumber }: {
  settingKey: CrewMemoryNumericKey; label: string; value: number;
  onNumber: (key: CrewMemoryNumericKey, value: number) => void;
}) {
  const { min, max, step } = CREW_MEMORY_LIMITS[settingKey];
  return (
    <NumberField label={label} value={value} min={min} max={max} step={step}
      onChange={next => onNumber(settingKey, next)} />
  );
}

export default function AgentCrewMemorySections({ values, onToggle, onNumber }: {
  values: CrewMemorySettings;
  onToggle: (key: ToggleKey, checked: boolean) => void;
  onNumber: (key: CrewMemoryNumericKey, value: number) => void;
}) {
  const { t } = useLocale();
  const crew = t.agentSettings.crew;
  const memory = t.agentSettings.memory;
  return (
    <>
      <SettingsSectionCard title={crew.title} description={crew.description}>
        <SwitchField label={crew.enabled} checked={values.crew_enabled}
          onChange={checked => onToggle('crew_enabled', checked)} />
        <Limit settingKey="crew_max_parallel" label={crew.maxParallel}
          value={values.crew_max_parallel} onNumber={onNumber} />
        <Limit settingKey="crew_member_timeout_s" label={crew.memberTimeout}
          value={values.crew_member_timeout_s} onNumber={onNumber} />
      </SettingsSectionCard>
      <SettingsSectionCard title={memory.title} description={memory.description}>
        <SwitchField label={memory.autoCompact} checked={values.auto_compact}
          onChange={checked => onToggle('auto_compact', checked)} />
        <Limit settingKey="auto_compact_ratio" label={memory.autoCompactRatio}
          value={values.auto_compact_ratio} onNumber={onNumber} />
      </SettingsSectionCard>
    </>
  );
}
