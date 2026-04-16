'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MentionedImage } from '@/types';
import { ImagePack, ImagePackType, listImagePacks } from '@/lib/api/imagePack';
import { useLocale } from '@/contexts/LocaleContext';
import MaterialLibraryGrid from './MaterialLibraryGrid';
import { UserMaterial } from '@/lib/api/userMaterials';
import { uniqueName } from './mentionUtils';

const MAX_IMAGES = 4;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface ReferenceImagePanelProps {
  referenceImages: MentionedImage[];
  onReferenceImagesChange: (images: MentionedImage[]) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
}

type PickerTab = 'material' | 'storyboard' | 'character' | 'scene';

const ReferenceImagePanel: React.FC<ReferenceImagePanelProps> = ({
  referenceImages,
  onReferenceImagesChange,
  prompt,
  onPromptChange,
}) => {
  const { t } = useLocale();
  const mp = t.materialsPanel;

  const [pickerTab, setPickerTab] = useState<PickerTab>('material');
  const [packsByType, setPacksByType] = useState<Record<ImagePackType, ImagePack[] | null>>({
    storyboard: null,
    character: null,
    scene: null,
  });
  const [loadingType, setLoadingType] = useState<ImagePackType | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const loadPacks = useCallback(async (type: ImagePackType) => {
    if (packsByType[type] !== null) return;
    setLoadingType(type);
    try {
      const packs = await listImagePacks(type);
      setPacksByType(prev => ({ ...prev, [type]: packs }));
    } catch {
      // silently ignore
    } finally {
      setLoadingType(null);
    }
  }, [packsByType]);

  useEffect(() => {
    if (pickerTab !== 'material') {
      loadPacks(pickerTab as ImagePackType);
    }
  }, [pickerTab, loadPacks]);

  const addImage = useCallback((
    url: string,
    rawName: string,
    source?: MentionedImage['source'],
  ) => {
    if (referenceImages.length >= MAX_IMAGES) return;
    if (referenceImages.some(img => img.url === url)) return;

    const name = uniqueName(rawName, referenceImages);
    const tag = `@[${name}]`;
    const newImage: MentionedImage = {
      id: generateId(),
      name,
      url,
      source: source || null,
    };
    onReferenceImagesChange([...referenceImages, newImage]);
    onPromptChange(`${prompt}${tag}`);
  }, [referenceImages, onReferenceImagesChange, prompt, onPromptChange]);

  const removeImage = useCallback((imageId: string) => {
    const img = referenceImages.find(i => i.id === imageId);
    if (img) {
      const tag = `@[${img.name}]`;
      onPromptChange(prompt.replace(tag, ''));
    }
    onReferenceImagesChange(referenceImages.filter(i => i.id !== imageId));
  }, [referenceImages, onReferenceImagesChange, prompt, onPromptChange]);

  const handleMaterialSelect = useCallback((m: UserMaterial) => {
    addImage(m.url, m.name, { type: 'material' });
  }, [addImage]);

  const selectFrame = useCallback((
    type: ImagePackType,
    pack: ImagePack,
    frame: ImagePack['frames'][number],
  ) => {
    const name = frame.sub_view || `frame_${frame.index + 1}`;
    addImage(frame.url, name, {
      type,
      packId: pack.pack_id,
      frameIndex: frame.index,
      subView: frame.sub_view ?? null,
    });
  }, [addImage]);

  const renderPackGrid = (type: ImagePackType) => {
    const packs = packsByType[type];
    if (loadingType === type) {
      return <p className="text-xs text-muted-foreground text-center py-3">{mp.referencePickerLoading || 'Loading...'}</p>;
    }
    if (!packs || packs.length === 0) {
      return <p className="text-xs text-muted-foreground text-center py-3">{mp.referencePickerEmpty || 'No packs'}</p>;
    }
    const active = packs.find(p => p.pack_id === selectedPackId) || null;
    return (
      <div className="space-y-2">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {packs.map(p => (
            <button
              key={p.pack_id}
              onClick={() => setSelectedPackId(p.pack_id)}
              className={`flex-shrink-0 px-2 py-1 rounded border text-[10px] transition-colors ${
                selectedPackId === p.pack_id
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {(p.prompt || p.pack_id).slice(0, 12)}
            </button>
          ))}
        </div>
        {active ? (
          <div className="grid grid-cols-3 gap-1.5">
            {active.frames.slice(0, 9).map(f => {
              const selected = referenceImages.some(img => img.url === f.url);
              return (
                <button
                  key={f.index}
                  onClick={() => !selected && selectFrame(type, active, f)}
                  disabled={selected}
                  className={`relative rounded overflow-hidden border transition-colors ${
                    selected
                      ? 'border-primary opacity-70'
                      : 'border-border hover:border-primary/50'
                  }`}
                  title={f.sub_view || `frame ${f.index + 1}`}
                >
                  <img src={f.url} alt={f.sub_view || ''} className="w-full aspect-square object-cover" />
                  {f.sub_view && (
                    <span className="absolute bottom-0 inset-x-0 bg-foreground/70 text-background text-[8px] py-0.5 text-center truncate">
                      {f.sub_view}
                    </span>
                  )}
                  {selected && (
                    <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-primary text-primary-foreground text-[8px] flex items-center justify-center">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground text-center py-1">
            {mp.referencePickerSelectPackHint || 'Select a pack'}
          </p>
        )}
      </div>
    );
  };

  const PICKER_TABS: { key: PickerTab; label: string }[] = [
    { key: 'material', label: mp.materialLibraryTab || '素材库' },
    { key: 'storyboard', label: mp.referencePickerStoryboardPack || '分镜包' },
    { key: 'character', label: mp.referencePickerCharacterPack || '人物包' },
    { key: 'scene', label: mp.referencePickerScenePack || '场景包' },
  ];

  const atMax = referenceImages.length >= MAX_IMAGES;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-foreground">
          {mp.mentionSelectImage || '选择参考图关联'}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {referenceImages.length}/{MAX_IMAGES}
        </span>
      </div>

      {/* Selected images */}
      {referenceImages.length > 0 && (
        <div className="pb-2.5 mb-2.5 border-b border-border">
          <div className="flex gap-2 flex-wrap">
            {referenceImages.map(img => (
              <div key={img.id} className="relative group">
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-12 h-12 rounded-md border border-border object-cover"
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Picker tabs */}
      <div className="flex gap-0.5 p-0.5 bg-muted rounded mb-2">
        {PICKER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setPickerTab(tab.key); setSelectedPackId(null); }}
            className={`flex-1 px-1 py-1 text-[10px] rounded transition-colors ${
              pickerTab === tab.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Picker content — fixed height scrollable area */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-0.5">
        {atMax ? (
          <p className="text-[10px] text-muted-foreground text-center py-4">
            已达最大数量 ({MAX_IMAGES})，请先移除已有参考图
          </p>
        ) : (
          <>
            {pickerTab === 'material' && (
              <MaterialLibraryGrid
                onSelect={handleMaterialSelect}
                selectedUrls={referenceImages.map(i => i.url)}
                disabled={atMax}
              />
            )}
            {pickerTab === 'storyboard' && renderPackGrid('storyboard')}
            {pickerTab === 'character' && renderPackGrid('character')}
            {pickerTab === 'scene' && renderPackGrid('scene')}
          </>
        )}
      </div>
    </div>
  );
};

export default ReferenceImagePanel;
