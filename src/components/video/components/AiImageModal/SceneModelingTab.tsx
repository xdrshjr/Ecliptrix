'use client';

import React from 'react';
import { SCENE_TEMPLATES, PromptTemplate } from './promptTemplates';
import ImageUploadArea from './ImageUploadArea';
import TemplateCard from './TemplateCard';

export interface SceneModelingState {
  prompt: string;
  watermark: boolean;
  referenceImage: string | null;
  selectedTemplateId: string | null;
}

interface SceneModelingTabProps {
  state: SceneModelingState;
  onChange: (state: SceneModelingState) => void;
}

const SceneModelingTab: React.FC<SceneModelingTabProps> = ({ state, onChange }) => {
  const { prompt, watermark, referenceImage, selectedTemplateId } = state;

  const handleTemplateSelect = (template: PromptTemplate) => {
    if (selectedTemplateId === template.id) {
      onChange({ ...state, selectedTemplateId: null, prompt: '' });
    } else {
      onChange({ ...state, selectedTemplateId: template.id, prompt: template.prompt });
    }
  };

  return (
    <div className="space-y-6">
      {/* Template Cards */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">场景模板</label>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {SCENE_TEMPLATES.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              isSelected={selectedTemplateId === t.id}
              onClick={() => handleTemplateSelect(t)}
            />
          ))}
        </div>
      </div>

      {/* Prompt */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2">
          场景描述 <span className="text-destructive">*</span>
        </label>
        <div className="relative">
          <textarea
            value={prompt}
            onChange={(e) => onChange({ ...state, prompt: e.target.value.slice(0, 500), selectedTemplateId: null })}
            rows={4}
            placeholder="描述你想要生成的场景，例如：赛博朋克风格的霓虹夜市，雨天的反光路面，全息广告牌..."
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

      {/* Watermark Toggle */}
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

      {/* Info */}
      <p className="text-xs text-muted-foreground">
        场景建模将生成多视角场景合成图（全景、中景、特写、俯视图），尺寸固定为 2048×2048，数量 1 张。
      </p>
    </div>
  );
};

export default SceneModelingTab;
