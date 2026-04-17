'use client';

import React, { useEffect, useState } from 'react';
import { VideoUnderstandingScriptProgress } from '../../types/videoEditingTypes';
import { useLocale } from '@/contexts/LocaleContext';

interface VideoUnderstandingScriptProgressModalProps {
  isOpen: boolean;
  progress: VideoUnderstandingScriptProgress;
  onCancel?: () => void;
}

const VideoUnderstandingScriptProgressModal: React.FC<VideoUnderstandingScriptProgressModalProps> = ({
  isOpen,
  progress,
  onCancel,
}) => {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
      setTimeout(() => setIsVisible(false), 200);
    }
  }, [isOpen]);

  if (!isVisible) return null;

  const hasVideos = progress.totalVideos > 0;

  const getStepTitle = () => {
    switch (progress.currentStep) {
      case 'mode-selection':
        return t.videoScriptProgressModal.stepPreparing;
      case 'video-analysis':
        return t.videoScriptProgressModal.stepAnalyzing;
      case 'script-generation':
        return t.videoScriptProgressModal.stepGenerating;
      default:
        return t.videoScriptProgressModal.stepProcessing;
    }
  };

  const getStepDescription = () => {
    switch (progress.currentStep) {
      case 'video-analysis':
        return t.videoScriptProgressModal.descAnalyzing.replace('{analyzed}', String(progress.analyzedVideos)).replace('{total}', String(progress.totalVideos));
      case 'script-generation':
        return hasVideos ? t.videoScriptProgressModal.descGeneratingWithVideo : t.videoScriptProgressModal.descGeneratingWithoutVideo;
      default:
        return t.videoScriptProgressModal.descPleaseWait;
    }
  };

  const getProgressPercentage = () => {
    if (progress.currentStep === 'video-analysis') {
      return progress.analysisProgress;
    } else if (progress.currentStep === 'script-generation') {
      return 85 + (progress.analysisProgress * 0.15); // 脚本生成占15%
    }
    return 0;
  };

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-300 ${
        isAnimating ? 'bg-black bg-opacity-40' : 'bg-black bg-opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-title"
      aria-describedby="progress-description"
    >
      <div 
        className={`bg-card rounded-md border border-border max-w-lg w-full transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-primary/10 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6" />
              </svg>
            </div>
            <div>
              <h3 id="progress-title" className="text-lg font-semibold text-foreground">
                {hasVideos ? t.videoScriptProgressModal.titleWithVideo : t.videoScriptProgressModal.titleWithoutVideo}
              </h3>
              <p id="progress-description" className="text-sm text-muted-foreground">
                {getStepTitle()}
              </p>
            </div>
          </div>
        </div>

        {/* Progress Content */}
        <div className="px-6 py-6">
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-foreground">
                {getStepDescription()}
              </span>
              <span className="text-sm text-muted-foreground">
                {Math.round(getProgressPercentage())}%
              </span>
            </div>
            <div className="w-full bg-accent rounded-full h-3">
              <div 
                className="bg-primary h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
          </div>

          {/* Current Video Info */}
          {progress.currentVideoName && progress.currentStep === 'video-analysis' && (
            <div className="bg-primary/5 rounded-md p-4 mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
                <span className="text-sm text-primary font-medium">
                  {t.videoScriptProgressModal.analyzingVideo.replace('{name}', progress.currentVideoName)}
                </span>
              </div>
            </div>
          )}

          {/* Statistics */}
          {progress.currentStep === 'video-analysis' && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div className="text-lg font-semibold text-primary">
                  {progress.analyzedVideos}
                </div>
                <div className="text-xs text-muted-foreground">{t.videoScriptProgressModal.statCompleted}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-muted-foreground">
                  {progress.totalVideos - progress.analyzedVideos - progress.failedVideos}
                </div>
                <div className="text-xs text-muted-foreground">{t.videoScriptProgressModal.statProcessing}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-destructive">
                  {progress.failedVideos}
                </div>
                <div className="text-xs text-muted-foreground">{t.videoScriptProgressModal.statFailed}</div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {progress.errorMessage && (
            <div className="bg-destructive/10 border border-border rounded-md p-3 mb-4">
              <div className="flex items-start space-x-2">
                <svg className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-destructive">
                  <div className="font-medium">{t.videoScriptProgressModal.errorTitle}</div>
                  <div className="mt-1">{progress.errorMessage}</div>
                </div>
              </div>
            </div>
          )}

          {/* Loading Animation */}
          <div className="flex justify-center">
            <div className="flex space-x-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-primary rounded-full animate-pulse"
                  style={{
                    animationDelay: `${i * 0.2}s`,
                    animationDuration: '1s',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        {onCancel && (
          <div className="px-6 py-4 bg-muted rounded-b-md">
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-foreground bg-card border border-border rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
              >
                {t.videoScriptProgressModal.cancelButton}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoUnderstandingScriptProgressModal; 