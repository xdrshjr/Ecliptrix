'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

interface VideoExportProgressModalProps {
  isOpen: boolean;
  progress: number;
  startTime?: number | null;
  onCancel?: () => void;
  allowCancel?: boolean;
}

const VideoExportProgressModal: React.FC<VideoExportProgressModalProps> = ({
  isOpen,
  progress,
  startTime,
  onCancel,
  allowCancel = false
}) => {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);

  // 实时更新经过时间
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    
    if (isOpen && startTime) {
      interval = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor((now - startTime) / 1000); // 转换为秒
        setElapsedTime(elapsed);
      }, 1000);
    } else {
      setElapsedTime(0);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [isOpen, startTime]);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setTimeout(() => setIsAnimating(true), 10);
    } else {
      setIsAnimating(false);
      setTimeout(() => setIsVisible(false), 200);
    }
  }, [isOpen]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    // 阻止点击背景关闭弹窗，确保用户无法进行其他操作
    e.preventDefault();
    e.stopPropagation();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 阻止 Escape 键关闭弹窗，除非允许取消
    if (e.key === 'Escape' && allowCancel && onCancel) {
      onCancel();
    } else {
      e.preventDefault();
    }
  };

  const getProgressStage = () => {
    if (progress < 20) return t.videoExportProgressModal.progressStages.preparing;
    if (progress < 40) return t.videoExportProgressModal.progressStages.processing;
    if (progress < 70) return t.videoExportProgressModal.progressStages.composing;
    if (progress < 95) return t.videoExportProgressModal.progressStages.generating;
    if (progress >= 100) return t.videoExportProgressModal.progressStages.completed;
    return t.videoExportProgressModal.progressStages.almostDone;
  };

  // 格式化经过时间
  const formatElapsedTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isVisible) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-all duration-300 ${
        isAnimating ? 'bg-black bg-opacity-40' : 'bg-black bg-opacity-0'
      }`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-progress-title"
      aria-describedby="export-progress-description"
    >
      <div 
        className={`bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-sm w-full transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="flex justify-center mb-4">
            <div className="relative">
              {/* 外圆环 - 进度背景 */}
              <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 64 64">
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="#f3f4f6"
                  strokeWidth="4"
                  fill="none"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="#3b82f6"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - progress / 100)}`}
                  className="transition-all duration-500 ease-out"
                />
              </svg>
              
                             {/* 中心图标 - 添加动画 */}
               <div className="absolute inset-0 flex items-center justify-center">
                 {progress >= 100 ? (
                   <svg 
                     className="w-6 h-6 text-green-500 animate-bounce" 
                     fill="currentColor" 
                     viewBox="0 0 24 24"
                   >
                     <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                   </svg>
                 ) : (
                   <svg 
                     className="w-6 h-6 text-blue-500 animate-spin" 
                     fill="none" 
                     stroke="currentColor" 
                     strokeWidth="2"
                     viewBox="0 0 24 24"
                   >
                     <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                   </svg>
                 )}
               </div>
            </div>
          </div>
          
          <h3 
            id="export-progress-title"
            className="text-lg font-semibold text-gray-900 mb-2"
          >
            {t.videoExportProgressModal.title}
          </h3>
          
          <p 
            id="export-progress-description"
            className="text-sm text-gray-600 mb-1"
          >
            {getProgressStage()}
          </p>
          
          <p className="text-2xl font-bold text-blue-600 mb-2">
            {Math.round(progress)}%
          </p>
          
          {/* 显示经过时间 */}
          {startTime && (
            <div className="flex items-center justify-center space-x-2 text-sm text-gray-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
              <span>{t.videoExportProgressModal.timeElapsed}: {formatElapsedTime(elapsedTime)}</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="px-6 pb-4">
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <div 
              className="h-2 bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-3">
              {t.videoExportProgressModal.pleaseWait}
            </p>
            
            {allowCancel && onCancel && progress < 100 && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 border border-gray-200 rounded-lg hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors"
              >
                {t.videoExportProgressModal.cancelExport}
              </button>
            )}
            
            {progress >= 100 && (
              <div className="flex items-center justify-center space-x-1 text-green-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                <span className="text-sm font-medium">{t.videoExportProgressModal.exportSuccess}</span>
              </div>
            )}
          </div>
        </div>
             </div>
     </div>
  );
};

export default VideoExportProgressModal;