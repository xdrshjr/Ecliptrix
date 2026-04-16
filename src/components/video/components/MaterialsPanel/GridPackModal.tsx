'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { ImagePack } from '@/lib/api/imagePack';

interface GridPackModalProps {
  isOpen: boolean;
  pack: ImagePack | null;
  onClose: () => void;
}

/**
 * GridPackModal — detail viewer for character / scene image packs. Shows
 * the composite original, then the 9 cropped frames with their sub_view
 * labels. Used by MaterialsPanel.
 */
const GridPackModal: React.FC<GridPackModalProps> = ({ isOpen, pack, onClose }) => {
  const { t } = useLocale();
  if (!isOpen || !pack) return null;

  const label =
    pack.pack_type === 'character'
      ? t.materialsPanel.characterPack ?? '人物建模包'
      : pack.pack_type === 'scene'
        ? t.materialsPanel.scenePack ?? '场景建模包'
        : t.materialsPanel.storyboardPack;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card rounded-md border border-border w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-border bg-muted flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{label}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[60ch]" title={pack.prompt}>
              {pack.prompt}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md hover:bg-accent transition-colors flex items-center justify-center"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {pack.original_image_url && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">{t.materialsPanel.gridPackOriginal || 'Original (3×3 composite)'}</h3>
              <img
                src={pack.original_image_url}
                alt="original"
                className="w-full rounded border border-border"
              />
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium text-foreground mb-2">
              {t.materialsPanel.gridPackCroppedFrames || 'Cropped frames'}（{pack.frame_count}）
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {pack.frames.map((frame) => (
                <div
                  key={frame.index}
                  className="bg-muted rounded border border-border overflow-hidden"
                  title={frame.sub_view || ''}
                >
                  <img
                    src={frame.url}
                    alt={frame.sub_view || `frame ${frame.index + 1}`}
                    className="w-full aspect-square object-cover"
                  />
                  {frame.sub_view && (
                    <p className="text-xs text-center text-muted-foreground py-1 truncate">
                      {frame.sub_view}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GridPackModal;
