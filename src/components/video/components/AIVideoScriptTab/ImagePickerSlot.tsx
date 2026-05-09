'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import { ImagePack } from '@/lib/api/imagePack';
import { listFramePacks } from '@/lib/api/framePack';

interface ImagePickerSlotProps {
  label: string;
  imageUrl?: string;
  imageName?: string;
  onSelect: (url: string, name: string) => void;
  onRemove: () => void;
  materials?: MaterialItem[];
  /** Owning project id. When set, the "frame pack" tab is rendered and
   *  populated via listFramePacks(projectId). When undefined the tab is
   *  hidden entirely. Changing this prop resets the slot's frame-pack cache. */
  projectId?: string;
}

type PickerMode = 'materials' | 'framePack' | 'url';

const ImagePickerSlot: React.FC<ImagePickerSlotProps> = ({
  label,
  imageUrl,
  imageName,
  onSelect,
  onRemove,
  materials = [],
  projectId,
}) => {
  const { t } = useLocale();
  const mp = t.materialsPanel;
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<PickerMode>('materials');
  const [urlInput, setUrlInput] = useState('');

  const [framePacks, setFramePacks] = useState<ImagePack[] | null>(null);
  const [framePacksLoading, setFramePacksLoading] = useState(false);
  const [activeFramePackId, setActiveFramePackId] = useState<string | null>(null);

  const imageMaterials = materials.filter(m => m.type === 'image');

  // Cache reset on projectId change — see spec §2.2 point 5.
  useEffect(() => {
    setFramePacks(null);
    setFramePacksLoading(false);
    setActiveFramePackId(null);
  }, [projectId]);

  // Lazy load frame packs — mirrors ReferenceImagePanel.loadPacks: errors are
  // swallowed so framePacks stays null and a tab re-enter retries.
  const loadFramePacks = useCallback(async () => {
    if (!projectId) return;
    if (framePacks !== null) return;
    setFramePacksLoading(true);
    try {
      const packs = await listFramePacks(projectId);
      setFramePacks(packs);
    } catch {
      // silently ignore
    } finally {
      setFramePacksLoading(false);
    }
  }, [projectId, framePacks]);

  useEffect(() => {
    if (pickerMode === 'framePack') {
      void loadFramePacks();
    }
  }, [pickerMode, loadFramePacks]);

  const handleUrlSubmit = () => {
    const trimmed = urlInput.trim();
    if (trimmed) {
      onSelect(trimmed, trimmed.split('/').pop() || 'image');
      setUrlInput('');
      setShowPicker(false);
    }
  };

  if (imageUrl) {
    return (
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className="relative group rounded-md overflow-hidden border border-border bg-muted">
          <img
            src={imageUrl}
            alt={imageName || label}
            className="w-full h-20 object-cover"
          />
          <button
            onClick={onRemove}
            className="absolute top-1 right-1 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            title={t.scriptPanel.aiVideoScript.removeImage}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {imageName && (
          <div className="text-xs text-muted-foreground mt-0.5 truncate">{imageName}</div>
        )}
      </div>
    );
  }

  const activeFramePack = framePacks?.find(p => p.pack_id === activeFramePackId) || null;

  return (
    <div className="flex-1 min-w-0">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      {!showPicker ? (
        <button
          onClick={() => setShowPicker(true)}
          className="w-full h-20 border-2 border-dashed border-border rounded-md flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span className="text-xs">{t.scriptPanel.aiVideoScript.selectImage}</span>
        </button>
      ) : (
        <div className="border border-border rounded-md bg-card p-2">
          {/* Mode toggle */}
          <div className="flex space-x-1 mb-2">
            <button
              onClick={() => setPickerMode('materials')}
              className={`flex-1 text-xs py-1 rounded ${
                pickerMode === 'materials'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {t.scriptPanel.aiVideoScript.fromMaterials}
            </button>
            {projectId && (
              <button
                onClick={() => setPickerMode('framePack')}
                className={`flex-1 text-xs py-1 rounded ${
                  pickerMode === 'framePack'
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
              >
                {mp.referencePickerFramePack || '帧包'}
              </button>
            )}
            <button
              onClick={() => setPickerMode('url')}
              className={`flex-1 text-xs py-1 rounded ${
                pickerMode === 'url'
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
            >
              {t.scriptPanel.aiVideoScript.pasteUrl}
            </button>
          </div>

          {pickerMode === 'materials' ? (
            <div>
              {imageMaterials.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-3">
                  {t.scriptPanel.aiVideoScript.noImagesInMaterials}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto">
                  {imageMaterials.map(m => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onSelect(m.url || m.thumbnailUrl || '', m.name);
                        setShowPicker(false);
                      }}
                      className="aspect-square rounded overflow-hidden border border-border hover:border-primary transition-colors"
                    >
                      <img
                        src={m.thumbnailUrl || m.url}
                        alt={m.name}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : pickerMode === 'framePack' ? (
            <div>
              {framePacksLoading ? (
                <div className="text-xs text-muted-foreground text-center py-3">
                  {mp.referencePickerLoading || '加载中…'}
                </div>
              ) : !framePacks || framePacks.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-3">
                  {mp.referencePickerEmpty || '暂无可用包'}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex gap-1 overflow-x-auto pb-0.5">
                    {framePacks.map(p => (
                      <button
                        key={p.pack_id}
                        onClick={() => setActiveFramePackId(p.pack_id)}
                        className={`flex-shrink-0 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                          activeFramePackId === p.pack_id
                            ? 'border-primary text-primary bg-primary/5'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {(p.prompt || p.pack_id).slice(0, 12)}
                      </button>
                    ))}
                  </div>
                  {activeFramePack ? (
                    activeFramePack.frames.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-2">
                        {mp.referencePickerEmpty || '暂无可用包'}
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-1 max-h-32 overflow-y-auto">
                        {activeFramePack.frames.map(f => {
                          const frameName = f.sub_view || `frame_${f.index + 1}`;
                          return (
                            <button
                              key={f.index}
                              onClick={() => {
                                onSelect(f.url, frameName);
                                setShowPicker(false);
                              }}
                              className="aspect-square rounded overflow-hidden border border-border hover:border-primary transition-colors"
                              title={frameName}
                            >
                              <img
                                src={f.url}
                                alt={frameName}
                                className="w-full h-full object-cover"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <div className="text-[10px] text-muted-foreground text-center py-1">
                      {mp.referencePickerSelectPackHint || '选择一个包查看帧'}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex space-x-1">
              <input
                type="text"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleUrlSubmit()}
                placeholder="https://..."
                className="flex-1 text-xs px-2 py-1.5 border border-border rounded focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
              <button
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim()}
                className="px-2 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                OK
              </button>
            </div>
          )}

          {/* Close picker */}
          <button
            onClick={() => setShowPicker(false)}
            className="w-full mt-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {t.scriptPanel.aiVideoScript.cancel}
          </button>
        </div>
      )}
    </div>
  );
};

export default ImagePickerSlot;
