'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/contexts/LocaleContext';

export interface AIMixingMode {
  type: 'quick' | 'professional';
  frameInterval?: number; // 仅专业模式需要
}

interface AIMixingModeSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: AIMixingMode) => void;
}

const AIMixingModeSelectionModal: React.FC<AIMixingModeSelectionModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [selectedMode, setSelectedMode] = useState<'quick' | 'professional'>('quick');
  const [frameInterval, setFrameInterval] = useState<number>(5);

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
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      handleConfirm();
    }
  };

  const handleConfirm = () => {
    const mode: AIMixingMode = {
      type: selectedMode,
      ...(selectedMode === 'professional' && { frameInterval }),
    };
    onConfirm(mode);
  };

  const handleFrameIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(1, Math.min(30, parseInt(e.target.value) || 5));
    setFrameInterval(value);
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
      aria-labelledby="ai-mixing-mode-title"
      aria-describedby="ai-mixing-mode-description"
    >
      <div 
        className={`bg-card rounded-md border border-border max-w-md w-full transform transition-all duration-300 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <h3
                id="ai-mixing-mode-title"
                className="text-xl font-semibold text-foreground"
              >
                {t.aiMixingModal.title}
              </h3>
              <p 
                id="ai-mixing-mode-description"
                className="text-sm text-muted-foreground mt-1"
              >
                {t.aiMixingModal.subtitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-md bg-muted hover:bg-accent flex items-center justify-center transition-colors duration-200"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-6 space-y-4">
          {/* 快速混剪选项 */}
          <div 
            className={`relative p-4 rounded-md border-2 cursor-pointer transition-all duration-200 ${
              selectedMode === 'quick' 
                ? 'border-primary bg-primary/10' 
                : 'border-border hover:border-border hover:bg-muted'
            }`}
            onClick={() => setSelectedMode('quick')}
          >
            <div className="flex items-start space-x-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                selectedMode === 'quick' ? 'border-primary bg-primary' : 'border-border'
              }`}>
                {selectedMode === 'quick' && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <h4 className="font-semibold text-foreground">{t.aiMixingModal.quickMode}</h4>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t.aiMixingModal.quickModeDesc}
                </p>
                <div className="mt-2 flex items-center space-x-1 text-xs text-muted-foreground">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                  <span>{t.aiMixingModal.quickModeFast}</span>
                  <span>•</span>
                  <span>{t.aiMixingModal.quickModeLowResource}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 专业混剪选项 */}
          <div 
            className={`relative p-4 rounded-md border-2 cursor-pointer transition-all duration-200 ${
              selectedMode === 'professional' 
                ? 'border-primary bg-primary/10' 
                : 'border-border hover:border-border hover:bg-muted'
            }`}
            onClick={() => setSelectedMode('professional')}
          >
            <div className="flex items-start space-x-3">
              <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                selectedMode === 'professional' ? 'border-primary bg-primary' : 'border-border'
              }`}>
                {selectedMode === 'professional' && (
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <h4 className="font-semibold text-foreground">{t.aiMixingModal.professionalMode}</h4>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                  {t.aiMixingModal.professionalModeDesc}
                </p>
                
                {/* 帧间隔设置 */}
                {selectedMode === 'professional' && (
                  <div className="bg-card rounded-md p-3 border border-border">
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t.aiMixingModal.frameIntervalLabel}
                    </label>
                    <div className="flex items-center space-x-3">
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={frameInterval}
                        onChange={handleFrameIntervalChange}
                        className="flex-1 px-3 py-2 border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                        placeholder="5"
                      />
                      <span className="text-sm text-muted-foreground">{t.aiMixingModal.frameIntervalUnit}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t.aiMixingModal.frameIntervalHint}
                    </p>
                  </div>
                )}
                
                <div className="mt-2 flex items-center space-x-1 text-xs text-muted-foreground">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                  <span>{t.aiMixingModal.professionalModeHighPrecision}</span>
                  <span>•</span>
                  <span>{t.aiMixingModal.professionalModeBetterResults}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-muted rounded-b-md">
          <div className="flex items-center justify-end space-x-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-secondary-foreground bg-secondary border border-border rounded-md hover:bg-accent focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-200"
            >
              {t.aiMixingModal.cancel}
            </button>
            <button
              onClick={handleConfirm}
              className="px-6 py-2 text-sm font-medium text-primary-foreground bg-primary border border-transparent rounded-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary transition-colors duration-200"
            >
              {t.aiMixingModal.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIMixingModeSelectionModal; 