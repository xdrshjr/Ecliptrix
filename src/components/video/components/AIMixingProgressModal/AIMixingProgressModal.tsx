'use client';

import React, { useEffect, useState } from 'react';

interface AIMixingProgressModalProps {
  isOpen: boolean;
  progress: number;
  onCancel?: () => void;
  allowCancel?: boolean;
}

const AIMixingProgressModal: React.FC<AIMixingProgressModalProps> = ({
  isOpen,
  progress,
  onCancel,
  allowCancel = false
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
    if (progress < 15) return '准备分析素材...';
    if (progress < 35) return '调用AI生成剪辑方案...';
    if (progress < 60) return '处理时间轴配置...';
    if (progress < 85) return '合并到现有轨道...';
    if (progress < 95) return '同步时间轴状态...';
    if (progress >= 100) return 'AI混剪完成';
    return '即将完成...';
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
      aria-labelledby="ai-mixing-progress-title"
      aria-describedby="ai-mixing-progress-description"
    >
      <div 
        className={`bg-card rounded-md border border-border max-w-sm w-full transform transition-all duration-300 ${
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
                  stroke="#10b981"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - progress / 100)}`}
                  className="transition-all duration-500 ease-out"
                />
              </svg>
              
              {/* 中心图标 */}
              <div className="absolute inset-0 flex items-center justify-center">
                {progress >= 100 ? (
                  <svg className="w-6 h-6 text-green-500" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-emerald-500 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
            </div>
          </div>
          
          <h3 
            id="ai-mixing-progress-title"
            className="text-lg font-semibold text-foreground mb-2"
          >
            AI混剪处理中
          </h3>
          
          <p 
            id="ai-mixing-progress-description"
            className="text-sm text-muted-foreground mb-1"
          >
            {getProgressStage()}
          </p>
          
          <p className="text-2xl font-bold text-emerald-600 mb-4">
            {Math.round(progress)}%
          </p>
        </div>

        {/* Progress Bar */}
        <div className="px-6 pb-4">
          <div className="w-full bg-accent rounded-full h-2 overflow-hidden">
            <div 
              className="h-2 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-3">
              AI正在智能分析您的素材并生成剪辑方案，请耐心等待
            </p>
            
            {allowCancel && onCancel && progress < 100 && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted border border-border rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
              >
                取消混剪
              </button>
            )}
            
            {progress >= 100 && (
              <div className="flex items-center justify-center space-x-1 text-emerald-600">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                <span className="text-sm font-medium">AI混剪成功</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIMixingProgressModal;