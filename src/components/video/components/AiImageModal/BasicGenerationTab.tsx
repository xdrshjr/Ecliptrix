'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { ArkImageSize } from '@/lib/api/arkImage';
import { MentionedImage } from '@/types';
import ReferenceImagePanel from './ReferenceImagePanel';

const SIZE_PRESETS = [
  { value: '1024x1024', icon: 'square' },
  { value: '2048x2048', icon: 'square' },
  { value: '1280x720', icon: 'landscape' },
  { value: '720x1280', icon: 'portrait' },
  { value: '1024x576', icon: 'landscape' },
  { value: '576x1024', icon: 'portrait' },
] as const;

const SIZE_LABEL_KEYS: Record<string, string> = {
  '1024x1024': 'size1kSquare',
  '2048x2048': 'size2kSquare',
  '1280x720': 'size169Landscape',
  '720x1280': 'size916Portrait',
  '1024x576': 'size169Wide',
  '576x1024': 'size916Wide',
};

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
  referenceImages: MentionedImage[];
}

interface BasicGenerationTabProps {
  state: BasicGenerationState;
  onChange: React.Dispatch<React.SetStateAction<BasicGenerationState>>;
  projectId?: string;
}

const BasicGenerationTab: React.FC<BasicGenerationTabProps> = ({ state, onChange, projectId }) => {
  const { t } = useLocale();
  const { prompt, size, count, watermark, referenceImages } = state;
  const MAX_PROMPT_LENGTH = 500;

  return (
    <div className="flex gap-6 h-full">
      {/* Left column: Prompt & settings */}
      <div className="flex-1 min-w-0 space-y-5 overflow-y-auto pl-2 pr-1">
        {/* Prompt */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            {t.basicGenerationTab.promptLabel} <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => onChange(prev => ({ ...prev, prompt: e.target.value.slice(0, MAX_PROMPT_LENGTH) }))}
              rows={5}
              autoFocus
              placeholder={t.basicGenerationTab.promptPlaceholder}
              className="w-full border border-border rounded-md px-4 py-3 text-sm text-foreground bg-card resize-none focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
            <span className="absolute bottom-2.5 right-3 text-xs text-muted-foreground">
              {prompt.length}/{MAX_PROMPT_LENGTH}
            </span>
          </div>
        </div>

        {/* Size */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">{t.basicGenerationTab.sizeLabel}</label>
          <div className="grid grid-cols-3 gap-2">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                onClick={() => onChange(prev => ({ ...prev, size: preset.value }))}
                className={`py-2.5 px-2 rounded-md text-xs font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                  size === preset.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:border-border'
                }`}
              >
                {sizeIcon(preset.icon, size === preset.value)}
                <span className="truncate min-w-0">{t.basicGenerationTab[SIZE_LABEL_KEYS[preset.value] as keyof typeof t.basicGenerationTab]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Count */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">{t.basicGenerationTab.countLabel}</label>
          <div className="flex gap-3">
            {([1, 2, 3, 4] as const).map((n) => (
              <button
                key={n}
                onClick={() => onChange(prev => ({ ...prev, count: n }))}
                className={`flex-1 py-2.5 rounded-md text-sm font-medium border transition-colors ${
                  count === n
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-foreground border-border hover:border-border'
                }`}
              >
                {n} {t.basicGenerationTab.countUnit}
              </button>
            ))}
          </div>
        </div>

        {/* Watermark */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">{t.basicGenerationTab.watermarkLabel}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t.basicGenerationTab.watermarkDesc}</p>
          </div>
          <div
            onClick={() => onChange(prev => ({ ...prev, watermark: !prev.watermark }))}
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

      {/* Right column: Reference images — always visible, fixed height, scrollable */}
      <div className="w-64 flex-shrink-0 border-l border-border pl-6">
        <ReferenceImagePanel
          referenceImages={referenceImages}
          onReferenceImagesChange={(imgs) => onChange(prev => ({ ...prev, referenceImages: imgs }))}
          prompt={prompt}
          onPromptChange={(val) => onChange(prev => ({ ...prev, prompt: val }))}
          projectId={projectId}
        />
      </div>
    </div>
  );
};

export default BasicGenerationTab;
