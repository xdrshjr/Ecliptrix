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

  const resetForm = () => {
    setPrompt('');
    setDuration(5);
    setImageUrl('');
    setCameraFixed(false);
    setWatermark(false);
    setShowAdvanced(false);
    setImageUrlError('');
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
    });
    // Parent closes the modal via onConfirm handler; form is reset in handleClose
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-[500px] max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </div>
            <div>
              <h2 className="text-white font-semibold text-base">AI 视频生成</h2>
              <p className="text-white/70 text-xs">Seedance · 字节跳动 Ark 平台</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-colors"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Prompt */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              提示词 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                rows={4}
                autoFocus
                placeholder="描述你想要生成的视频内容，例如：一只猫咪在阳光下玩耍，镜头缓缓移动..."
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <span className="absolute bottom-2 right-3 text-xs text-gray-400">
                {prompt.length}/500
              </span>
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              视频时长
            </label>
            <div className="flex space-x-3">
              {([5, 10] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-all ${
                    duration === d
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:border-indigo-400'
                  }`}
                >
                  {d} 秒
                </button>
              ))}
            </div>
          </div>

          {/* Reference Image URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
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
                className={`w-full border rounded-xl pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ${
                  imageUrlError
                    ? 'border-red-400 dark:border-red-500'
                    : 'border-gray-300 dark:border-gray-600'
                }`}
              />
            </div>
            {imageUrlError && (
              <p className="mt-1 text-xs text-red-500">{imageUrlError}</p>
            )}
          </div>

          {/* Advanced Options */}
          <div>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 transition-colors"
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
              <div className="mt-3 space-y-3 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900">
                {/* Camera Fixed */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">固定镜头</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">锁定镜头位置，减少镜头移动</p>
                  </div>
                  <button
                    onClick={() => setCameraFixed(!cameraFixed)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      cameraFixed ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        cameraFixed ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>

                {/* Watermark */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">添加水印</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">在生成视频上添加平台水印</p>
                  </div>
                  <button
                    onClick={() => setWatermark(!watermark)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      watermark ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                        watermark ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex justify-end space-x-3 flex-shrink-0">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!prompt.trim() || !!imageUrlError}
            className={`px-5 py-2 text-sm font-medium text-white rounded-xl transition-all ${
              prompt.trim() && !imageUrlError
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-sm hover:shadow-md'
                : 'bg-gray-300 dark:bg-gray-600 cursor-not-allowed'
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
