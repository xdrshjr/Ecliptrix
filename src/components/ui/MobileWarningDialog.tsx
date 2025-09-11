'use client';

import React, { useEffect, useState } from 'react';

export interface MobileWarningDialogProps {
  isOpen: boolean;
  onClose: () => void;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
}

const MobileWarningDialog: React.FC<MobileWarningDialogProps> = ({
  isOpen,
  onClose,
  deviceType = 'mobile'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setTimeout(() => setIsAnimating(true), 10);
      
      // Log mobile access attempt
      console.log('[MobileWarningDialog] Mobile video editing access attempt blocked:', {
        deviceType,
        timestamp: new Date().toISOString(),
        userAgent: typeof window !== 'undefined' ? navigator.userAgent : 'server-side',
        screenDimensions: typeof window !== 'undefined' ? {
          width: window.screen.width,
          height: window.screen.height
        } : null,
        viewportDimensions: typeof window !== 'undefined' ? {
          width: window.innerWidth,
          height: window.innerHeight
        } : null
      });
    } else {
      setIsAnimating(false);
      setTimeout(() => setIsVisible(false), 200);
    }
  }, [isOpen, deviceType]);

  const handleClose = () => {
    console.log('[MobileWarningDialog] User acknowledged mobile restriction warning:', {
      deviceType,
      timestamp: new Date().toISOString()
    });
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      handleClose();
    }
  };

  const getDeviceDisplayName = () => {
    switch (deviceType) {
      case 'tablet':
        return '平板设备';
      case 'mobile':
        return '移动设备';
      default:
        return '移动设备';
    }
  };

  const getDeviceIcon = () => {
    if (deviceType === 'tablet') {
      return (
        <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v16a1 1 0 001 1z" />
        </svg>
      );
    }
    
    return (
      <svg className="w-8 h-8 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    );
  };

  if (!isVisible) return null;

  return (
    <div 
      className={`fixed inset-0 z-[200] flex items-center justify-center p-4 transition-all duration-200 ${
        isAnimating ? 'bg-black bg-opacity-50' : 'bg-black bg-opacity-0'
      }`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div 
        className={`bg-white rounded-xl shadow-2xl border border-gray-200 max-w-md w-full transform transition-all duration-200 ${
          isAnimating ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-warning-title"
        aria-describedby="mobile-warning-description"
      >
        {/* Header */}
        <div className="flex items-start p-6 pb-4">
          <div className="flex-shrink-0 mr-4">
            {getDeviceIcon()}
          </div>
          <div className="flex-1">
            <h3 
              id="mobile-warning-title" 
              className="text-lg font-semibold text-gray-900 mb-2"
            >
              {getDeviceDisplayName()}不支持视频编辑
            </h3>
            <p 
              id="mobile-warning-description" 
              className="text-sm text-gray-600 leading-relaxed"
            >
              视频编辑功能需要较大的屏幕空间和更强的处理能力，目前仅支持PC端使用。
              <br /><br />
              请在电脑上打开本应用以使用完整的视频编辑功能。
            </p>
          </div>
        </div>

        {/* Additional Info */}
        <div className="px-6 py-3 bg-amber-50 border-t border-amber-100">
          <div className="flex items-start space-x-3">
            <svg className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-amber-800">
              <p className="font-medium mb-1">推荐使用环境：</p>
              <ul className="space-y-1 text-xs">
                <li>• 桌面电脑或笔记本电脑</li>
                <li>• 屏幕分辨率 1280x720 或更高</li>
                <li>• Chrome、Firefox、Safari 或 Edge 浏览器</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-gray-50 rounded-b-xl">
          <button
            onClick={handleClose}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            autoFocus
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileWarningDialog;