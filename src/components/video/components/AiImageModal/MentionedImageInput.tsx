'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MentionedImage } from '@/types';
import { ImagePack, LegacyImagePackType, listImagePacks } from '@/lib/api/imagePack';
import { useLocale } from '@/contexts/LocaleContext';
import MaterialLibraryGrid from './MaterialLibraryGrid';
import { UserMaterial } from '@/lib/api/userMaterials';
import { uniqueName } from './mentionUtils';

const MAX_IMAGES = 4;

interface MentionedImageInputProps {
  value: string;
  onValueChange: (value: string) => void;
  referenceImages: MentionedImage[];
  onReferenceImagesChange: (images: MentionedImage[]) => void;
  placeholder?: string;
  maxLength?: number;
}

type PickerTab = 'material' | 'storyboard' | 'character' | 'scene';

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

const MentionedImageInput: React.FC<MentionedImageInputProps> = ({
  value,
  onValueChange,
  referenceImages,
  onReferenceImagesChange,
  placeholder = '描述你想要生成的图片内容... 输入 @ 可关联参考图',
  maxLength = 500,
}) => {
  const { t } = useLocale();
  const mp = t.materialsPanel;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [showPicker, setShowPicker] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>('material');
  // pickerAnchor always points to the cursor position *after* the user-typed '@'
  // (when anchorFromUserAt is true), or to a plain insert position (false).
  const [pickerAnchor, setPickerAnchor] = useState<number>(0);
  const [anchorFromUserAt, setAnchorFromUserAt] = useState<boolean>(false);
  const [packsByType, setPacksByType] = useState<Record<LegacyImagePackType, ImagePack[] | null>>({
    storyboard: null,
    character: null,
    scene: null,
  });
  const [loadingType, setLoadingType] = useState<LegacyImagePackType | null>(null);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);

  const loadPacks = useCallback(async (type: LegacyImagePackType) => {
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
    if (showPicker && pickerTab !== 'material') {
      loadPacks(pickerTab as LegacyImagePackType);
    }
  }, [showPicker, pickerTab, loadPacks]);

  const closePicker = useCallback(() => {
    setShowPicker(false);
    setAnchorFromUserAt(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Backspace' && showPicker) {
      closePicker();
    }
  }, [showPicker, closePicker]);

  // Detect a newly-typed '@' from the text change itself (not from keydown)
  // to avoid the old `selectionStart + 1` compensation that produced '@@' and
  // to naturally bypass IME composition (nativeEvent.isComposing). Edge cases
  // covered: (1) IME composition — skipped. (2) '@' inserted mid-text, not
  // only at the end — we compare old vs new at cursor-1. (3) Pre-existing '@'
  // in the prompt — we only fire when char is newly inserted. (4) Anchor
  // semantics — pickerAnchor always points to the index AFTER the freshly
  // inserted '@'; addImage replaces one char back.
  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nativeEvt = e.nativeEvent as InputEvent;
    const isComposing = (nativeEvt as unknown as { isComposing?: boolean })?.isComposing;
    const prevVal = value;
    const newVal = e.target.value.slice(0, maxLength);
    const cursorPos = textareaRef.current?.selectionStart ?? newVal.length;

    onValueChange(newVal);

    if (isComposing) {
      if (showPicker) closePicker();
      return;
    }

    const charBefore = cursorPos > 0 ? newVal[cursorPos - 1] : '';
    const wasAtSamePos = cursorPos > 0 && prevVal[cursorPos - 1] === '@' && prevVal.length + 1 === newVal.length;
    const isFreshAt =
      charBefore === '@' &&
      newVal.length === prevVal.length + 1 &&
      !wasAtSamePos &&
      newVal.slice(0, cursorPos - 1) + newVal.slice(cursorPos) === prevVal;

    if (isFreshAt && !showPicker && referenceImages.length < MAX_IMAGES) {
      setPickerAnchor(cursorPos);
      setAnchorFromUserAt(true);
      setShowPicker(true);
      return;
    }

    if (showPicker) {
      // Close picker if cursor moved off the @ the user was typing after.
      const textBeforeCursor = newVal.slice(0, cursorPos);
      if (!textBeforeCursor.endsWith('@')) {
        closePicker();
      }
    }
  }, [maxLength, onValueChange, showPicker, value, referenceImages.length, closePicker]);

  const addImage = useCallback((
    url: string,
    rawName: string,
    source?: MentionedImage['source'],
    options?: { keepPickerOpen?: boolean },
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
    const next = [...referenceImages, newImage];
    onReferenceImagesChange(next);

    const textarea = textareaRef.current;
    if (textarea && showPicker) {
      if (anchorFromUserAt) {
        // Replace the user-typed '@' (at pickerAnchor - 1) with the tag so
        // the final prompt contains a single '@[name]' instead of '@@[name]'.
        const before = value.slice(0, Math.max(0, pickerAnchor - 1));
        const after = value.slice(pickerAnchor);
        onValueChange(`${before}${tag}${after}`);
      } else {
        const before = value.slice(0, pickerAnchor);
        const after = value.slice(pickerAnchor);
        onValueChange(`${before}${tag}${after}`);
      }
    }

    const reachedMax = next.length >= MAX_IMAGES;
    if (reachedMax || !options?.keepPickerOpen) {
      closePicker();
    }
  }, [referenceImages, onReferenceImagesChange, value, onValueChange, showPicker, pickerAnchor, anchorFromUserAt, closePicker]);

  const removeImage = useCallback((imageId: string) => {
    const img = referenceImages.find(i => i.id === imageId);
    if (img) {
      const tag = `@[${img.name}]`;
      onValueChange(value.replace(tag, ''));
    }
    onReferenceImagesChange(referenceImages.filter(i => i.id !== imageId));
  }, [referenceImages, onReferenceImagesChange, value, onValueChange]);

  const handleMaterialSelect = useCallback((m: UserMaterial) => {
    addImage(m.url, m.name, { type: 'material' }, { keepPickerOpen: true });
  }, [addImage]);

  const selectFrame = useCallback((
    type: LegacyImagePackType,
    pack: ImagePack,
    frame: ImagePack['frames'][number],
  ) => {
    const name = frame.sub_view || `frame_${frame.index + 1}`;
    addImage(frame.url, name, {
      type,
      packId: pack.pack_id,
      frameIndex: frame.index,
      subView: frame.sub_view ?? null,
    }, { keepPickerOpen: true });
  }, [addImage]);

  const renderPackGrid = (type: LegacyImagePackType) => {
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
          <div className="grid grid-cols-4 gap-1.5">
            {active.frames.slice(0, 8).map(f => (
              <button
                key={f.index}
                onClick={() => selectFrame(type, active, f)}
                className="relative rounded overflow-hidden border border-border hover:border-primary/50 transition-colors"
                title={f.sub_view || `frame ${f.index + 1}`}
              >
                <img src={f.url} alt={f.sub_view || ''} className="w-full aspect-square object-cover" />
                {f.sub_view && (
                  <span className="absolute bottom-0 inset-x-0 bg-foreground/70 text-background text-[8px] py-0.5 text-center truncate">
                    {f.sub_view}
                  </span>
                )}
              </button>
            ))}
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
    { key: 'material', label: mp.materialLibraryTab || 'Materials' },
    { key: 'storyboard', label: mp.referencePickerStoryboardPack || 'Storyboard' },
    { key: 'character', label: mp.referencePickerCharacterPack || 'Character' },
    { key: 'scene', label: mp.referencePickerScenePack || 'Scene' },
  ];

  const selectedUrls = referenceImages.map(i => i.url);
  const atMax = referenceImages.length >= MAX_IMAGES;

  return (
    <div className="space-y-3">
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          rows={4}
          autoFocus
          placeholder={placeholder}
          className="w-full border border-border rounded-md px-4 py-3 text-sm text-foreground bg-card resize-none focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
        />
        <span className="absolute bottom-2.5 right-3 text-xs text-muted-foreground">
          {value.length}/{maxLength}
        </span>
      </div>

      {showPicker && (
        <div className="border border-border rounded-md bg-card p-3 space-y-2 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {mp.mentionSelectImage || '选择参考图关联'}
            </span>
            <button
              onClick={closePicker}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <div className="flex gap-1 p-0.5 bg-muted rounded">
            {PICKER_TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setPickerTab(tab.key); setSelectedPackId(null); }}
                className={`flex-1 px-1.5 py-1 text-[10px] rounded transition-colors ${
                  pickerTab === tab.key
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {pickerTab === 'material' && (
            <MaterialLibraryGrid
              onSelect={handleMaterialSelect}
              selectedUrls={selectedUrls}
              disabled={atMax}
            />
          )}
          {pickerTab === 'storyboard' && renderPackGrid('storyboard')}
          {pickerTab === 'character' && renderPackGrid('character')}
          {pickerTab === 'scene' && renderPackGrid('scene')}
        </div>
      )}

      {referenceImages.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {mp.mentionRefImages || '参考图'} ({referenceImages.length}/{MAX_IMAGES})
            </span>
            {referenceImages.length < MAX_IMAGES && (
              <button
                onClick={() => {
                  setPickerAnchor(value.length);
                  setAnchorFromUserAt(false);
                  setShowPicker(true);
                }}
                className="text-[10px] text-primary hover:text-primary/80"
              >
                + {mp.mentionAddRef || '添加更多'}
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {referenceImages.map(img => (
              <div
                key={img.id}
                className="relative group"
              >
                <img
                  src={img.url}
                  alt={img.name}
                  className="w-14 h-14 rounded-md border border-border object-cover"
                />
                <button
                  onClick={() => removeImage(img.id)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
                <span className="block text-center text-[8px] text-muted-foreground mt-0.5 truncate w-14">
                  {img.name.slice(0, 8)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {referenceImages.length === 0 && !showPicker && (
        <button
          onClick={() => {
            setPickerAnchor(value.length);
            setAnchorFromUserAt(false);
            setShowPicker(true);
          }}
          className="text-xs text-muted-foreground hover:text-pink-500 transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {mp.mentionAddRef || '添加参考图（支持多张，可在提示词中用 @ 关联）'}
        </button>
      )}
    </div>
  );
};

export default MentionedImageInput;
