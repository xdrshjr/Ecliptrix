'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SegmentDialogShell from './SegmentDialogShell';

export type DefaultVoiceChangeChoice = 'future-only' | 'regenerate';

export interface DefaultVoiceChangeDialogProps {
  voiceName: string;
  /** Segments on the default voice that already have a voice-over. */
  affectedCount: number;
  /** Segments with their own voice (not affected). */
  overriddenCount: number;
  onChoose(choice: DefaultVoiceChangeChoice): void;
  onClose(): void;
}

/**
 * 修改全片默认音色时的询问（spec R2 §3.5）：默认「仅用于后续生成」，
 * 不会自动重做已有配音；选择重新生成也只产生候选，由用户试听后应用。
 */
const DefaultVoiceChangeDialog: React.FC<DefaultVoiceChangeDialogProps> = (props) => {
  const { voiceName, affectedCount, overriddenCount, onChoose, onClose } = props;
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  const [choice, setChoice] = useState<DefaultVoiceChangeChoice>('future-only');
  const options: { value: DefaultVoiceChangeChoice; label: string; hint?: string }[] = [
    { value: 'future-only', label: copy.defaultChangeFutureOnly },
    {
      value: 'regenerate',
      label: copy.defaultChangeRegenerate.replace('{count}', String(affectedCount)),
      hint: copy.defaultChangeRegenerateHint,
    },
  ];
  return (
    <SegmentDialogShell
      title={copy.defaultChangeTitle}
      onClose={onClose}
      testId="default-voice-change-dialog"
      footer={(
        <>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose}>{copy.cancel}</button>
          <button type="button" className="ws-btn ws-btn--primary" onClick={() => onChoose(choice)}>
            {copy.confirm}
          </button>
        </>
      )}
    >
      <p className="ws-dialog__message">
        {copy.defaultChangeBody.replace('{name}', voiceName).replace('{count}', String(affectedCount))}
        {overriddenCount > 0 && ` ${copy.defaultChangeOverridden.replace('{count}', String(overriddenCount))}`}
      </p>
      <div role="radiogroup" aria-label={copy.defaultChangeTitle} className="ws-dialog__options">
        {options.map((entry, index) => (
          <label key={entry.value} className="ws-dialog__option" data-checked={choice === entry.value || undefined}>
            <input
              type="radio"
              name="default-voice-change"
              value={entry.value}
              checked={choice === entry.value}
              onChange={() => setChoice(entry.value)}
              data-autofocus={index === 0 ? true : undefined}
            />
            <span className="ws-dialog__option-text">
              <span className="ws-dialog__option-label">{entry.label}</span>
              {entry.hint && <span className="ws-dialog__option-hint">{entry.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </SegmentDialogShell>
  );
};

export default DefaultVoiceChangeDialog;
