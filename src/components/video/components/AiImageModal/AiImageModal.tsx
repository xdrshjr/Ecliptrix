'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { ArkImageGenerateParams, ArkImageMode } from '@/lib/api/arkImage';
import { StoryboardGenerateParams, StoryboardPack } from '@/types';
import BasicGenerationTab, { BasicGenerationState } from './BasicGenerationTab';
import CharacterModelingTab, { CharacterModelingState } from './CharacterModelingTab';
import SceneModelingTab, { SceneModelingState } from './SceneModelingTab';
import StoryboardTab, { StoryboardTabState } from './StoryboardTab';

interface AiImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkImageGenerateParams) => void;
  onStoryboardGenerate?: (params: StoryboardGenerateParams) => Promise<StoryboardPack>;
}

type TabKey = ArkImageMode | 'storyboard';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'basic', label: '基础生成' },
  { key: 'character', label: '人物建模' },
  { key: 'scene', label: '场景建模' },
  { key: 'storyboard', label: '分镜生成' },
];

const AiImageModal: React.FC<AiImageModalProps> = ({ isOpen, onClose, onConfirm, onStoryboardGenerate }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [submitted, setSubmitted] = useState(false);

  const [basicState, setBasicState] = useState<BasicGenerationState>({
    prompt: '',
    size: '2048x2048',
    count: 1,
    watermark: true,
    referenceImage: null,
  });

  const [characterState, setCharacterState] = useState<CharacterModelingState>({
    prompt: '',
    watermark: true,
    referenceImage: null,
    selectedTemplateId: null,
  });

  const [sceneState, setSceneState] = useState<SceneModelingState>({
    prompt: '',
    watermark: true,
    referenceImage: null,
    selectedTemplateId: null,
  });

  const [storyboardState, setStoryboardState] = useState<StoryboardTabState>({
    prompt: '',
    gridSize: '3x3',
    aspectRatio: '16:9',
    referenceImage: null,
  });

  // Reset form state whenever the modal opens, so previous submitted/state
  // does not leak across open/close cycles (parent may close without calling handleClose).
  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const resetForm = () => {
    setActiveTab('basic');
    setSubmitted(false);
    setBasicState({ prompt: '', size: '2048x2048', count: 1, watermark: true, referenceImage: null });
    setCharacterState({ prompt: '', watermark: true, referenceImage: null, selectedTemplateId: null });
    setSceneState({ prompt: '', watermark: true, referenceImage: null, selectedTemplateId: null });
    setStoryboardState({ prompt: '', gridSize: '3x3', aspectRatio: '16:9', referenceImage: null });
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const getCurrentPrompt = (): string => {
    switch (activeTab) {
      case 'basic': return basicState.prompt;
      case 'character': return characterState.prompt;
      case 'scene': return sceneState.prompt;
      case 'storyboard': return storyboardState.prompt;
    }
  };

  const handleStoryboardGenerate = useCallback(async (tabState: StoryboardTabState): Promise<StoryboardPack> => {
    if (!onStoryboardGenerate) {
      throw new Error('分镜生成功能未配置');
    }
    return onStoryboardGenerate({
      prompt: tabState.prompt,
      gridSize: tabState.gridSize,
      aspectRatio: tabState.aspectRatio,
      referenceImage: tabState.referenceImage || undefined,
    });
  }, [onStoryboardGenerate]);

  const handleSubmit = () => {
    // Storyboard tab has its own generate flow; this handler is only for image generation tabs
    if (activeTab === 'storyboard') return;

    const prompt = getCurrentPrompt().trim();
    if (!prompt || submitted) return;
    setSubmitted(true);

    let params: ArkImageGenerateParams;

    switch (activeTab) {
      case 'basic':
        params = {
          prompt,
          size: basicState.size,
          count: basicState.count,
          watermark: basicState.watermark,
          mode: 'basic',
          reference_image: basicState.referenceImage || undefined,
        };
        break;
      case 'character':
        params = {
          prompt,
          size: '2048x2048',
          count: 1,
          watermark: characterState.watermark,
          mode: 'character',
          reference_image: characterState.referenceImage || undefined,
        };
        break;
      case 'scene':
        params = {
          prompt,
          size: '2048x2048',
          count: 1,
          watermark: sceneState.watermark,
          mode: 'scene',
          reference_image: sceneState.referenceImage || undefined,
        };
        break;
    }

    onConfirm(params);
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
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent transition-colors flex items-center justify-center"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab Bar */}
          <div className="flex gap-1 mt-4 bg-background/50 rounded-md p-1">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
                  activeTab === tab.key
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'basic' && (
            <BasicGenerationTab state={basicState} onChange={setBasicState} />
          )}
          {activeTab === 'character' && (
            <CharacterModelingTab state={characterState} onChange={setCharacterState} />
          )}
          {activeTab === 'scene' && (
            <SceneModelingTab state={sceneState} onChange={setSceneState} />
          )}
          {activeTab === 'storyboard' && (
            <StoryboardTab
              state={storyboardState}
              onChange={setStoryboardState}
              onGenerate={handleStoryboardGenerate}
            />
          )}
        </div>

        {/* Footer — hidden for storyboard tab which has its own generate button */}
        {activeTab !== 'storyboard' && (
          <div className="px-8 py-4 border-t border-border bg-muted/50 flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-6 py-2.5 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSubmit}
              disabled={!getCurrentPrompt().trim() || submitted}
              className="px-6 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitted ? '生成中...' : '开始生成'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiImageModal;
