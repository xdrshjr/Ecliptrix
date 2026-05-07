'use client';

import React, { useState, useCallback } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { ArkImageGenerateParams, ArkImageMode } from '@/lib/api/arkImage';
import { StoryboardGenerateParams, StoryboardPack, MentionedImage, ScriptMessage } from '@/types';
import BasicGenerationTab, { BasicGenerationState } from './BasicGenerationTab';
import CharacterModelingTab, { CharacterModelingState } from './CharacterModelingTab';
import SceneModelingTab, { SceneModelingState } from './SceneModelingTab';
import StoryboardTab, { StoryboardTabState } from './StoryboardTab';

interface AiImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (params: ArkImageGenerateParams) => void;
  // The modal builds the storyboard params from its own state — the parent
  // (MaterialsPanel) is responsible for injecting the owning projectId
  // before calling the API client. Hence the modal hands the parent the
  // params *without* projectId.
  onStoryboardGenerate?: (params: Omit<StoryboardGenerateParams, 'projectId'>) => Promise<StoryboardPack>;
  /** Owning project id — forwarded to the reference picker so frame
   *  packs (which are project-scoped) appear inside the picker tabs. */
  projectId?: string;
}

type TabKey = ArkImageMode | 'storyboard';

const TAB_KEYS: TabKey[] = ['basic', 'character', 'scene', 'storyboard'];

const AiImageModal: React.FC<AiImageModalProps> = ({ isOpen, onClose, onConfirm, onStoryboardGenerate, projectId }) => {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('basic');
  const [submitted, setSubmitted] = useState(false);

  const TAB_LABELS: Record<TabKey, string> = {
    basic: t.aiImageModal.tabBasic,
    character: t.aiImageModal.tabCharacter,
    scene: t.aiImageModal.tabScene,
    storyboard: t.aiImageModal.tabStoryboard,
  };

  const [basicState, setBasicState] = useState<BasicGenerationState>({
    prompt: '',
    size: '2048x2048',
    count: 1,
    watermark: true,
    referenceImages: [],
  });

  const [characterState, setCharacterState] = useState<CharacterModelingState>({
    prompt: '',
    watermark: true,
    referenceImages: [],
    selectedTemplateId: null,
  });

  const [sceneState, setSceneState] = useState<SceneModelingState>({
    prompt: '',
    watermark: true,
    referenceImages: [],
    selectedTemplateId: null,
  });

  const [storyboardState, setStoryboardState] = useState<StoryboardTabState>({
    prompt: '',
    frameCount: 4,
    aspectRatio: '16:9',
    referenceImages: [],
  });

  // Reset is intentionally only on handleClose — the previous useEffect([isOpen])
  // reset would wipe user-selected reference images whenever the parent toggled
  // isOpen, causing the "reference images disappear" regression.
  const resetForm = () => {
    setActiveTab('basic');
    setSubmitted(false);
    setBasicState({ prompt: '', size: '2048x2048', count: 1, watermark: true, referenceImages: [] });
    setCharacterState({ prompt: '', watermark: true, referenceImages: [], selectedTemplateId: null });
    setSceneState({ prompt: '', watermark: true, referenceImages: [], selectedTemplateId: null });
    setStoryboardState({ prompt: '', frameCount: 4, aspectRatio: '16:9', referenceImages: [] });
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

  const buildMultiImageParams = useCallback((images: MentionedImage[], prompt: string) => {
    const reference_images = images.length > 0 ? images.map(img => img.url) : undefined;
    const mentioned_images: Record<string, string> = {};
    for (const img of images) {
      const tag = `@[${img.name}]`;
      if (prompt.includes(tag)) {
        mentioned_images[tag] = img.url;
      }
    }
    const reference_image = images.length === 1 ? images[0].url : undefined;
    return { reference_images, mentioned_images: Object.keys(mentioned_images).length > 0 ? mentioned_images : undefined, reference_image };
  }, []);

  const handleStoryboardGenerate = useCallback(async (
    tabState: StoryboardTabState,
    opts?: { frameScripts?: string[]; scriptHistory?: ScriptMessage[]; locale?: 'zh' | 'en' },
  ): Promise<StoryboardPack> => {
    if (!onStoryboardGenerate) {
      throw new Error(t.storyboardTab.scriptGenerateFailed);
    }
    const { reference_images, mentioned_images, reference_image } = buildMultiImageParams(tabState.referenceImages, tabState.prompt);
    return onStoryboardGenerate({
      prompt: tabState.prompt,
      frameCount: tabState.frameCount,
      aspectRatio: tabState.aspectRatio,
      referenceImage: reference_image,
      referenceImages: reference_images,
      mentionedImages: mentioned_images,
      frameScripts: opts?.frameScripts,
      scriptHistory: opts?.scriptHistory,
      locale: opts?.locale,
    });
  }, [onStoryboardGenerate, buildMultiImageParams]);

  const handleSubmit = () => {
    // Storyboard tab has its own generate flow; this handler is only for image generation tabs
    if (activeTab === 'storyboard') return;

    const prompt = getCurrentPrompt().trim();
    if (!prompt || submitted) return;
    setSubmitted(true);

    let params: ArkImageGenerateParams;

    switch (activeTab) {
      case 'basic': {
        const { reference_images, mentioned_images, reference_image } = buildMultiImageParams(basicState.referenceImages, prompt);
        params = {
          prompt,
          size: basicState.size,
          count: basicState.count,
          watermark: basicState.watermark,
          mode: 'basic',
          reference_image,
          reference_images,
          mentioned_images,
        };
        break;
      }
      case 'character': {
        const { reference_images, mentioned_images, reference_image } = buildMultiImageParams(characterState.referenceImages, prompt);
        params = {
          prompt,
          size: '2048x2048',
          count: 1,
          watermark: characterState.watermark,
          mode: 'character',
          grid_mode: true,
          aspect_ratio: '1:1',
          reference_image,
          reference_images,
          mentioned_images,
        };
        break;
      }
      case 'scene': {
        const { reference_images, mentioned_images, reference_image } = buildMultiImageParams(sceneState.referenceImages, prompt);
        params = {
          prompt,
          size: '2048x2048',
          count: 1,
          watermark: sceneState.watermark,
          mode: 'scene',
          grid_mode: true,
          aspect_ratio: '1:1',
          reference_image,
          reference_images,
          mentioned_images,
        };
        break;
      }
    }

    onConfirm(params);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className={`bg-card rounded-md border border-border w-full flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 ${
          activeTab === 'storyboard'
            ? 'max-w-4xl h-[85vh] max-h-[90vh]'
            : 'max-w-4xl h-[80vh] max-h-[90vh]'
        }`}
      >
        {/* Header */}
        <div className="px-8 py-6 border-b border-border bg-muted">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">{t.aiImageModal.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t.aiImageModal.subtitle}</p>
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
            {TAB_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
                  activeTab === key
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {TAB_LABELS[key]}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-8 py-6 min-h-0 overflow-hidden">
          {activeTab === 'basic' && (
            <BasicGenerationTab state={basicState} onChange={setBasicState} projectId={projectId} />
          )}
          {activeTab === 'character' && (
            <CharacterModelingTab state={characterState} onChange={setCharacterState} projectId={projectId} />
          )}
          {activeTab === 'scene' && (
            <SceneModelingTab state={sceneState} onChange={setSceneState} projectId={projectId} />
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
              {t.aiImageModal.cancelButton}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!getCurrentPrompt().trim() || submitted}
              className="px-6 py-2.5 text-sm font-medium text-primary-foreground bg-primary rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitted ? t.aiImageModal.generatingButton : t.aiImageModal.generateButton}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiImageModal;
