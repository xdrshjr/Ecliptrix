'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import type { MaterialItem } from '@/types';
import type { ImagePack } from '@/lib/api/imagePack';
import { appendFramesToPack, createFramePack } from '@/lib/api/framePack';
import type { FramePackAppendCtx } from '../VideoProcessingModal';
import FrameExtractorLayout from './FrameExtractorLayout';
import type { CapturedFrame } from './useFrameExtraction';

type Phase = 'select' | 'extract' | 'saving';

const MAX_REQUEST_BYTES = 256 * 1024 * 1024;

interface FrameExtractionTabProps {
  materials: MaterialItem[];
  /** Owning project id — required by the backend. When absent the tab still
   *  renders a friendly message instead of failing the create call. */
  projectId?: string;
  /** Called after a frame pack is created so MaterialsPanel can refresh
   *  its frame-pack list without a full refetch. */
  onFramePackCreated?: (pack: ImagePack) => void;
  /** When non-null, the tab runs in append mode: video selection is
   *  skipped, save merges into the referenced pack instead of creating
   *  a new one. */
  appendCtx?: FramePackAppendCtx | null;
  /** Append-mode response callback. ``pack`` is null when the pack was
   *  emptied and removed (n/a for append; reserved for symmetry). */
  onFramePackUpdated?: (pack: ImagePack | null, packId: string) => void;
  /** Modal-level close proxy. In append mode the back button closes the
   *  modal entirely (no second video to pick) — use the modal's own
   *  handleClose so the auto-minimize guard is preserved. */
  onRequestClose?: () => void;
}

function syntheticMaterialFromCtx(ctx: FramePackAppendCtx): MaterialItem {
  return {
    id: ctx.sourceMaterialId || `synthetic_${ctx.packId}`,
    name: ctx.sourceMaterialName || 'source video',
    type: 'video',
    format: 'mp4',
    size: 0,
    url: '',
    duration: ctx.sourceDurationSec ?? 0,
    createdAt: new Date(),
  };
}

const FrameExtractionTab: React.FC<FrameExtractionTabProps> = ({
  materials,
  projectId,
  onFramePackCreated,
  appendCtx = null,
  onFramePackUpdated,
  onRequestClose,
}) => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const fe = t.videoProcessing.frameExtraction;

  const [phase, setPhase] = useState<Phase>('select');
  const [selectedVideo, setSelectedVideo] = useState<MaterialItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videos = materials.filter((m) => m.type === 'video');

  // Reset state across append-mode boundaries (P1-2). The modal stays
  // mounted between open/close cycles via hasEverOpened, so without this
  // guard the next open would inherit stale phase/selectedVideo from the
  // previous append run.
  const prevAppendCtxRef = useRef(appendCtx);
  useEffect(() => {
    const wasAppend = prevAppendCtxRef.current != null;
    const isAppend = appendCtx != null;
    prevAppendCtxRef.current = appendCtx;

    if (!wasAppend && isAppend) {
      const matched = materials.find((m) => m.id === appendCtx!.sourceMaterialId)
        ?? syntheticMaterialFromCtx(appendCtx!);
      setSelectedVideo(matched);
      setErrorMessage(null);
      setPhase('extract');
      return;
    }
    if (wasAppend && !isAppend) {
      setSelectedVideo(null);
      setErrorMessage(null);
      setPhase('select');
    }
  }, [appendCtx, materials]);

  const handleSelectVideo = (video: MaterialItem) => {
    setSelectedVideo(video);
    setErrorMessage(null);
    setPhase('extract');
  };

  const handleBack = () => {
    if (appendCtx) {
      // Append mode: there's no "select video" page to fall back to —
      // close the modal via the proxy that preserves auto-minimize.
      onRequestClose?.();
      return;
    }
    setSelectedVideo(null);
    setErrorMessage(null);
    setPhase('select');
  };

  const handleDone = useCallback(
    async (frames: CapturedFrame[]) => {
      if (!selectedVideo) return;
      if (!projectId) {
        showError('project_id missing');
        return;
      }
      if (frames.length === 0) {
        setErrorMessage(fe?.doneNoFrames || 'No frames captured');
        return;
      }

      const totalBytes = frames.reduce((sum, f) => sum + (f.blob.size || 0), 0);
      if (totalBytes > MAX_REQUEST_BYTES) {
        setErrorMessage(fe?.payloadTooLarge || 'Payload too large');
        return;
      }

      setErrorMessage(null);
      setPhase('saving');
      const frameInputs = frames.map((f, i) => ({
        index: i + 1,
        timestampSec: f.timestampSec,
        width: f.width,
        height: f.height,
        blob: f.blob,
      }));
      try {
        if (appendCtx) {
          const pack = await appendFramesToPack({
            projectId,
            packId: appendCtx.packId,
            frames: frameInputs,
          });
          showSuccess(t.materialsPanel.framePackUpdated ?? '已追加到帧包');
          onFramePackUpdated?.(pack, appendCtx.packId);
          // Defer to the modal's close path so auto-minimize guards apply.
          onRequestClose?.();
        } else {
          const pack = await createFramePack({
            projectId,
            sourceMaterialId: selectedVideo.id,
            sourceMaterialName: selectedVideo.name,
            sourceDurationSec: selectedVideo.duration ?? 0,
            frames: frameInputs,
          });
          showSuccess(fe?.saveSuccess || 'Frame pack created');
          onFramePackCreated?.(pack);
          setSelectedVideo(null);
          setPhase('select');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
        showError(`${fe?.saveFailed || 'Save failed'}: ${message}`);
        setPhase('extract');
      }
    },
    [
      selectedVideo,
      projectId,
      fe,
      t.materialsPanel.framePackUpdated,
      showSuccess,
      showError,
      onFramePackCreated,
      appendCtx,
      onFramePackUpdated,
      onRequestClose,
    ],
  );

  if (phase === 'extract' || phase === 'saving') {
    if (!selectedVideo) return null;
    return (
      <FrameExtractorLayout
        source={selectedVideo}
        onBack={handleBack}
        onDone={handleDone}
        isSaving={phase === 'saving'}
        errorMessage={errorMessage}
      />
    );
  }

  return (
    <div className="p-4 overflow-y-auto">
      <p className="text-sm text-muted-foreground mb-3">
        {fe?.selectVideoHeading}
      </p>
      {videos.length === 0 ? (
        <p className="text-center text-muted-foreground text-sm py-8">
          {fe?.selectVideoEmpty}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {videos.map((video) => (
            <button
              key={video.id}
              type="button"
              onClick={() => handleSelectVideo(video)}
              className="flex flex-col items-center p-2 rounded-md border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
            >
              {video.thumbnailUrl ? (
                <img
                  src={video.thumbnailUrl}
                  alt={video.name}
                  className="w-full aspect-video object-cover rounded mb-1.5"
                />
              ) : (
                <div className="w-full aspect-video bg-muted rounded mb-1.5 flex items-center justify-center">
                  <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              <span className="text-xs text-foreground truncate w-full">{video.name}</span>
              {video.duration != null && (
                <span className="text-xs text-muted-foreground">{video.duration.toFixed(1)}s</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FrameExtractionTab;
