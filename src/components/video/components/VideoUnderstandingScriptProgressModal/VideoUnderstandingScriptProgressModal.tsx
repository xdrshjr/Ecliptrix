'use client';

import React, { useEffect, useState } from 'react';
import { VideoUnderstandingScriptProgress } from '../../types/videoEditingTypes';

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
        return '准备中...';
      case 'video-analysis':
        return '正在分析视频内容...';
      case 'script-generation':
        return '正在生成脚本...';
      default:
        return '处理中...';
    }
  };

  const getStepDescription = () => {
    switch (progress.currentStep) {
      case 'video-analysis':
        return `正在分析视频 (${progress.analyzedVideos}/${progress.totalVideos})`;
      case 'script-generation':
        return hasVideos ? '基于视频分析结果生成脚本内容' : '基于对话内容生成脚本';
      default:
        return '请稍候...';
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
        className={`bg-white rounded-2xl shadow-2xl border border-gray-100 max-w-lg w-full transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6" />
              </svg>
            </div>
            <div>
              <h3 id="progress-title" className="text-lg font-semibold text-gray-900">
                {hasVideos ? '视频理解生成脚本' : '生成脚本'}
              </h3>
              <p id="progress-description" className="text-sm text-gray-500">
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
              <span className="text-sm font-medium text-gray-700">
                {getStepDescription()}
              </span>
              <span className="text-sm text-gray-500">
                {Math.round(getProgressPercentage())}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-gradient-to-r from-purple-500 to-purple-600 h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${getProgressPercentage()}%` }}
              />
            </div>
          </div>

          {/* Current Video Info */}
          {progress.currentVideoName && progress.currentStep === 'video-analysis' && (
            <div className="bg-purple-50 rounded-lg p-4 mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
                <span className="text-sm text-purple-700 font-medium">
                  正在分析: {progress.currentVideoName}
                </span>
              </div>
            </div>
          )}

          {/* Statistics */}
          {progress.currentStep === 'video-analysis' && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <div className="text-lg font-semibold text-green-600">
                  {progress.analyzedVideos}
                </div>
                <div className="text-xs text-gray-500">已完成</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-blue-600">
                  {progress.totalVideos - progress.analyzedVideos - progress.failedVideos}
                </div>
                <div className="text-xs text-gray-500">处理中</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-red-600">
                  {progress.failedVideos}
                </div>
                <div className="text-xs text-gray-500">失败</div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {progress.errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <div className="flex items-start space-x-2">
                <svg className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-red-700">
                  <div className="font-medium">处理过程中遇到问题</div>
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
                  className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"
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
          <div className="px-6 py-4 bg-gray-50 rounded-b-2xl">
            <div className="flex justify-end">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 transition-colors duration-200"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VideoUnderstandingScriptProgressModal; 