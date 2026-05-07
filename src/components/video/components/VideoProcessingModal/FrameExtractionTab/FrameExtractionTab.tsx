'use client';

import React, { useCallback, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';
import { useNotification } from '@/contexts/NotificationContext';
import type { MaterialItem } from '@/types';
import type { ImagePack } from '@/lib/api/imagePack';
import { createFramePack } from '@/lib/api/framePack';
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
}

const FrameExtractionTab: React.FC<FrameExtractionTabProps> = ({
  materials,
  projectId,
  onFramePackCreated,
}) => {
  const { t } = useLocale();
  const { showSuccess, showError } = useNotification();
  const fe = t.videoProcessing.frameExtraction;

  const [phase, setPhase] = useState<Phase>('select');
  const [selectedVideo, setSelectedVideo] = useState<MaterialItem | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videos = materials.filter((m) => m.type === 'video');

  const handleSelectVideo = (video: MaterialItem) => {
    setSelectedVideo(video);
    setErrorMessage(null);
    setPhase('extract');
  };

  const handleBack = () => {
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
      try {
        const pack = await createFramePack({
          projectId,
          sourceMaterialId: selectedVideo.id,
          sourceMaterialName: selectedVideo.name,
          sourceDurationSec: selectedVideo.duration ?? 0,
          frames: frames.map((f, i) => ({
            index: i + 1,
            timestampSec: f.timestampSec,
            width: f.width,
            height: f.height,
            blob: f.blob,
          })),
        });
        showSuccess(fe?.saveSuccess || 'Frame pack created');
        onFramePackCreated?.(pack);
        setSelectedVideo(null);
        setPhase('select');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMessage(message);
        showError(`${fe?.saveFailed || 'Save failed'}: ${message}`);
        setPhase('extract');
      }
    },
    [selectedVideo, projectId, fe, showSuccess, showError, onFramePackCreated],
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
