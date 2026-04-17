'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  StoryboardAspectRatio,
  StoryboardPack,
  MentionedImage,
  ScriptShot,
  ScriptMessage,
} from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import MentionedImageInput from './MentionedImageInput';
import GridSizeSelector from './GridSizeSelector';
import StoryboardScriptReview from './StoryboardScriptReview';
import StoryboardPreviewPanel from './StoryboardPreviewPanel';
import AspectRatioIcon from './AspectRatioIcon';
import {
  generateStoryboardScript,
  reviseStoryboardScript,
} from '@/lib/api/storyboard';

const ASPECT_RATIO_VALUES: { value: StoryboardAspectRatio; icon: 'square' | 'landscape' | 'portrait' }[] = [
  { value: '1:1', icon: 'square' },
  { value: '16:9', icon: 'landscape' },
  { value: '9:16', icon: 'portrait' },
  { value: '4:3', icon: 'landscape' },
  { value: '3:4', icon: 'portrait' },
];

export interface StoryboardTabState {
  prompt: string;
  frameCount: number;
  aspectRatio: StoryboardAspectRatio;
  referenceImages: MentionedImage[];
}

type WizardStep = 'input' | 'script' | 'generating' | 'success' | 'error';

interface StoryboardTabProps {
  state: StoryboardTabState;
  onChange: React.Dispatch<React.SetStateAction<StoryboardTabState>>;
  onGenerate: (
    state: StoryboardTabState,
    opts?: { frameScripts?: string[]; scriptHistory?: ScriptMessage[]; locale?: 'zh' | 'en' },
  ) => Promise<StoryboardPack>;
}

const MAX_PROMPT_LENGTH = 2000;

// Pick UI language from <html lang> when available, fall back to zh.
function detectLocale(): 'zh' | 'en' {
  if (typeof document !== 'undefined') {
    const htmlLang = document.documentElement.lang?.toLowerCase() || '';
    if (htmlLang.startsWith('en')) return 'en';
  }
  return 'zh';
}

interface ConfigSectionProps {
  frameCount: number;
  aspectRatio: StoryboardAspectRatio;
  referenceImages: MentionedImage[];
  prompt: string;
  onChange: React.Dispatch<React.SetStateAction<StoryboardTabState>>;
  disabled?: boolean;
  compact?: boolean;
}

const ConfigSection: React.FC<ConfigSectionProps> = ({
  frameCount,
  aspectRatio,
  referenceImages,
  prompt,
  onChange,
  disabled,
  compact,
}) => {
  const { t } = useLocale();

  const ASPECT_RATIO_LABELS: Record<StoryboardAspectRatio, string> = {
    '1:1': t.storyboardTab.aspectRatio11,
    '16:9': t.storyboardTab.aspectRatio169,
    '9:16': t.storyboardTab.aspectRatio916,
    '4:3': t.storyboardTab.aspectRatio43,
    '3:4': t.storyboardTab.aspectRatio34,
  };

  return (
    <div className={compact ? 'space-y-5' : 'space-y-6'}>
      <GridSizeSelector
        value={frameCount}
        onChange={(fc) => onChange((prev) => ({ ...prev, frameCount: fc }))}
        disabled={disabled}
      />

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">{t.storyboardTab.aspectRatioLabel}</label>
        <div className="flex flex-wrap gap-2">
          {ASPECT_RATIO_VALUES.map((preset) => {
            const active = aspectRatio === preset.value;
            return (
              <button
                type="button"
                key={preset.value}
                onClick={() => onChange((prev) => ({ ...prev, aspectRatio: preset.value }))}
                disabled={disabled}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:bg-accent'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <AspectRatioIcon variant={preset.icon} active={active} />
                {ASPECT_RATIO_LABELS[preset.value]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          {t.storyboardTab.promptLabel} <span className="text-destructive">*</span>
        </label>
        <MentionedImageInput
          value={prompt}
          onValueChange={(val) => onChange((prev) => ({ ...prev, prompt: val.slice(0, MAX_PROMPT_LENGTH) }))}
          referenceImages={referenceImages}
          onReferenceImagesChange={(imgs) => onChange((prev) => ({ ...prev, referenceImages: imgs }))}
          placeholder={t.storyboardTab.promptPlaceholder}
          maxLength={MAX_PROMPT_LENGTH}
        />
      </div>
    </div>
  );
};

const StoryboardTab: React.FC<StoryboardTabProps> = ({ state, onChange, onGenerate }) => {
  const { t } = useLocale();
  const { prompt, frameCount, aspectRatio, referenceImages } = state;

  const [step, setStep] = useState<WizardStep>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const [resultPack, setResultPack] = useState<StoryboardPack | null>(null);

  // Script draft state (in-memory only; lost when modal closes per spec V10)
  const [shots, setShots] = useState<ScriptShot[]>([]);
  const [messages, setMessages] = useState<ScriptMessage[]>([]);
  const [isScriptLoading, setIsScriptLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [scriptError, setScriptError] = useState('');

  const locale = useMemo(detectLocale, []);

  const canStartScript = prompt.trim().length > 0 && !isScriptLoading;
  const canGenerateImages =
    shots.length === frameCount &&
    shots.every((s) => s.script.trim().length >= 5);

  const resetAll = useCallback(() => {
    setStep('input');
    setErrorMessage('');
    setResultPack(null);
    setShots([]);
    setMessages([]);
    setChatInput('');
    setScriptError('');
  }, []);

  const handleGenerateScript = useCallback(async () => {
    if (!canStartScript) return;
    setIsScriptLoading(true);
    setScriptError('');
    try {
      const result = await generateStoryboardScript({
        prompt,
        frameCount,
        aspectRatio,
        locale,
      });
      setShots(result);
      setMessages([]);
      setStep('script');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.storyboardTab.scriptGenerateFailed;
      setScriptError(msg);
    } finally {
      setIsScriptLoading(false);
    }
  }, [canStartScript, prompt, frameCount, aspectRatio, locale, t]);

  const handleSendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isScriptLoading) return;
    const nextHistory: ScriptMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextHistory);
    setChatInput('');
    setIsScriptLoading(true);
    setScriptError('');
    try {
      const revised = await reviseStoryboardScript({
        frameCount,
        aspectRatio,
        locale,
        currentDraft: shots,
        history: messages,
        userMessage: text,
      });
      setShots(revised);
      setMessages([
        ...nextHistory,
        { role: 'assistant', content: t.storyboardTab.scriptUpdated.replace('{count}', String(revised.length)) },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.storyboardTab.scriptReviseFailed;
      setScriptError(msg);
    } finally {
      setIsScriptLoading(false);
    }
  }, [chatInput, isScriptLoading, messages, shots, frameCount, aspectRatio, locale, t]);

  const handleEditShot = useCallback((index: number, script: string) => {
    setShots((prev) => prev.map((s) => (s.index === index ? { ...s, script } : s)));
  }, []);

  const handleBackToInput = useCallback(() => {
    const ok = window.confirm(t.storyboardTab.backConfirm);
    if (!ok) return;
    setShots([]);
    setMessages([]);
    setScriptError('');
    setStep('input');
  }, [t]);

  const handleConfirmAndGenerate = useCallback(async () => {
    if (!canGenerateImages) return;
    setStep('generating');
    setErrorMessage('');
    setResultPack(null);
    try {
      const frameScripts = shots
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((s) => s.script);
      const pack = await onGenerate(state, {
        frameScripts,
        scriptHistory: messages,
        locale,
      });
      setResultPack(pack);
      setStep('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.storyboardTab.generateFailed;
      setErrorMessage(msg);
      setStep('error');
    }
  }, [canGenerateImages, shots, state, messages, locale, onGenerate, t]);

  // "Skip script" advanced fallback preserves the old one-step flow.
  const handleSkipScript = useCallback(async () => {
    setStep('generating');
    setErrorMessage('');
    setResultPack(null);
    try {
      const pack = await onGenerate(state);
      setResultPack(pack);
      setStep('success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.storyboardTab.generateFailed;
      setErrorMessage(msg);
      setStep('error');
    }
  }, [onGenerate, state, t]);

  const inputsDisabled =
    step === 'script' || step === 'generating' || isScriptLoading;

  // Two-column layout for the script review step: config on the left, review on the right.
  if (step === 'script') {
    return (
      <div className="h-full flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6 gap-4 min-h-0">
        {/* Left column: config */}
        <div className="flex flex-col min-h-0 flex-1 md:flex-none md:h-full overflow-hidden">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-border shrink-0">
            <h3 className="text-sm font-semibold text-foreground">{t.storyboardTab.settingsTitle}</h3>
            <span className="text-xs text-muted-foreground">{t.storyboardTab.settingsLocked}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto pl-2 pr-1">
            <ConfigSection
              compact
              frameCount={frameCount}
              aspectRatio={aspectRatio}
              referenceImages={referenceImages}
              prompt={prompt}
              onChange={onChange}
              disabled={inputsDisabled}
            />
          </div>
        </div>

        {/* Right column: script review */}
        <div className="flex flex-col min-h-0 flex-1 md:flex-none md:h-full overflow-hidden">
          <StoryboardScriptReview
            frameCount={frameCount}
            locale={locale}
            shots={shots}
            messages={messages}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSendChat={handleSendChat}
            onEditShot={handleEditShot}
            onBack={handleBackToInput}
            onConfirm={handleConfirmAndGenerate}
            isBusy={isScriptLoading}
            canConfirm={canGenerateImages}
            error={scriptError}
          />
        </div>
      </div>
    );
  }

  // Unified two-column layout for input / generating / success / error.
  return (
    <div className="flex gap-6 h-full">
      {/* Left column */}
      <div className="flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1">
        {step === 'input' && (
          <>
            <ConfigSection
              frameCount={frameCount}
              aspectRatio={aspectRatio}
              referenceImages={referenceImages}
              prompt={prompt}
              onChange={onChange}
              disabled={inputsDisabled}
            />
            <div className="space-y-3">
              <button
                onClick={handleGenerateScript}
                disabled={!canStartScript}
                className="w-full py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isScriptLoading ? t.storyboardTab.generatingScript : t.storyboardTab.nextStepGenerate}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                {t.storyboardTab.scriptInfo.replace('{count}', String(frameCount)).replace('{ratio}', aspectRatio).replace('{lang}', locale === 'zh' ? '中文' : 'English')}
              </p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">{t.storyboardTab.advancedOptions}</summary>
                <button
                  type="button"
                  onClick={handleSkipScript}
                  disabled={!prompt.trim() || inputsDisabled}
                  className="mt-2 w-full py-2 text-xs text-foreground bg-secondary border border-border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {t.storyboardTab.skipScript}
                </button>
              </details>
              {scriptError && (
                <p className="text-xs text-destructive text-center">{scriptError}</p>
              )}
            </div>
          </>
        )}

        {step === 'generating' && (
          <div className="flex flex-col items-center justify-center gap-3 h-full min-h-[120px]">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">{t.storyboardTab.generatingFrames.replace('{count}', String(frameCount))}</p>
            <p className="text-xs text-muted-foreground">{t.storyboardTab.generatingFramesDesc}</p>
          </div>
        )}

        {step === 'success' && resultPack && (
          <div className="flex flex-col justify-center h-full min-h-[120px]">
            <div className="border border-border rounded-md p-4 space-y-3">
              <div className="flex items-start gap-3">
                <img
                  src={resultPack.originalImageUrl}
                  alt={t.storyboardTab.storyboardImageAlt}
                  className="w-20 h-20 rounded-md border border-border object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {t.storyboardTab.croppedFrames.replace('{count}', String(resultPack.frameCount))}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {resultPack.prompt}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.storyboardTab.gridLabel} {resultPack.gridSize}
                  </p>
                </div>
              </div>
              <button
                onClick={resetAll}
                className="w-full py-2 text-sm font-medium text-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
              >
                {t.storyboardTab.generateNew}
              </button>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col justify-center h-full min-h-[120px]">
            <div className="border border-destructive/30 rounded-md p-4 space-y-3">
              <p className="text-sm text-destructive">{errorMessage}</p>
              <button
                onClick={resetAll}
                className="w-full py-2 text-sm font-medium text-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
              >
                {t.storyboardTab.retryButton}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right column: preview panel */}
      <div className="w-64 flex-shrink-0 border-l border-border pl-6 overflow-y-auto">
        <StoryboardPreviewPanel
          frameCount={frameCount}
          aspectRatio={aspectRatio}
          locale={locale}
        />
      </div>
    </div>
  );
};

export default StoryboardTab;
