'use client';

import React, { useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import SegmentDialogShell, { ImpactLines } from './SegmentDialogShell';
import { formatSeconds } from '../../lib/segments/formatSegmentImpact';

export type VoiceDurationChoice = 'adjust' | 'keep' | 'edit' | 'skip';

export interface VoiceDurationDialogProps {
  /** New length minus the old span (s). */
  delta: number;
  /** Impact of "adjust this segment". */
  lines: readonly string[];
  /** "Keep the original length" is offered (shorter voice replacing one). */
  canKeep: boolean;
  /** Restoring a version made for older text (RV2-02). */
  isStaleVersion: boolean;
  onChoose(choice: VoiceDurationChoice): void;
  onClose(): void;
}

type Option = 'adjust' | 'edit' | 'skip';

/**
 * 配音时长变化对话框（spec R2 §3.4.2）：先说明影响，再在三种做法中选一，
 * 默认「调整本段时长」；Esc / 取消不应用任何内容。
 */
const VoiceDurationDialog: React.FC<VoiceDurationDialogProps> = (props) => {
  const { delta, lines, canKeep, isStaleVersion, onChoose, onClose } = props;
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  const [option, setOption] = useState<Option>('adjust');
  const [keep, setKeep] = useState(false);
  const title = (delta >= 0 ? copy.durationLonger : copy.durationShorter)
    .replace('{value}', formatSeconds(delta));
  const options: { value: Option; label: string; hint: string }[] = [
    { value: 'adjust', label: copy.optionAdjust, hint: copy.optionAdjustHint },
    { value: 'edit', label: copy.optionEdit, hint: copy.optionEditHint },
    { value: 'skip', label: copy.optionSkip, hint: copy.optionSkipHint },
  ];
  const confirm = () => onChoose(option === 'adjust' && keep ? 'keep' : option);
  return (
    <SegmentDialogShell
      title={title}
      onClose={onClose}
      testId="voice-duration-dialog"
      footer={(
        <>
          <button type="button" className="ws-btn ws-btn--ghost" onClick={onClose}>{copy.cancel}</button>
          <button type="button" className="ws-btn ws-btn--primary" onClick={confirm}>{copy.confirm}</button>
        </>
      )}
    >
      {isStaleVersion && <p className="ws-dialog__note" data-tone="warn">{copy.staleVersionNote}</p>}
      <ImpactLines lines={keep && option === 'adjust' ? [] : lines} />
      <div role="radiogroup" aria-label={copy.durationDialogLabel} className="ws-dialog__options">
        {options.map((entry, index) => (
          <label key={entry.value} className="ws-dialog__option" data-checked={option === entry.value || undefined}>
            <input
              type="radio"
              name="voice-duration-option"
              value={entry.value}
              checked={option === entry.value}
              onChange={() => setOption(entry.value)}
              data-autofocus={index === 0 ? true : undefined}
            />
            <span className="ws-dialog__option-text">
              <span className="ws-dialog__option-label">{entry.label}</span>
              <span className="ws-dialog__option-hint">{entry.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {canKeep && option === 'adjust' && (
        <label className="ws-dialog__check">
          <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
          <span>{copy.optionKeep}</span>
        </label>
      )}
    </SegmentDialogShell>
  );
};

export default VoiceDurationDialog;
