'use client';

import React, { useState, useEffect } from 'react';
import { ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import ImagePickerSlot from '../AIVideoScriptTab/ImagePickerSlot';
import { ARK_DURATION_BUCKETS, ArkDurationBucket, isArkDurationBucket, mapSentenceDurationToArkBucket } from '../../utils/arkVideoDuration';

type GenerationMode = 'description' | 'keyframe' | 'reference';

interface AiVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkVideoGenerateParams) => void;
  initialImageUrl?: string;
  initialImageName?: string;
  materials?: MaterialItem[];
  // 新增：句子级入口使用的可选预填
  initialPrompt?: string;
  initialDuration?: number;
  initialMode?: GenerationMode;
  subtitle?: string;
  // 供 duration 提示文案展示用的原始句子秒数（可选）
  sentenceActualDuration?: number;
}

const AiVideoModal: React.FC<AiVideoModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  initialImageUrl,
  materials,
  initialPrompt,
  initialDuration,
  initialMode,
  subtitle,
  sentenceActualDuration,
}) => {
  const { t } = useLocale();
  const [mode, setMode] = useState<GenerationMode>('description');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<number>(5);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');

  // Mode A (description) state — up to 4 reference images
  const [descImageUrls, setDescImageUrls] = useState<string[]>(['', '', '', '']);
  const [descImageNames, setDescImageNames] = useState<string[]>(['', '', '', '']);

  // Mode B (keyframe) state — first frame required + up to 3 additional reference images
  const [firstFrameUrl, setFirstFrameUrl] = useState('');
  const [firstFrameName, setFirstFrameName] = useState('');
  const [keyframeRefUrls, setKeyframeRefUrls] = useState<string[]>(['', '', '']);
  const [keyframeRefNames, setKeyframeRefNames] = useState<string[]>(['', '', '']);

  // Mode C (reference) state — up to 4 reference images
  const [refImageUrls, setRefImageUrls] = useState<string[]>(['', '', '', '']);
  const [refImageNames, setRefImageNames] = useState<string[]>(['', '', '', '']);

  // Pre-fill from MaterialsPanel: set keyframe mode + fill firstFrameUrl
  useEffect(() => {
    if (isOpen && initialImageUrl) {
      setMode('keyframe');
      setFirstFrameUrl(initialImageUrl);
      setFirstFrameName('');
    }
  }, [isOpen, initialImageUrl]);

  // Pre-fill for sentence-level entry: apply initialPrompt/Duration/Mode when opened
  useEffect(() => {
    if (!isOpen) return;
    if (typeof initialPrompt === 'string') {
      setPrompt(initialPrompt.slice(0, 500));
    }
    if (typeof initialDuration === 'number') {
      if (isArkDurationBucket(initialDuration)) {
        setDuration(initialDuration);
      } else {
        const fallback: ArkDurationBucket = mapSentenceDurationToArkBucket(initialDuration);
        // eslint-disable-next-line no-console
        console.warn('[AiVideoModal] initialDuration not in bucket, snapping', { initialDuration, fallback });
        setDuration(fallback);
      }
    }
    if (initialMode && !initialImageUrl) {
      // 仅在没有 initialImageUrl 自动切 keyframe 的场景下，才遵循 initialMode
      setMode(initialMode);
    }
  }, [isOpen, initialPrompt, initialDuration, initialMode, initialImageUrl]);

  const descLabels = [
    t.scriptPanel.aiVideoScript.characterImage,
    t.scriptPanel.aiVideoScript.sceneImage,
    t.scriptPanel.aiVideoScript.referenceImage3,
    t.scriptPanel.aiVideoScript.referenceImage4,
  ];

  const keyframeRefLabels = [
    `${t.scriptPanel.aiVideoScript.lastFrameImage} ${t.scriptPanel.aiVideoScript.lastFrameOptional}`,
    t.scriptPanel.aiVideoScript.referenceImage3,
    t.scriptPanel.aiVideoScript.referenceImage4,
  ];

  const refLabels = [
    `${t.scriptPanel.aiVideoScript.referenceImage1} ${t.scriptPanel.aiVideoScript.firstFrameRequired}`,
    `${t.scriptPanel.aiVideoScript.referenceImage2} ${t.scriptPanel.aiVideoScript.lastFrameOptional}`,
    `${t.scriptPanel.aiVideoScript.referenceImage3} ${t.scriptPanel.aiVideoScript.lastFrameOptional}`,
    `${t.scriptPanel.aiVideoScript.referenceImage4} ${t.scriptPanel.aiVideoScript.lastFrameOptional}`,
  ];

  const resetForm = () => {
    setMode(initialMode ?? 'description');
    setPrompt(initialPrompt ?? '');
    setDuration(
      typeof initialDuration === 'number' && isArkDurationBucket(initialDuration)
        ? initialDuration
        : typeof initialDuration === 'number'
          ? mapSentenceDurationToArkBucket(initialDuration)
          : 5,
    );
    setCameraFixed(false);
    setWatermark(false);
    setShowAdvanced(false);
    setAspectRatio('16:9');
    setResolution('720p');
    setDescImageUrls(['', '', '', '']);
    setDescImageNames(['', '', '', '']);
    setFirstFrameUrl('');
    setFirstFrameName('');
    setKeyframeRefUrls(['', '', '']);
    setKeyframeRefNames(['', '', '']);
    setRefImageUrls(['', '', '', '']);
    setRefImageNames(['', '', '', '']);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleModeSwitch = (newMode: GenerationMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setDescImageUrls(['', '', '', '']);
    setDescImageNames(['', '', '', '']);
    setFirstFrameUrl('');
    setFirstFrameName('');
    setKeyframeRefUrls(['', '', '']);
    setKeyframeRefNames(['', '', '']);
    setRefImageUrls(['', '', '', '']);
    setRefImageNames(['', '', '', '']);
  };

  const handleSubmit = () => {
    if (!prompt.trim()) return;

    if (mode === 'keyframe') {
      if (!firstFrameUrl.trim()) return;

      const imageUrls = [firstFrameUrl.trim(), ...keyframeRefUrls.map(u => u.trim()).filter(Boolean)];
      onConfirm({
        prompt: prompt.trim(),
        mode: 'keyframe',
        first_frame_url: firstFrameUrl.trim(),
        last_frame_url: keyframeRefUrls[0].trim() || undefined,
        image_urls: imageUrls.length > 0 ? imageUrls : undefined,
        duration,
        resolution,
        camera_fixed: cameraFixed,
        watermark,
      });
    } else if (mode === 'reference') {
      const imageUrls = refImageUrls.map(u => u.trim()).filter(Boolean);
      if (imageUrls.length === 0) return;

      onConfirm({
        prompt: prompt.trim(),
        mode: 'reference',
        image_urls: imageUrls,
        duration,
        aspect_ratio: aspectRatio,
        resolution,
        camera_fixed: cameraFixed,
        watermark,
      });
    } else {
      const imageUrls = descImageUrls.map(u => u.trim()).filter(Boolean);

      onConfirm({
        prompt: prompt.trim(),
        mode: 'description',
        image_urls: imageUrls.length > 0 ? imageUrls : undefined,
        duration,
        aspect_ratio: aspectRatio,
        resolution,
        camera_fixed: cameraFixed,
        watermark,
      });
    }
  };

  const isKeyframeMissingFirstFrame = mode === 'keyframe' && !firstFrameUrl.trim();
  const isReferenceMissingImage = mode === 'reference' && refImageUrls.every(u => !u.trim());
  const isSubmitDisabled = !prompt.trim() || isKeyframeMissingFirstFrame || isReferenceMissingImage;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-card rounded-md border border-border w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-8 py-6 border-b border-border bg-muted">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">{t.scriptPanel.aiVideoScript.modalTitle}</h2>
              <p className="text-sm text-muted-foreground mt-1">{subtitle ?? t.scriptPanel.aiVideoScript.modalSubtitle}</p>
            </div>
            <button
              onClick={handleClose}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent transition-colors flex items-center justify-center"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {/* Mode SegmentedControl — same style as AIVideoScriptTab */}
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              onClick={() => handleModeSwitch('keyframe')}
              className={`flex-1 py-2 text-sm font-medium transition-colors ${
                mode === 'keyframe'
                  ? 'bg-purple-500 text-white dark:bg-purple-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent dark:bg-muted dark:text-muted-foreground'
              }`}
            >
              {t.scriptPanel.aiVideoScript.modeKeyframe}
            </button>
            <button
              onClick={() => handleModeSwitch('reference')}
              className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-border ${
                mode === 'reference'
                  ? 'bg-purple-500 text-white dark:bg-purple-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent dark:bg-muted dark:text-muted-foreground'
              }`}
            >
              {t.scriptPanel.aiVideoScript.modeReference}
            </button>
            <button
              onClick={() => handleModeSwitch('description')}
              className={`flex-1 py-2 text-sm font-medium transition-colors border-l border-border ${
                mode === 'description'
                  ? 'bg-purple-500 text-white dark:bg-purple-600'
                  : 'bg-muted text-muted-foreground hover:text-foreground hover:bg-accent dark:bg-muted dark:text-muted-foreground'
              }`}
            >
              {t.scriptPanel.aiVideoScript.modeDescription}
            </button>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t.scriptPanel.aiVideoScript.promptLabel} <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={4}
                autoFocus
                placeholder={t.scriptPanel.aiVideoScript.promptPlaceholder}
                className="w-full border border-border rounded-md px-4 py-3 text-sm text-foreground bg-card resize-none focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
              <span className="absolute bottom-2.5 right-3 text-xs text-muted-foreground">
                {prompt.length}/500
              </span>
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t.scriptPanel.aiVideoScript.durationLabel}
            </label>
            <div className="flex gap-3">
              {ARK_DURATION_BUCKETS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2.5 rounded-md text-sm font-medium border transition-all ${
                    duration === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-foreground border-border hover:border-border'
                  }`}
                >
                  {d} {t.scriptPanel.aiVideoScript.durationSeconds}
                </button>
              ))}
            </div>
            {typeof sentenceActualDuration === 'number' && Number.isFinite(sentenceActualDuration) && sentenceActualDuration > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t.scriptPanel.aiVideoScript.sentenceAiVideoDurationHint
                  .replace('{actual}', sentenceActualDuration.toFixed(1))
                  .replace('{bucket}', String(duration))}
              </p>
            )}
          </div>

          {/* Aspect Ratio — hidden in keyframe mode (forced to adaptive) */}
          {mode !== 'keyframe' && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t.scriptPanel.aiVideoScript.aspectRatioLabel}
              </label>
              <div className="flex gap-3">
                {([
                  { value: '16:9' as const, label: '16:9', desc: t.scriptPanel.aiVideoScript.landscape, icon: (
                    <rect x="1" y="4" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  )},
                  { value: '9:16' as const, label: '9:16', desc: t.scriptPanel.aiVideoScript.portrait, icon: (
                    <rect x="7" y="1" width="10" height="22" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  )},
                  { value: '1:1' as const, label: '1:1', desc: t.scriptPanel.aiVideoScript.square, icon: (
                    <rect x="3" y="3" width="18" height="18" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  )},
                ]).map(({ value, label, desc, icon }) => (
                  <button
                    key={value}
                    onClick={() => setAspectRatio(value)}
                    className={`flex-1 py-2.5 px-2 rounded-md text-sm font-medium border transition-all flex flex-col items-center gap-1 ${
                      aspectRatio === value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-foreground border-border hover:border-border'
                    }`}
                  >
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                      {icon}
                    </svg>
                    <span>{label}</span>
                    <span className={`text-xs ${aspectRatio === value ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Image inputs — conditional on mode, using ImagePickerSlot */}
          {mode === 'description' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {descImageUrls.map((url, i) => (
                  <ImagePickerSlot
                    key={i}
                    label={descLabels[i]}
                    imageUrl={url || undefined}
                    imageName={descImageNames[i] || undefined}
                    onSelect={(url, name) => {
                      const newUrls = [...descImageUrls];
                      const newNames = [...descImageNames];
                      newUrls[i] = url;
                      newNames[i] = name;
                      setDescImageUrls(newUrls);
                      setDescImageNames(newNames);
                    }}
                    onRemove={() => {
                      const newUrls = [...descImageUrls];
                      const newNames = [...descImageNames];
                      newUrls[i] = '';
                      newNames[i] = '';
                      setDescImageUrls(newUrls);
                      setDescImageNames(newNames);
                    }}
                    materials={materials}
                  />
                ))}
              </div>
            </div>
          ) : mode === 'keyframe' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.firstFrameImage} ${t.scriptPanel.aiVideoScript.firstFrameRequired}`}
                  imageUrl={firstFrameUrl || undefined}
                  imageName={firstFrameName || undefined}
                  onSelect={(url, name) => { setFirstFrameUrl(url); setFirstFrameName(name); }}
                  onRemove={() => { setFirstFrameUrl(''); setFirstFrameName(''); }}
                  materials={materials}
                />
                {keyframeRefUrls.map((url, i) => (
                  <ImagePickerSlot
                    key={i}
                    label={keyframeRefLabels[i]}
                    imageUrl={url || undefined}
                    imageName={keyframeRefNames[i] || undefined}
                    onSelect={(url, name) => {
                      const newUrls = [...keyframeRefUrls];
                      const newNames = [...keyframeRefNames];
                      newUrls[i] = url;
                      newNames[i] = name;
                      setKeyframeRefUrls(newUrls);
                      setKeyframeRefNames(newNames);
                    }}
                    onRemove={() => {
                      const newUrls = [...keyframeRefUrls];
                      const newNames = [...keyframeRefNames];
                      newUrls[i] = '';
                      newNames[i] = '';
                      setKeyframeRefUrls(newUrls);
                      setKeyframeRefNames(newNames);
                    }}
                    materials={materials}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {refImageUrls.map((url, i) => (
                  <ImagePickerSlot
                    key={i}
                    label={refLabels[i]}
                    imageUrl={url || undefined}
                    imageName={refImageNames[i] || undefined}
                    onSelect={(url, name) => {
                      const newUrls = [...refImageUrls];
                      const newNames = [...refImageNames];
                      newUrls[i] = url;
                      newNames[i] = name;
                      setRefImageUrls(newUrls);
                      setRefImageNames(newNames);
                    }}
                    onRemove={() => {
                      const newUrls = [...refImageUrls];
                      const newNames = [...refImageNames];
                      newUrls[i] = '';
                      newNames[i] = '';
                      setRefImageUrls(newUrls);
                      setRefImageNames(newNames);
                    }}
                    materials={materials}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Advanced Options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>{t.scriptPanel.aiVideoScript.advancedOptions}</span>
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-3 border-l-2 border-primary/20">
                {/* Camera Fixed */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.scriptPanel.aiVideoScript.fixedCamera}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.scriptPanel.aiVideoScript.fixedCameraDesc}</p>
                  </div>
                  <div
                    onClick={() => setCameraFixed(!cameraFixed)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex items-center ${
                      cameraFixed ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <div className={`absolute w-4 h-4 bg-card rounded-full transition-transform duration-200 ease-in-out ${
                      cameraFixed ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </div>
                </div>

                {/* Watermark */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{t.scriptPanel.aiVideoScript.addWatermark}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t.scriptPanel.aiVideoScript.addWatermarkDesc}</p>
                  </div>
                  <div
                    onClick={() => setWatermark(!watermark)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex items-center ${
                      watermark ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <div className={`absolute w-4 h-4 bg-card rounded-full transition-transform duration-200 ease-in-out ${
                      watermark ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <p className="text-sm font-medium text-foreground mb-2">{t.scriptPanel.aiVideoScript.resolutionLabel}</p>
                  <div className="flex gap-2">
                    {(['480p', '720p', '1080p'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setResolution(r)}
                        className={`flex-1 py-2 rounded-md text-xs font-medium border transition-all ${
                          resolution === r
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card text-muted-foreground border-border hover:border-border'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-border bg-muted/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-6 py-2.5 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
          >
            {t.scriptPanel.aiVideoScript.cancel}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="px-6 py-2.5 text-sm font-medium text-primary-foreground rounded-md bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t.scriptPanel.aiVideoScript.startGenerate}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiVideoModal;
