'use client';

import React, { useState } from 'react';
import { ArkVideoGenerateParams } from '@/lib/api/arkVideo';

interface AiVideoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkVideoGenerateParams) => void;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const AiVideoModal: React.FC<AiVideoModalProps> = ({ isOpen, onClose, onConfirm }) => {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState<5 | 10>(5);
  const [imageUrl, setImageUrl] = useState('');
  const [cameraFixed, setCameraFixed] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [imageUrlError, setImageUrlError] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'480p' | '720p' | '1080p'>('720p');

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
    if (value && !isValidUrl(value)) {
      setImageUrlError('请输入有效的 HTTP/HTTPS 链接');
    } else {
      setImageUrlError('');
    }
  };

  const handleSubmit = () => {
    if (!prompt.trim()) return;
    if (imageUrl && !isValidUrl(imageUrl)) {
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
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">AI 视频生成</h2>
              <p className="text-sm text-gray-500 mt-1">Seedance · 字节跳动 Ark 平台</p>
            </div>
            <button
              onClick={handleClose}
              className="w-10 h-10 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors flex items-center justify-center"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              提示词 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={4}
                autoFocus
                placeholder="描述你想要生成的视频内容，例如：一只猫咪在阳光下玩耍，镜头缓缓移动..."
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <span className="absolute bottom-2.5 right-3 text-xs text-gray-400">
                {prompt.length}/500
              </span>
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              视频时长
            </label>
            <div className="flex gap-3">
              {([5, 10] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                    duration === d
                      ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  {d} 秒
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
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
                  className={`flex-1 py-2.5 px-2 rounded-xl text-sm font-medium border transition-all flex flex-col items-center gap-1 ${
                    aspectRatio === value
                      ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                    {icon}
                  </svg>
                  <span>{label}</span>
                  <span className={`text-xs ${aspectRatio === value ? 'text-white/80' : 'text-gray-400'}`}>{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Reference Image URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              参考图片 URL <span className="text-gray-400 text-xs font-normal">（可选）</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <input
                type="text"
                value={imageUrl}
                onChange={(e) => handleImageUrlChange(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className={`w-full border rounded-xl pl-9 pr-4 py-3 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  imageUrlError ? 'border-red-400' : 'border-gray-200'
                }`}
              />
            </div>
            {imageUrlError && (
              <p className="mt-1.5 text-xs text-red-500">{imageUrlError}</p>
            )}
          </div>

          {/* Advanced Options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-gray-600 hover:text-blue-500 transition-colors"
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
              <div className="mt-4 space-y-4 pl-3 border-l-2 border-blue-100">
                {/* Camera Fixed */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">固定镜头</p>
                    <p className="text-xs text-gray-500 mt-0.5">锁定镜头位置，减少镜头移动</p>
                  </div>
                  <div
                    onClick={() => setCameraFixed(!cameraFixed)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex items-center ${
                      cameraFixed ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`absolute w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out ${
                      cameraFixed ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </div>
                </div>

                {/* Watermark */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700">添加水印</p>
                    <p className="text-xs text-gray-500 mt-0.5">在生成视频上添加平台水印</p>
                  </div>
                  <div
                    onClick={() => setWatermark(!watermark)}
                    className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer flex items-center ${
                      watermark ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                  >
                    <div className={`absolute w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ease-in-out ${
                      watermark ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </div>
                </div>

                {/* Resolution */}
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-2">分辨率</p>
                  <div className="flex gap-2">
                    {(['480p', '720p', '1080p'] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setResolution(r)}
                        className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${
                          resolution === r
                            ? 'bg-blue-500 text-white border-blue-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
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
        <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || !!imageUrlError}
            className={`px-6 py-2.5 text-sm font-medium text-white rounded-xl transition-all ${
              prompt.trim() && !imageUrlError
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg'
                : 'bg-gray-300 cursor-not-allowed'
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
