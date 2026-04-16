'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { VoiceType, getVoiceTypes } from '@/lib/api/tts';

export interface AiAudioModalParams {
  text: string;
  voice_type: string;
  speed_ratio: number;
}

interface AiAudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: AiAudioModalParams) => void | Promise<void>;
}

const AiAudioModal: React.FC<AiAudioModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const { t } = useLocale();
  const [text, setText] = useState('');
  const [voiceType, setVoiceType] = useState('');
  const [speedRatio, setSpeedRatio] = useState(1.0);
  const [voiceTypes, setVoiceTypes] = useState<VoiceType[]>([]);
  const [voiceCategoryFilter, setVoiceCategoryFilter] = useState<string>('all');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const categories = useCallback(() => {
    const cats = new Set<string>();
    voiceTypes.forEach((v) => cats.add(v.category));
    return Array.from(cats);
  }, [voiceTypes]);

  const filteredVoices = voiceTypes.filter(
    (v) => voiceCategoryFilter === 'all' || v.category === voiceCategoryFilter
  );

  useEffect(() => {
    if (isOpen) {
      loadVoiceTypes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const loadVoiceTypes = async () => {
    setLoadingVoices(true);
    try {
      const resp = await getVoiceTypes('zh-CN');
      if (resp.success && resp.data) {
        const voices = Object.values(resp.data);
        setVoiceTypes(voices);
        if (voices.length > 0) {
          setVoiceType(voices[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load voice types:', err);
    } finally {
      setLoadingVoices(false);
    }
  };

  const resetForm = () => {
    setText('');
    setSpeedRatio(1.0);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!text.trim() || !voiceType) return;

    setSubmitting(true);
    try {
      await onConfirm({
        text: text.trim(),
        voice_type: voiceType,
        speed_ratio: speedRatio,
      });
      handleClose();
    } catch {
      // error handled by parent
    } finally {
      setSubmitting(false);
    }
  };

  const isSubmitDisabled = submitting || !text.trim() || !voiceType;

  if (!isOpen) return null;

  const mp = t.materialsPanel;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="w-full max-w-2xl bg-card border border-border rounded-lg shadow-xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{mp.aiAudioTitle || 'AI Audio'}</h2>
          <button
            onClick={handleClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto flex-1">
          {/* Text input */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {mp.aiAudioText || 'Text to convert'}
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 5000))}
              placeholder={mp.aiAudioTextPlaceholder || 'Enter text to convert to audio...'}
              rows={4}
              className="w-full px-3 py-2 text-sm bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <div className="text-xs text-muted-foreground mt-1 text-right">
              {text.length}/5000
            </div>
          </div>

          {/* Speed ratio */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {mp.aiAudioSpeed || 'Speed'}: {speedRatio.toFixed(1)}x
            </label>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speedRatio}
              onChange={(e) => setSpeedRatio(parseFloat(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0.5x</span>
              <span>1.0x</span>
              <span>2.0x</span>
            </div>
          </div>

          {/* Voice selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              {mp.aiAudioSelectVoice || 'Select Voice'}
            </label>

            {/* Category filter */}
            {categories().length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                <button
                  onClick={() => setVoiceCategoryFilter('all')}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    voiceCategoryFilter === 'all'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                  }`}
                >
                  {mp.filterAll || 'All'}
                </button>
                {categories().map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setVoiceCategoryFilter(cat)}
                    className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                      voiceCategoryFilter === cat
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {/* Voice list */}
            {loadingVoices ? (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                <svg className="animate-spin w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {mp.aiAudioLoadingVoices || 'Loading voices...'}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                {filteredVoices.map((voice) => (
                  <button
                    key={voice.id}
                    onClick={() => setVoiceType(voice.id)}
                    className={`px-3 py-2 text-left text-xs rounded-md border transition-colors ${
                      voiceType === voice.id
                        ? 'bg-primary/10 border-primary text-foreground'
                        : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium truncate">{voice.name}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {voice.gender} · {voice.language}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border bg-muted/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-6 py-2.5 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
          >
            {mp.aiAudioCancel || 'Cancel'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="px-6 py-2.5 text-sm font-medium text-primary-foreground rounded-md bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            {submitting && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {mp.aiAudioStartSynthesis || 'Start Synthesis'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiAudioModal;
