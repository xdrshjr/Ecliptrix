'use client';

import React from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import type { ImagePack, ImagePackFrame } from '@/lib/api/imagePack';

interface FramePackViewProps {
  pack: ImagePack;
  onBack: () => void;
  onDelete: (packId: string) => void;
  onFrameClick?: (frame: ImagePackFrame) => void;
  /** Optional callback wired up by AI generation flows — e.g. "use this
   *  frame as a reference image". When supplied, an extra button shows up
   *  on each frame card. */
  onUseFrameAsReference?: (frame: ImagePackFrame, pack: ImagePack) => void;
  /** Open the "Add Frames" flow (re-opens VideoProcessingModal in append
   *  mode targeting this pack). When omitted, the button is hidden. */
  onAddFrames?: () => void;
  /** Whether the "Add Frames" button is enabled. Disabled when the source
   *  video is no longer in the materials library or when a previous
   *  append is still in flight. */
  canAddFrames?: boolean;
  /** Remove a single frame from this pack. When omitted, the per-frame
   *  delete affordance is hidden. */
  onDeleteFrame?: (frameIndex: number) => void;
}

function formatTimestamp(sec: number | null | undefined): string | null {
  if (sec == null || !isFinite(sec) || sec < 0) return null;
  const minutes = Math.floor(sec / 60);
  const remainder = sec - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, '0')}`;
}

const FramePackView: React.FC<FramePackViewProps> = ({
  pack,
  onBack,
  onDelete,
  onFrameClick,
  onUseFrameAsReference,
  onAddFrames,
  canAddFrames,
  onDeleteFrame,
}) => {
  const { t } = useLocale();
  const mp = t.materialsPanel;
  const heading = pack.source_material_name || mp.framePack || '视频帧包';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center space-x-1 text-xs mb-3">
        <button
          onClick={onBack}
          className="text-primary hover:text-primary/80 hover:underline transition-colors"
        >
          素材
        </button>
        <svg className="w-3 h-3 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-foreground font-medium truncate max-w-[200px]" title={heading}>
          {heading}
        </span>
      </div>

      <div className="bg-muted rounded-md p-2.5 mb-3 space-y-2">
        <div className="flex items-center space-x-3 text-xs text-muted-foreground">
          <span>
            {mp.framePackBadge
              ? mp.framePackBadge.replace('{count}', String(pack.frame_count))
              : `${pack.frame_count} frames`}
          </span>
          {pack.source_duration_sec != null && (
            <span>
              {(t.videoProcessing.duration?.seconds ?? 's')}:{' '}
              <span className="text-foreground font-medium">
                {pack.source_duration_sec.toFixed(1)}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {onAddFrames && (
            <button
              type="button"
              disabled={!canAddFrames}
              onClick={onAddFrames}
              className="px-2 py-1 text-xs text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={canAddFrames ? undefined : (mp.addFramesToPackDisabledHint ?? '原视频已不在素材库，请先重新导入')}
            >
              {mp.addFramesToPack ?? '添加视频帧'}
            </button>
          )}
          <button
            onClick={() => onDelete(pack.pack_id)}
            className="px-2 py-1 text-xs text-destructive border border-destructive/30 rounded hover:bg-destructive/10 transition-colors"
          >
            {mp.deleteFramePack ?? '删除视频帧包'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {pack.frames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16M4 6v12M9 6v12M14 6v12M19 6v12" />
            </svg>
            <p className="text-xs">No frames</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {pack.frames.map((frame) => {
              const ts = formatTimestamp(frame.timestamp_sec);
              return (
                <div
                  key={frame.index}
                  className="group relative rounded overflow-hidden border border-border bg-card"
                >
                  <button
                    type="button"
                    onClick={() => onFrameClick?.(frame)}
                    className="block w-full aspect-video"
                  >
                    <img
                      src={frame.url}
                      alt={`frame ${frame.index}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                  <div className="absolute inset-x-0 bottom-0 px-1 py-0.5 bg-black/60 text-white text-[10px] flex items-center justify-between">
                    <span>#{frame.index}</span>
                    {ts && <span className="font-mono">{ts}</span>}
                  </div>
                  {onUseFrameAsReference && (
                    <button
                      type="button"
                      onClick={() => onUseFrameAsReference(frame, pack)}
                      className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] rounded bg-primary text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      use as ref
                    </button>
                  )}
                  {onDeleteFrame && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDeleteFrame(frame.index); }}
                      className={`absolute ${onUseFrameAsReference ? 'top-1 right-7' : 'top-1 right-1'} w-6 h-6 rounded bg-destructive/80 hover:bg-destructive text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10`}
                      title={mp.deleteFrame ?? 'Delete frame'}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                  <a
                    href={frame.url}
                    download={frame.filename}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute top-1 left-1 w-6 h-6 rounded bg-foreground/60 hover:bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Download"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
                    </svg>
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default FramePackView;
