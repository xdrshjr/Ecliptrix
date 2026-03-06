'use client';

import React, { useState } from 'react';
import { ArkImageGenerateParams, ArkImageSize } from '@/lib/api/arkImage';

interface AiImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkImageGenerateParams) => void;
}

const SIZE_PRESETS = [
  { value: '1024x1024', label: '1K 方形', icon: 'square' },
  { value: '2048x2048', label: '2K 方形', icon: 'square' },
  { value: '1280x720', label: '16:9 横屏', icon: 'landscape' },
  { value: '720x1280', label: '9:16 竖屏', icon: 'portrait' },
  { value: '1024x576', label: '16:9 宽屏', icon: 'landscape' },
  { value: '576x1024', label: '9:16 竖屏宽', icon: 'portrait' },
] as const;

const sizeIcon = (icon: string, active: boolean) => {
  const cls = active ? 'text-white' : 'text-muted-foreground';
  switch (icon) {
    case 'square':
      return (
        <svg className={`w-4 h-4 ${cls}`} viewBox="0 0 24 24" fill="none">
          <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'landscape':
      return (
        <svg className={`w-4 h-4 ${cls}`} viewBox="0 0 24 24" fill="none">
          <rect x="1" y="5" width="22" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case 'portrait':
      return (
        <svg className={`w-4 h-4 ${cls}`} viewBox="0 0 24 24" fill="none">
          <rect x="5" y="1" width="14" height="22" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    default:
      return null;
  }
};

const AiImageModal: React.FC<AiImageModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState<ArkImageSize>('2048x2048');
  const [count, setCount] = useState(1);
  const [watermark, setWatermark] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const resetForm = () => {
    setPrompt('');
    setSize('2048x2048');
    setCount(1);
    setWatermark(true);
    setShowAdvanced(false);
    setSubmitted(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = () => {
    if (!prompt.trim() || submitted) return;
    setSubmitted(true);
    onConfirm({
      prompt: prompt.trim(),
      size,
      count,
      watermark,
    });
  };

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
              <h2 className="text-2xl font-semibold text-foreground">AI 图像生成</h2>
              <p className="text-sm text-muted-foreground mt-1">Seedream · 字节跳动 Ark 平台</p>
            </div>
            <button
              onClick={handleClose}
              className="w-10 h-10 rounded-md bg-muted hover:bg-accent transition-colors flex items-center justify-center"
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
          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              提示词 <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={4}
                autoFocus
                placeholder="描述你想要生成的图片内容，例如：日落时分的海边灯塔，油画风格，温暖的光线..."
                className="w-full border border-border rounded-md px-4 py-3 text-sm text-foreground bg-card resize-none focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              />
              <span className="absolute bottom-2.5 right-3 text-xs text-muted-foreground">
                {prompt.length}/500
              </span>
            </div>
          </div>

          {/* Size */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              图片尺寸
            </label>
            <div className="grid grid-cols-3 gap-2">
              {SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setSize(preset.value)}
                  className={`py-2.5 px-2 rounded-md text-xs font-medium border transition-all flex items-center justify-center gap-1.5 ${
                    size === preset.value
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'bg-card text-foreground border-border hover:border-border'
                  }`}
                >
                  {sizeIcon(preset.icon, size === preset.value)}
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Count */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              生成数量
            </label>
            <div className="flex gap-3">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => setCount(n)}
                  className={`flex-1 py-2.5 rounded-md text-sm font-medium border transition-all ${
                    count === n
                      ? 'bg-pink-500 text-white border-pink-500'
                      : 'bg-card text-foreground border-border hover:border-border'
                  }`}
                >
                  {n} 张
                </button>
              ))}
            </div>
          </div>

          {/* Advanced Options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-pink-500 transition-colors"
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
              <div className="mt-4 space-y-4 pl-3 border-l-2 border-pink-100">
                {/* Watermark */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">添加水印</p>
                    <p className="text-xs text-muted-foreground mt-0.5">在生成图片上添加平台水印</p>
                  </div>
                  <div
                    onClick={() => setWatermark(!watermark)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex items-center ${
                      watermark ? 'bg-pink-500' : 'bg-muted-foreground/30'
                    }`}
                  >
                    <div className={`absolute w-4 h-4 bg-card rounded-full transition-transform duration-200 ease-in-out ${
                      watermark ? 'translate-x-6' : 'translate-x-1'
                    }`} />
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
            disabled={!prompt.trim() || submitted}
            className={`px-6 py-2.5 text-sm font-medium text-white rounded-md transition-all ${
              prompt.trim() && !submitted
                ? 'bg-pink-500 hover:bg-pink-600'
                : 'bg-muted-foreground/30 cursor-not-allowed'
            }`}
          >
            {submitted ? '生成中...' : '开始生成'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiImageModal;
