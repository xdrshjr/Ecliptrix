'use client';

import React, { useEffect, useState } from 'react';

export interface MobileWarningDialogProps {
  isOpen: boolean;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
}

const MobileWarningDialog: React.FC<MobileWarningDialogProps> = ({
  isOpen,
  deviceType = 'mobile'
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      // Smooth animation entrance
      const timer = setTimeout(() => setIsAnimating(true), 50);
      
      // Log mobile access attempt with detailed information
      console.log('[MobileWarningDialog] Mobile access blocked - showing persistent warning:', {
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
        } : null,
        isPersistent: true,
        location: 'Global App Level'
      });

      return () => clearTimeout(timer);
    }
  }, [isOpen, deviceType]);

  const getDeviceDisplayName = () => {
    switch (deviceType) {
      case 'tablet':
        return '平板设备';
      case 'mobile':
        return '手机设备';
      default:
        return '移动设备';
    }
  };

  const getDeviceIcon = () => {
    if (deviceType === 'tablet') {
      return (
        <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5h3m-6.75-2.25h10.5a2.25 2.25 0 002.25-2.25v-15a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 4.5v15a2.25 2.25 0 002.25 2.25z" />
        </svg>
      );
    }
    
    return (
      <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
      </svg>
    );
  };

  if (!isVisible) return null;

  return (
    <div 
      className={`fixed inset-0 z-[9999] flex items-center justify-center transition-all duration-300 ${
        isAnimating ? 'bg-white bg-opacity-95 backdrop-blur-sm' : 'bg-white bg-opacity-0'
      }`}
      style={{ 
        backdropFilter: isAnimating ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: isAnimating ? 'blur(20px)' : 'none'
      }}
    >
      <div 
        className={`bg-white rounded-3xl shadow-xl max-w-sm w-full mx-4 transform transition-all duration-500 ease-out ${
          isAnimating ? 'scale-100 opacity-100 translate-y-0' : 'scale-110 opacity-0 translate-y-4'
        }`}
        style={{
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05)'
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-warning-title"
        aria-describedby="mobile-warning-description"
      >
        {/* Content */}
        <div className="px-8 py-12 text-center">
          {/* Icon */}
          <div className="flex justify-center mb-6">
            {getDeviceIcon()}
          </div>

          {/* Title */}
          <h2 
            id="mobile-warning-title" 
            className="text-2xl font-semibold text-gray-900 mb-4 tracking-tight"
          >
            暂不支持{getDeviceDisplayName()}
          </h2>

          {/* Description */}
          <p 
            id="mobile-warning-description" 
            className="text-gray-600 text-base leading-relaxed mb-8 font-normal"
          >
            为了提供更好的使用体验，请在电脑上访问本应用。
          </p>

          {/* Computer Icon with Label */}
          <div className="inline-flex items-center justify-center px-6 py-3 bg-gray-50 rounded-2xl">
            <svg className="w-6 h-6 text-gray-500 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
            <span className="text-sm font-medium text-gray-700">建议使用电脑访问</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MobileWarningDialog;