'use client';

import React, { useState, useEffect } from 'react';
import { ArkVideoGenerateParams } from '@/lib/api/arkVideo';
import { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import ImagePickerSlot from '../AIVideoScriptTab/ImagePickerSlot';

interface AiVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkVideoGenerateParams) => void;
  initialImageUrl?: string;
  initialImageName?: string;
  materials?: MaterialItem[];
}

type GenerationMode = 'description' | 'keyframe' | 'reference';

const AiVideoModal: React.FC<AiVideoModalProps> = ({ isOpen, onClose, onConfirm, initialImageUrl, materials }) => {
  const { t } = useLocale();
  const [mode, setMode] = useState<GenerationMode>('description');
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<number>(5);
  const [cameraFixed, setCameraFixed] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');

  // Mode A (description) state
  const [characterImageUrl, setCharacterImageUrl] = useState('');
  const [characterImageName, setCharacterImageName] = useState('');
  const [sceneImageUrl, setSceneImageUrl] = useState('');
  const [sceneImageName, setSceneImageName] = useState('');

  // Mode B (keyframe) state
  const [firstFrameUrl, setFirstFrameUrl] = useState('');
  const [firstFrameName, setFirstFrameName] = useState('');
  const [lastFrameUrl, setLastFrameUrl] = useState('');
  const [lastFrameName, setLastFrameName] = useState('');

  // Mode C (reference) state
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  const [referenceImageName, setReferenceImageName] = useState('');
  const [referenceImage2Url, setReferenceImage2Url] = useState('');
  const [referenceImage2Name, setReferenceImage2Name] = useState('');

  // Pre-fill from MaterialsPanel: set keyframe mode + fill firstFrameUrl
  useEffect(() => {
    if (isOpen && initialImageUrl) {
      setMode('keyframe');
      setFirstFrameUrl(initialImageUrl);
      setFirstFrameName('');
    }
  }, [isOpen, initialImageUrl]);

  const resetForm = () => {
    setMode('description');
    setPrompt('');
    setDuration(5);
    setCameraFixed(false);
    setWatermark(false);
    setShowAdvanced(false);
    setAspectRatio('16:9');
    setResolution('720p');
    setCharacterImageUrl('');
    setCharacterImageName('');
    setSceneImageUrl('');
    setSceneImageName('');
    setFirstFrameUrl('');
    setFirstFrameName('');
    setLastFrameUrl('');
    setLastFrameName('');
    setReferenceImageUrl('');
    setReferenceImageName('');
    setReferenceImage2Url('');
    setReferenceImage2Name('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleModeSwitch = (newMode: GenerationMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    setCharacterImageUrl('');
    setCharacterImageName('');
    setSceneImageUrl('');
    setSceneImageName('');
    setFirstFrameUrl('');
    setFirstFrameName('');
    setLastFrameUrl('');
    setLastFrameName('');
    setReferenceImageUrl('');
    setReferenceImageName('');
    setReferenceImage2Url('');
    setReferenceImage2Name('');
  };

  const handleSubmit = () => {
    if (!prompt.trim()) return;

    if (mode === 'keyframe') {
      if (!firstFrameUrl.trim()) return;

      onConfirm({
        prompt: prompt.trim(),
        mode: 'keyframe',
        first_frame_url: firstFrameUrl.trim(),
        last_frame_url: lastFrameUrl.trim() || undefined,
        duration,
        resolution,
        camera_fixed: cameraFixed,
        watermark,
      });
    } else if (mode === 'reference') {
      const imageUrls = [referenceImageUrl.trim(), referenceImage2Url.trim()].filter(Boolean);
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
      const imageUrls = [characterImageUrl.trim(), sceneImageUrl.trim()].filter(Boolean);

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
  const isReferenceMissingImage = mode === 'reference' && !referenceImageUrl.trim();
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
              <h2 className="text-2xl font-semibold text-foreground">AI 视频生成</h2>
              <p className="text-sm text-muted-foreground mt-1">Seedance · 字节跳动 Ark 平台</p>
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
              提示词 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={4}
                autoFocus
                placeholder="描述你想要生成的视频内容，例如：一只猫咪在阳光下玩耍，镜头缓缓移动..."
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
              视频时长
            </label>
            <div className="flex gap-3">
              {[5, 7, 10, 12].map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2.5 rounded-md text-sm font-medium border transition-all ${
                    duration === d
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-foreground border-border hover:border-border'
                  }`}
                >
                  {d} 秒
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio — hidden in keyframe mode (forced to adaptive) */}
          {mode !== 'keyframe' && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                视频比例
              </label>
              <div className="flex gap-3">
                {([
                  { value: '16:9' as const, label: '16:9', desc: '横屏', icon: (
                    <rect x="1" y="4" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  )},
                  { value: '9:16' as const, label: '9:16', desc: '竖屏', icon: (
                    <rect x="7" y="1" width="10" height="22" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                  )},
                  { value: '1:1' as const, label: '1:1', desc: '方形', icon: (
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
              <div className="flex gap-3">
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.characterImage || '角色形象'}`}
                  imageUrl={characterImageUrl || undefined}
                  imageName={characterImageName || undefined}
                  onSelect={(url, name) => { setCharacterImageUrl(url); setCharacterImageName(name); }}
                  onRemove={() => { setCharacterImageUrl(''); setCharacterImageName(''); }}
                  materials={materials}
                />
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.sceneImage || '场景形象'}`}
                  imageUrl={sceneImageUrl || undefined}
                  imageName={sceneImageName || undefined}
                  onSelect={(url, name) => { setSceneImageUrl(url); setSceneImageName(name); }}
                  onRemove={() => { setSceneImageUrl(''); setSceneImageName(''); }}
                  materials={materials}
                />
              </div>
            </div>
          ) : mode === 'keyframe' ? (
            <div className="space-y-4">
              <div className="flex gap-3">
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.firstFrameImage || '首帧图片'} ${t.scriptPanel.aiVideoScript.firstFrameRequired || '*必填'}`}
                  imageUrl={firstFrameUrl || undefined}
                  imageName={firstFrameName || undefined}
                  onSelect={(url, name) => { setFirstFrameUrl(url); setFirstFrameName(name); }}
                  onRemove={() => { setFirstFrameUrl(''); setFirstFrameName(''); }}
                  materials={materials}
                />
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.lastFrameImage || '尾帧图片'} ${t.scriptPanel.aiVideoScript.lastFrameOptional || '(可选)'}`}
                  imageUrl={lastFrameUrl || undefined}
                  imageName={lastFrameName || undefined}
                  onSelect={(url, name) => { setLastFrameUrl(url); setLastFrameName(name); }}
                  onRemove={() => { setLastFrameUrl(''); setLastFrameName(''); }}
                  materials={materials}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-3">
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.referenceImage1 || '参考图1'} ${t.scriptPanel.aiVideoScript.firstFrameRequired || '*必填'}`}
                  imageUrl={referenceImageUrl || undefined}
                  imageName={referenceImageName || undefined}
                  onSelect={(url, name) => { setReferenceImageUrl(url); setReferenceImageName(name); }}
                  onRemove={() => { setReferenceImageUrl(''); setReferenceImageName(''); }}
                  materials={materials}
                />
                <ImagePickerSlot
                  label={`${t.scriptPanel.aiVideoScript.referenceImage2 || '参考图2'} ${t.scriptPanel.aiVideoScript.lastFrameOptional || '(可选)'}`}
                  imageUrl={referenceImage2Url || undefined}
                  imageName={referenceImage2Name || undefined}
                  onSelect={(url, name) => { setReferenceImage2Url(url); setReferenceImage2Name(name); }}
                  onRemove={() => { setReferenceImage2Url(''); setReferenceImage2Name(''); }}
                  materials={materials}
                />
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
              <span>高级选项</span>
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-3 border-l-2 border-primary/20">
                {/* Camera Fixed */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">固定镜头</p>
                    <p className="text-xs text-muted-foreground mt-0.5">锁定镜头位置，减少镜头移动</p>
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
                    <p className="text-sm font-medium text-foreground">添加水印</p>
                    <p className="text-xs text-muted-foreground mt-0.5">在生成视频上添加平台水印</p>
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
                  <p className="text-sm font-medium text-foreground mb-2">分辨率</p>
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
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
            className="px-6 py-2.5 text-sm font-medium text-primary-foreground rounded-md bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            开始生成
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiVideoModal;
