'use client';

import React, { useEffect, useState } from 'react';

interface ScriptGenerationProgressModalProps {
  isOpen: boolean;
  progress: number;
  startTime?: number | null;
  onCancel?: () => void;
  allowCancel?: boolean;
}

const ScriptGenerationProgressModal: React.FC<ScriptGenerationProgressModalProps> = ({
  isOpen,
  progress,
  startTime,
  onCancel,
  allowCancel = false
}) => {
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
    if (progress < 20) return '准备生成脚本...';
    if (progress < 40) return '分析文档内容...';
    if (progress < 70) return '生成脚本结构...';
    if (progress < 90) return '优化脚本内容...';
    if (progress >= 100) return '脚本生成完成';
    return '即将完成...';
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
      aria-labelledby="script-generation-progress-title"
      aria-describedby="script-generation-progress-description"
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
                  stroke="currentColor"
                  className="text-accent"
                  strokeWidth="4"
                  fill="none"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="28"
                  stroke="currentColor"
                  className="text-primary transition-all duration-500 ease-out"
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 28}`}
                  strokeDashoffset={`${2 * Math.PI * 28 * (1 - progress / 100)}`}
                />
              </svg>
              
              {/* 中心图标 - 添加动画 */}
              <div className="absolute inset-0 flex items-center justify-center">
                {progress >= 100 ? (
                  <svg 
                    className="w-6 h-6 text-primary animate-bounce"
                    fill="currentColor" 
                    viewBox="0 0 24 24"
                  >
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                  </svg>
                ) : (
                  <svg 
                    className="w-6 h-6 text-primary animate-spin"
                    fill="none" 
                    stroke="currentColor" 
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
              </div>
            </div>
          </div>
          
          <h3 
            id="script-generation-progress-title"
            className="text-lg font-semibold text-foreground mb-2"
          >
            生成脚本
          </h3>
          
          <p 
            id="script-generation-progress-description"
            className="text-sm text-muted-foreground mb-1"
          >
            {getProgressStage()}
          </p>
          
          <p className="text-2xl font-bold text-primary mb-2">
            {Math.round(progress)}%
          </p>
          
          {/* 显示经过时间 */}
          {startTime && (
            <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12,6 12,12 16,14"/>
              </svg>
              <span>已用时: {formatElapsedTime(elapsedTime)}</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="px-6 pb-4">
          <div className="w-full bg-accent rounded-full h-2 overflow-hidden">
            <div 
              className="h-2 bg-primary rounded-full transition-all duration-500 ease-out"
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-3">
              请耐心等待，脚本生成过程中请勿关闭页面
            </p>
            
            {allowCancel && onCancel && progress < 100 && (
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted border border-border rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-ring transition-colors"
              >
                取消生成
              </button>
            )}
            
            {progress >= 100 && (
              <div className="flex items-center justify-center space-x-1 text-primary">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                <span className="text-sm font-medium">脚本生成成功</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScriptGenerationProgressModal; 