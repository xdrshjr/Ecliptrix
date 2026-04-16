'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  StoryboardAspectRatio,
  StoryboardPack,
  MentionedImage,
  ScriptShot,
  ScriptMessage,
} from '@/types';
import MentionedImageInput from './MentionedImageInput';
import GridSizeSelector from './GridSizeSelector';
import StoryboardScriptReview from './StoryboardScriptReview';
import StoryboardPreviewPanel from './StoryboardPreviewPanel';
import AspectRatioIcon from './AspectRatioIcon';
import {
  generateStoryboardScript,
  reviseStoryboardScript,
} from '@/lib/api/storyboard';

const ASPECT_RATIO_PRESETS: { value: StoryboardAspectRatio; label: string; icon: 'square' | 'landscape' | 'portrait' }[] = [
  { value: '1:1', label: '1:1 方形', icon: 'square' },
  { value: '16:9', label: '16:9 横屏', icon: 'landscape' },
  { value: '9:16', label: '9:16 竖屏', icon: 'portrait' },
  { value: '4:3', label: '4:3 横屏', icon: 'landscape' },
  { value: '3:4', label: '3:4 竖屏', icon: 'portrait' },
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
  return (
    <div className={compact ? 'space-y-5' : 'space-y-6'}>
      <GridSizeSelector
        value={frameCount}
        onChange={(fc) => onChange((prev) => ({ ...prev, frameCount: fc }))}
        disabled={disabled}
      />

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">画面比例</label>
        <div className="flex flex-wrap gap-2">
          {ASPECT_RATIO_PRESETS.map((preset) => {
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
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          提示词 <span className="text-destructive">*</span>
        </label>
        <MentionedImageInput
          value={prompt}
          onValueChange={(val) => onChange((prev) => ({ ...prev, prompt: val.slice(0, MAX_PROMPT_LENGTH) }))}
          referenceImages={referenceImages}
          onReferenceImagesChange={(imgs) => onChange((prev) => ({ ...prev, referenceImages: imgs }))}
          placeholder="描述您想要生成的分镜内容... 输入 @ 关联参考图"
          maxLength={MAX_PROMPT_LENGTH}
        />
      </div>
    </div>
  );
};

const StoryboardTab: React.FC<StoryboardTabProps> = ({ state, onChange, onGenerate }) => {
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
      const msg = err instanceof Error ? err.message : '剧本生成失败';
      setScriptError(msg);
    } finally {
      setIsScriptLoading(false);
    }
  }, [canStartScript, prompt, frameCount, aspectRatio, locale]);

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
        { role: 'assistant', content: `已更新剧本（${revised.length} 幕）。` },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '剧本修改失败';
      setScriptError(msg);
    } finally {
      setIsScriptLoading(false);
    }
  }, [chatInput, isScriptLoading, messages, shots, frameCount, aspectRatio, locale]);

  const handleEditShot = useCallback((index: number, script: string) => {
    setShots((prev) => prev.map((s) => (s.index === index ? { ...s, script } : s)));
  }, []);

  const handleBackToInput = useCallback(() => {
    const ok = window.confirm('返回修改输入将清空当前剧本草稿，是否继续？');
    if (!ok) return;
    setShots([]);
    setMessages([]);
    setScriptError('');
    setStep('input');
  }, []);

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
      const msg = err instanceof Error ? err.message : '分镜生成失败，请重试';
      setErrorMessage(msg);
      setStep('error');
    }
  }, [canGenerateImages, shots, state, messages, locale, onGenerate]);

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
      const msg = err instanceof Error ? err.message : '分镜生成失败，请重试';
      setErrorMessage(msg);
      setStep('error');
    }
  }, [onGenerate, state]);

  const inputsDisabled =
    step === 'script' || step === 'generating' || isScriptLoading;

  // Two-column layout for the script review step: config on the left, review on the right.
  if (step === 'script') {
    return (
      <div className="h-full flex flex-col md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-6 gap-4 min-h-0">
        {/* Left column: config */}
        <div className="flex flex-col min-h-0 flex-1 md:flex-none md:h-full overflow-hidden">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-border shrink-0">
            <h3 className="text-sm font-semibold text-foreground">分镜设置</h3>
            <span className="text-xs text-muted-foreground">已锁定</span>
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
                {isScriptLoading ? '正在生成剧本...' : '下一步：生成分镜剧本'}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                将先生成 {frameCount} 幕剧本供确认，画面比例 {aspectRatio}（语言：{locale === 'zh' ? '中文' : 'English'}）
              </p>
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">高级选项</summary>
                <button
                  type="button"
                  onClick={handleSkipScript}
                  disabled={!prompt.trim() || inputsDisabled}
                  className="mt-2 w-full py-2 text-xs text-foreground bg-secondary border border-border rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  跳过剧本，直接生成分镜（旧流程）
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
            <p className="text-sm text-muted-foreground">正在生成 {frameCount} 格分镜...</p>
            <p className="text-xs text-muted-foreground">AI 正在根据剧本绘制并自动裁剪</p>
          </div>
        )}

        {step === 'success' && resultPack && (
          <div className="flex flex-col justify-center h-full min-h-[120px]">
            <div className="border border-border rounded-md p-4 space-y-3">
              <div className="flex items-start gap-3">
                <img
                  src={resultPack.originalImageUrl}
                  alt="分镜大图"
                  className="w-20 h-20 rounded-md border border-border object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    已裁剪为 {resultPack.frameCount} 张分镜，并绑定剧本
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {resultPack.prompt}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    宫格: {resultPack.gridSize}
                  </p>
                </div>
              </div>
              <button
                onClick={resetAll}
                className="w-full py-2 text-sm font-medium text-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
              >
                继续生成新分镜
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
                重试
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
