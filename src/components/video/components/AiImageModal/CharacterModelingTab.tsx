'use client';

import React from 'react';
import { CHARACTER_TEMPLATES, PromptTemplate } from './promptTemplates';
import { MentionedImage } from '@/types';
import TemplateCard from './TemplateCard';
import ReferenceImagePanel from './ReferenceImagePanel';

export interface CharacterModelingState {
  prompt: string;
  watermark: boolean;
  referenceImages: MentionedImage[];
  selectedTemplateId: string | null;
}

interface CharacterModelingTabProps {
  state: CharacterModelingState;
  onChange: React.Dispatch<React.SetStateAction<CharacterModelingState>>;
}

const CharacterModelingTab: React.FC<CharacterModelingTabProps> = ({ state, onChange }) => {
  const { prompt, watermark, referenceImages, selectedTemplateId } = state;
  const MAX_PROMPT_LENGTH = 500;

  const handleTemplateSelect = (template: PromptTemplate) => {
    if (selectedTemplateId === template.id) {
      onChange(prev => ({ ...prev, selectedTemplateId: null, prompt: '' }));
    } else {
      onChange(prev => ({ ...prev, selectedTemplateId: template.id, prompt: template.prompt }));
    }
  };

  return (
    <div className="flex gap-6 h-full">
      {/* Left column: Templates & prompt & settings */}
      <div className="flex-1 min-w-0 space-y-5 overflow-y-auto pr-1">
        {/* Template Cards */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-2">角色模板</label>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {CHARACTER_TEMPLATES.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                isSelected={selectedTemplateId === t.id}
                onClick={() => handleTemplateSelect(t)}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-2">
            角色描述 <span className="text-destructive">*</span>
          </label>
          <div className="relative">
            <textarea
              value={prompt}
              onChange={(e) => onChange(prev => ({ ...prev, prompt: e.target.value.slice(0, MAX_PROMPT_LENGTH), selectedTemplateId: null }))}
              rows={5}
              autoFocus
              placeholder="描述你想要生成的角色，例如：身穿蓝色铠甲的精灵骑士... 从右侧选择参考图"
              className="w-full border border-border rounded-md px-4 py-3 text-sm text-foreground bg-card resize-none focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
            />
            <span className="absolute bottom-2.5 right-3 text-xs text-muted-foreground">
              {prompt.length}/{MAX_PROMPT_LENGTH}
            </span>
          </div>
        </div>

        {/* Watermark Toggle */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">添加水印</p>
            <p className="text-xs text-muted-foreground mt-0.5">在生成图片上添加平台水印</p>
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

        {/* Info */}
        <p className="text-xs text-muted-foreground">
          人物建模将生成 3×3 宫格合成图（9 个固定视角：正面、3/4 左、左侧、背面、右侧、3/4 右、面部特写、半身、全身动作），
          尺寸 2048×2048，并自动裁切为 9 张独立帧形成「人物建模素材包」。
        </p>
      </div>

      {/* Right column: Reference images */}
      <div className="w-64 flex-shrink-0 border-l border-border pl-6">
        <ReferenceImagePanel
          referenceImages={referenceImages}
          onReferenceImagesChange={(imgs) => onChange(prev => ({ ...prev, referenceImages: imgs }))}
          prompt={prompt}
          onPromptChange={(val) => onChange(prev => ({ ...prev, prompt: val }))}
        />
      </div>
    </div>
  );
};

export default CharacterModelingTab;
