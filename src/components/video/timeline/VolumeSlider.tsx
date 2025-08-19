'use client';

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface VolumeSliderProps {
  volume: number; // 0-200
  onVolumeChange: (volume: number) => void;
  isVisible: boolean;
  onClose: () => void;
}

const VolumeSlider: React.FC<VolumeSliderProps> = ({
  volume,
  onVolumeChange,
  isVisible,
  onClose
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      
      // 检查是否点击在滑块内部
      if (sliderRef.current && sliderRef.current.contains(target)) {
        return;
      }
      
      // 检查是否点击在音量按钮上（通过aria-label识别）
      const clickedElement = target as Element;
      const volumeButton = clickedElement.closest('[aria-label*="音量控制"]');
      if (volumeButton) {
        return; // 不关闭，让按钮的onClick处理
      }
      
      // 如果点击在其他地方，关闭面板
      onClose();
    };

    if (isVisible) {
      // 使用capture阶段来确保在按钮的onClick之前处理
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
      };
    }
  }, [isVisible, onClose]);

  // 计算位置 - 基于触发按钮的位置
  useEffect(() => {
    if (isVisible && typeof window !== 'undefined') {
      // 查找当前活跃的音量按钮
      const activeButton = document.querySelector('[aria-label*="音量控制"]');
      if (activeButton) {
        const rect = activeButton.getBoundingClientRect();
        setPosition({
          x: rect.left + rect.width / 2,
          y: rect.top - 10 // 10px above the button
        });
      }
    }
  }, [isVisible]);

  if (!mounted || !isVisible) return null;

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseInt(event.target.value);
    onVolumeChange(newVolume);
    
    console.log(`[VolumeSlider] 音量调节`, {
      oldVolume: volume,
      newVolume,
      timestamp: new Date().toISOString()
    });
  };

  const getVolumeIcon = () => {
    if (volume === 0) {
      return (
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      );
    } else if (volume < 50) {
      return (
        <path d="M3 9v6h4l5 5V4L7 9H3z"/>
      );
    } else if (volume < 100) {
      return (
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
      );
    } else {
      return (
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      );
    }
  };

  const sliderContent = (
    <div 
      ref={sliderRef}
      className="fixed bg-gray-900 text-white rounded-lg shadow-xl p-3 min-w-[120px] transform -translate-x-1/2"
      style={{ 
        zIndex: 999999,
        left: position.x,
        top: position.y,
        transform: 'translateX(-50%) translateY(-100%)'
      }}
    >
      {/* 音量图标和数值显示 */}
      <div className="flex items-center justify-between mb-2">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          {getVolumeIcon()}
        </svg>
        <span className="text-xs font-medium">{volume}%</span>
      </div>
      
      {/* 音量滑块 */}
      <div className="relative">
        <input
          type="range"
          min="0"
          max="200"
          value={volume}
          onChange={handleSliderChange}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
          style={{
            background: `linear-gradient(to right, #10b981 0%, #10b981 ${volume/2}%, #374151 ${volume/2}%, #374151 100%)`
          }}
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>0%</span>
          <span>100%</span>
          <span>200%</span>
        </div>
      </div>
      
      {/* 箭头指示器 */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2">
        <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
      </div>
      
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        
        .slider::-moz-range-thumb {
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          border: none;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
        }
      `}</style>
    </div>
  );

  return createPortal(sliderContent, document.body);
};

export default VolumeSlider; 