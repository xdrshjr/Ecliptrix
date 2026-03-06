'use client';

import React, { useState, useEffect } from 'react';
import { ArkVideoGenerateParams } from '@/lib/api/arkVideo';

interface AiVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkVideoGenerateParams) => void;
  initialImageUrl?: string;
  initialImageName?: string;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isDataUri(value: string): boolean {
  return value.startsWith('data:image/');
}

const AiVideoModal: React.FC<AiVideoModalProps> = ({ isOpen, onClose, onConfirm, initialImageUrl, initialImageName }) => {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);
  const [imageUrl, setImageUrl] = useState('');
  const [cameraFixed, setCameraFixed] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageUrlError, setImageUrlError] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');

  // Pre-fill image URL when modal opens with initialImageUrl
  useEffect(() => {
    if (isOpen && initialImageUrl) {
      setImageUrl(initialImageUrl);
      setImageUrlError('');
    }
  }, [isOpen, initialImageUrl]);

  const resetForm = () => {
    setPrompt('');
    setDuration(5);
    setImageUrl('');
    setCameraFixed(false);
    setWatermark(false);
    setShowAdvanced(false);
    setImageUrlError('');
    setAspectRatio('16:9');
    setResolution('720p');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleImageUrlChange = (value: string) => {
    setImageUrl(value);
    if (value && !isValidUrl(value) && !isDataUri(value)) {
      setImageUrlError('请输入有效的 HTTP/HTTPS 链接');
    } else {
      setImageUrlError('');
    }
  };

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    if (imageUrl && !isValidUrl(imageUrl) && !isDataUri(imageUrl)) {
      setImageUrlError('请输入有效的 HTTP/HTTPS 链接');
      return;
    }
    onConfirm({
      prompt: prompt.trim(),
      duration,
      camera_fixed: cameraFixed,
      watermark,
      image_url: imageUrl.trim() || undefined,
      aspect_ratio: aspectRatio,
      resolution,
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
              <h2 className="text-2xl font-semibold text-foreground">AI 视频生成</h2>
              <p className="text-sm text-muted-foreground mt-1">Seedance · 字节跳动 Ark 平台</p>
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
              {([5, 10] as const).map((d) => (
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

          {/* Aspect Ratio */}
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

          {/* Reference Image URL */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              参考图片 {imageUrl && isDataUri(imageUrl) ? '' : 'URL '}<span className="text-muted-foreground text-xs font-normal">（可选）</span>
            </label>
            {/* Image preview when pre-filled from materials panel */}
            {imageUrl && isDataUri(imageUrl) ? (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-md border border-border">
                <img
                  src={imageUrl}
                  alt={initialImageName || '参考图片'}
                  className="w-16 h-16 object-cover rounded-md border border-border"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{initialImageName || '参考图片'}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">已从素材库选取</p>
                </div>
                <button
                  onClick={() => { setImageUrl(''); setImageUrlError(''); }}
                  className="w-7 h-7 rounded-md bg-accent hover:bg-accent/80 transition-colors flex items-center justify-center flex-shrink-0"
                  title="移除图片"
                >
                  <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => handleImageUrlChange(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className={`w-full border rounded-md pl-9 pr-4 py-3 text-sm text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent ${
                      imageUrlError ? 'border-red-400' : 'border-border'
                    }`}
                  />
                </div>
                {/* Show thumbnail preview for HTTP URLs */}
                {imageUrl && isValidUrl(imageUrl) && (
                  <div className="mt-2 flex items-center gap-3 p-2 bg-muted rounded-md">
                    <img
                      src={imageUrl}
                      alt="预览"
                      className="w-12 h-12 object-cover rounded-md border border-border"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <p className="text-xs text-muted-foreground truncate flex-1">{initialImageName || imageUrl}</p>
                  </div>
                )}
              </>
            )}
            {imageUrlError && (
              <p className="mt-1.5 text-xs text-red-500">{imageUrlError}</p>
            )}
          </div>

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
            disabled={!prompt.trim() || !!imageUrlError}
            className={`px-6 py-2.5 text-sm font-medium text-primary-foreground rounded-md transition-all ${
              prompt.trim() && !imageUrlError
                ? 'bg-primary hover:bg-primary/90'
                : 'bg-muted-foreground/30 cursor-not-allowed'
            }`}
          >
            开始生成
          </button>
        </div>
      </div>
    </div>
  );
};

export default AiVideoModal;
