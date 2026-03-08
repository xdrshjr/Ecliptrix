'use client';

import React from 'react';
import { ArkImageSize } from '@/lib/api/arkImage';
import ImageUploadArea from './ImageUploadArea';

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

export interface BasicGenerationState {
  prompt: string;
  size: ArkImageSize;
  count: number;
  watermark: boolean;
  referenceImage: string | null;
}

interface BasicGenerationTabProps {
  state: BasicGenerationState;
  onChange: (state: BasicGenerationState) => void;
}

const BasicGenerationTab: React.FC<BasicGenerationTabProps> = ({ state, onChange }) => {
  const { prompt, size, count, watermark, referenceImage } = state;
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  return (
    <div className="space-y-6">
      {/* Prompt */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          提示词 <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => onChange({ ...state, prompt: e.target.value.slice(0, 500) })}
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

      {/* Reference Image */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">参考图</label>
        <ImageUploadArea
          value={referenceImage}
          onChange={(val) => onChange({ ...state, referenceImage: val })}
        />
      </div>

      {/* Size */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">图片尺寸</label>
        <div className="grid grid-cols-3 gap-2">
          {SIZE_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => onChange({ ...state, size: preset.value })}
              className={`py-2.5 px-2 rounded-md text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                size === preset.value
                  ? 'bg-primary text-primary-foreground border-primary'
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
        <label className="block text-sm font-medium text-foreground mb-2">生成数量</label>
        <div className="flex gap-3">
          {([1, 2, 3, 4] as const).map((n) => (
            <button
              key={n}
              onClick={() => onChange({ ...state, count: n })}
              className={`flex-1 py-2.5 rounded-md text-sm font-medium border transition-colors ${
                count === n
                  ? 'bg-primary text-primary-foreground border-primary'
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
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">添加水印</p>
                <p className="text-xs text-muted-foreground mt-0.5">在生成图片上添加平台水印</p>
              </div>
              <div
                onClick={() => onChange({ ...state, watermark: !watermark })}
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
  );
};

export default BasicGenerationTab;
