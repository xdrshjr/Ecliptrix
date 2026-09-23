'use client';

import React, { useState } from 'react';
import type { ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import VoiceSelector from '../VoiceSelector';
import { RefreshCw } from './icons';

export const VOICE_SPEEDS: readonly number[] = [0.8, 0.9, 1.0, 1.1, 1.2];

export interface SegmentVoiceOverrideProps {
  segment: ScriptSegment;
  /** The project default voice (persisted, else the built-in default). */
  defaultVoiceId: string;
  /** Plain script edit (not a timeline history entry, like editing text). */
  onPatch(patch: Partial<ScriptSegment>): void;
  /** Regenerate this segment's voice-over with the current settings. */
  onRegenerate?(): void;
  disabled?: boolean;
  /** Compact form for the properties panel. */
  variant?: 'card' | 'inspector';
}

/**
 * 本段音色 / 语速（spec R2 §3.5）：明确显示「使用全片默认」还是「已单独设置」，
 * 修改只写脚本，芯片随之显示「配音待更新」，不会自动重新生成。
 */
const SegmentVoiceOverride: React.FC<SegmentVoiceOverrideProps> = (props) => {
  const { segment, defaultVoiceId, onPatch, onRegenerate, disabled = false, variant = 'card' } = props;
  const { t } = useLocale();
  const copy = t.workbench.segmentCommands;
  const [isPicking, setIsPicking] = useState(false);
  const [voiceName, setVoiceName] = useState<{ id: string; name: string } | null>(null);
  const isOverridden = typeof segment.voiceId === 'string' && segment.voiceId !== '';
  const effectiveVoiceId = segment.voiceId ?? defaultVoiceId;
  const name = voiceName?.id === effectiveVoiceId ? voiceName.name : null;
  const speed = segment.voiceSpeed ?? 1;

  const pickVoice = (voiceId: string) => {
    onPatch({ voiceId: voiceId === defaultVoiceId ? undefined : voiceId });
    setIsPicking(false);
  };

  return (
    <div className="segment-voice-override" data-variant={variant} data-testid="segment-voice-override">
      <div className="segment-voice-override__row">
        <span className="segment-voice-override__label">{copy.segmentVoice}</span>
        <span className="segment-voice-override__value">
          {isOverridden
            ? copy.overridden.replace('{name}', name ?? effectiveVoiceId)
            : name ? copy.useDefaultNamed.replace('{name}', name) : copy.useDefault}
        </span>
        {isOverridden && (
          <button type="button" className="ws-btn ws-btn--sm ws-btn--text" disabled={disabled}
            onClick={() => onPatch({ voiceId: undefined })}>
            {copy.restoreDefault}
          </button>
        )}
        <button type="button" className="ws-btn ws-btn--sm ws-btn--ghost" disabled={disabled}
          aria-expanded={isPicking} onClick={() => setIsPicking((open) => !open)}>
          {t.workbench.script.changeVoice}
        </button>
      </div>
      <div hidden={!isPicking} className="segment-voice-override__picker">
        <VoiceSelector selectedVoiceId={effectiveVoiceId} onVoiceChange={pickVoice}
          onVoiceMetaChange={setVoiceName} />
      </div>
      <div className="segment-voice-override__row">
        <span className="segment-voice-override__label">{copy.speed}</span>
        <div className="ws-segmented segment-voice-override__speeds" role="group" aria-label={copy.speed}>
          {VOICE_SPEEDS.map((value) => (
            <button key={value} type="button" aria-pressed={Math.abs(speed - value) < 1e-6}
              disabled={disabled}
              onClick={() => onPatch({ voiceSpeed: Math.abs(value - 1) < 1e-6 ? undefined : value })}>
              {value.toFixed(1)}×
            </button>
          ))}
        </div>
      </div>
      {onRegenerate && (
        <button type="button" className="ws-btn ws-btn--sm ws-btn--outline-primary segment-voice-override__regen"
          onClick={onRegenerate} disabled={disabled}>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />{copy.regenerateWithSettings}
        </button>
      )}
    </div>
  );
};

export default SegmentVoiceOverride;
