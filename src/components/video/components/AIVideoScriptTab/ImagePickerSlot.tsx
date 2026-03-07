'use client';

import React, { useState } from 'react';
import { MaterialItem } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';

interface ImagePickerSlotProps {
  label: string;
  imageUrl?: string;
  imageName?: string;
  onSelect: (url: string, name: string) => void;
  onRemove: () => void;
  materials?: MaterialItem[];
}

const ImagePickerSlot: React.FC<ImagePickerSlotProps> = ({
  label,
  imageUrl,
  imageName,
  onSelect,
  onRemove,
  materials = [],
}) => {
  const { t } = useLocale();
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'materials' | 'url'>('materials');
  const [urlInput, setUrlInput] = useState('');

  const imageMaterials = materials.filter(m => m.type === 'image');

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
