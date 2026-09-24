'use client';

import React, { useEffect, useRef } from 'react';
import type { MaterialItem, ScriptSegment } from '@/types';
import { useLocale } from '@/contexts/LocaleContext';
import type { VideoEditingLogger } from '../../utils/logger';

export type VideoLoadState = 'loading' | 'loaded' | 'error';

export interface MediaErrorDetails {
  code?: number;
  message: string;
  errorType?: string;
}

/** Handlers stay in ScriptPanel; the carousel only renders (spec §5.3). */
export interface VideoCarouselHandlers {
  onPlayPause(element: HTMLVideoElement, video: MaterialItem, segmentId: string): void;
  onLoadStart(videoKey: string, video: MaterialItem, segmentId: string): void;
  onCanPlay(videoKey: string, video: MaterialItem, segmentId: string): void;
  onError(videoKey: string, video: MaterialItem, segmentId: string, error: MediaErrorDetails): void;
  onPlayingChange(videoKey: string, isPlaying: boolean): void;
  onRetry(videoKey: string): void;
  onNavigate(segmentId: string, direction: 'prev' | 'next'): void;
  getMediaErrorType(code: number): string;
}

interface SegmentVideoCarouselProps {
  segment: ScriptSegment;
  currentIndex: number;
  loadStates: Record<string, VideoLoadState>;
  handlers: VideoCarouselHandlers;
  logger: VideoEditingLogger;
}

interface VideoSlideProps {
  segmentId: string;
  video: MaterialItem;
  handlers: VideoCarouselHandlers;
  logger: VideoEditingLogger;
}

const YoutubeSlide: React.FC<VideoSlideProps> = ({ segmentId, video, logger }) => {
  const context = {
    segmentId,
    videoId: video.id,
    youtubeId: video.metadata?.youtubeId,
    videoKey: `${segmentId}_${video.id}`,
  };
  return (
    <iframe
      key={`${segmentId}_${video.id}`}
      src={`https://www.youtube.com/embed/${video.metadata?.youtubeId}?autoplay=0&controls=1&modestbranding=1&rel=0`}
      className="w-full h-full"
      frameBorder="0"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      onLoad={() => logger.info('YouTube视频预览加载完成', context)}
      onError={() => logger.error('YouTube视频预览加载失败', new Error('YouTube iframe load error'), context)}
    />
  );
};

const VideoElementSlide: React.FC<VideoSlideProps> = ({ segmentId, video, handlers, logger }) => {
  const { t } = useLocale();
  const videoKey = `${segmentId}_${video.id}`;
  const context = { segmentId, videoId: video.id };
  const onPlayingChangeRef = useRef(handlers.onPlayingChange);
  onPlayingChangeRef.current = handlers.onPlayingChange;
  // Collapsing the card unmounts a playing <video> without a `pause` event;
  // clear its flag so the next click plays instead of "pausing" a dead element.
  useEffect(() => () => onPlayingChangeRef.current(videoKey, false), [videoKey]);
  return (
    <video
      key={videoKey}
      className="w-full h-full object-contain cursor-pointer"
      poster={video.thumbnailUrl}
      controls
      preload="metadata"
      data-video-key={videoKey}
      onClick={(e) => handlers.onPlayPause(e.currentTarget, video, segmentId)}
      onLoadStart={() => handlers.onLoadStart(videoKey, video, segmentId)}
      onCanPlay={() => handlers.onCanPlay(videoKey, video, segmentId)}
      onLoadedMetadata={() => logger.info('视频元数据加载完成', { ...context, videoKey })}
      onError={(e) => {
        const error = e.currentTarget.error;
        const details: MediaErrorDetails = error
          ? { code: error.code, message: error.message, errorType: handlers.getMediaErrorType(error.code) }
          : { message: 'Unknown video error' };
        handlers.onError(videoKey, video, segmentId, details);
      }}
      onPlay={() => {
        handlers.onPlayingChange(videoKey, true);
        logger.info('视频开始播放', context);
      }}
      onPause={() => {
        handlers.onPlayingChange(videoKey, false);
        logger.info('视频暂停播放', context);
      }}
    >
      <source src={video.url} type={video.format ? `video/${video.format}` : 'video/mp4'} />
      {t.scriptPanel.video.browserNotSupported}
    </video>
  );
};

const SlideMedia: React.FC<VideoSlideProps> = (props) => {
  const { segmentId, video, logger } = props;
  if (video.type === 'video' && video.url) {
    const isYoutube = video.metadata?.source === 'youtube' && video.metadata?.youtubeId;
    return isYoutube ? <YoutubeSlide {...props} /> : <VideoElementSlide {...props} />;
  }
  if (video.thumbnailUrl) {
    return (
      <img
        src={video.thumbnailUrl}
        alt={video.name}
        className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
        onClick={() => {
          logger.userAction('点击非视频素材预览', 'materialPreview', {
            segmentId,
            materialId: video.id,
            materialName: video.name,
            materialType: video.type,
          });
        }}
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    </div>
  );
};

const LoadStateOverlay: React.FC<{
  state: VideoLoadState | undefined;
  onRetry(): void;
}> = ({ state, onRetry }) => {
  const { t } = useLocale();
  if (state === 'loading') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-black/50">
        <div className="flex flex-col items-center space-y-2">
          <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <div className="text-white text-xs">{t.scriptPanel.video.loading}</div>
        </div>
      </div>
    );
  }
  if (state !== 'error') return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-red-500/20">
      <div className="text-center p-4">
        <div className="text-destructive mb-2">
          <svg className="w-8 h-8 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <div className="text-white text-sm font-medium">{t.scriptPanel.video.loadingFailed}</div>
        <div className="text-muted-foreground text-xs mt-1">{t.scriptPanel.video.checkNetwork}</div>
        <button type="button" className="ws-btn ws-btn--primary ws-btn--sm mt-2" onClick={onRetry}>
          {t.scriptPanel.video.retry}
        </button>
      </div>
    </div>
  );
};

const CarouselNavigation: React.FC<{ segmentId: string; handlers: VideoCarouselHandlers }> = ({
  segmentId,
  handlers,
}) => {
  const { t } = useLocale();
  return (
    <div className="flex items-center justify-center space-x-2">
      <button
        type="button"
        onClick={() => handlers.onNavigate(segmentId, 'prev')}
        className="ws-icon-btn"
        title={t.scriptPanel.actions.previousVideo}
        aria-label={t.scriptPanel.actions.previousVideo}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => handlers.onNavigate(segmentId, 'next')}
        className="ws-icon-btn"
        title={t.scriptPanel.actions.nextVideo}
        aria-label={t.scriptPanel.actions.nextVideo}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
};

/** 绑定视频轮播（从 ScriptPanel 原样移出；播放 / 加载状态仍由 ScriptPanel 持有）。 */
const SegmentVideoCarousel: React.FC<SegmentVideoCarouselProps> = ({
  segment,
  currentIndex,
  loadStates,
  handlers,
  logger,
}) => {
  const { t } = useLocale();
  const videos = segment.videos ?? [];
  const currentVideo = videos[currentIndex];
  if (videos.length === 0) return null;
  const videoKey = currentVideo ? `${segment.id}_${currentVideo.id}` : '';
  return (
    <div className="mt-3 p-3 rounded-md" style={{ background: 'var(--ws-panel)' }}>
      <div className="flex items-center justify-between mb-2">
        <h5 className="text-xs font-medium text-muted-foreground flex items-center">
          {t.scriptPanel.video.associatedVideos}
          {videos.length > 1 && (
            <span className="ml-1 text-xs text-foreground bg-secondary px-1 py-0.5 rounded">
              {t.scriptPanel.video.multipleVideos}
            </span>
          )}
        </h5>
        <span className="text-xs text-muted-foreground ws-tabular">
          {currentIndex + 1} / {videos.length}
        </span>
      </div>
      {currentVideo && (
        <div className="space-y-2">
          <div className="relative bg-black rounded-md overflow-hidden aspect-video">
            <SlideMedia segmentId={segment.id} video={currentVideo} handlers={handlers} logger={logger} />
            <LoadStateOverlay state={loadStates[videoKey]} onRetry={() => handlers.onRetry(videoKey)} />
          </div>
          <div className="text-xs text-muted-foreground">
            <div className="font-medium truncate">{currentVideo.name}</div>
            <div className="text-muted-foreground mt-1">
              {currentVideo.duration && `${Math.ceil(currentVideo.duration)}${t.scriptPanel.video.seconds}`}
              {currentVideo.width && currentVideo.height && ` · ${currentVideo.width}x${currentVideo.height}`}
            </div>
          </div>
          {videos.length > 1 && <CarouselNavigation segmentId={segment.id} handlers={handlers} />}
        </div>
      )}
    </div>
  );
};

export default SegmentVideoCarousel;
